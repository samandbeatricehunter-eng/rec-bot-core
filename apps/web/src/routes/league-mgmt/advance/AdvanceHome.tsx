import { useEffect, useState } from "react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { AdvanceDmPreview, AdvanceResultInput, AdvanceWeekGames, DivisionWinnerOptions } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Badge } from "../../../components/ui/Badge.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const SEASON_STAGES = [
  "preseason_training_camp", "regular_season", "wild_card", "divisional",
  "conference_championship", "super_bowl", "offseason", "coach_hiring",
  "final_resigning", "free_agency", "draft",
];
const TZ_LABELS = ["EST", "CST", "PST", "AKST"];

type GameEntry = { outcome: "home" | "away" | "tie" | ""; homeScore: string; awayScore: string };

// The pure-data subset of the Discord "Advance" wizard — score collection and the actual
// week/stage advance commit, division winners, and next-advance scheduling. GOTW polls
// (native Discord poll voting), game channel creation, @everyone announcements, and actual
// DM delivery all need the live bot process and stay Discord-only; Advance DMs below is a
// preview of what WOULD be sent, not a send action.
export function AdvanceHome() {
  const { guildId } = useReadyAuth();
  const [data, setData] = useState<AdvanceWeekGames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, GameEntry>>({});
  const [nextWeekNumber, setNextWeekNumber] = useState("");
  const [nextSeasonStage, setNextSeasonStage] = useState("regular_season");
  const [advancing, setAdvancing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [divisions, setDivisions] = useState<DivisionWinnerOptions | null>(null);
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [savingWinners, setSavingWinners] = useState(false);

  const [advanceDate, setAdvanceDate] = useState({ year: new Date().getFullYear(), month: 1, day: 1, hour: 20, minute: 0, tzLabel: "EST" });
  const [savingTime, setSavingTime] = useState(false);

  const [dmPreview, setDmPreview] = useState<AdvanceDmPreview | null>(null);
  const [loadingDms, setLoadingDms] = useState(false);

  function load() {
    recApi
      .getAdvanceWeekGames(guildId)
      .then((res) => {
        setData(res);
        setNextWeekNumber(String(res.currentWeek + 1));
        setNextSeasonStage(res.currentStage);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this week's games."));
  }

  useEffect(load, [guildId]);

  const emptyEntry: GameEntry = { outcome: "", homeScore: "", awayScore: "" };

  function setEntry(gameId: string, patch: Partial<GameEntry>) {
    setEntries((prev) => ({ ...prev, [gameId]: { ...(prev[gameId] ?? emptyEntry), ...patch } }));
  }

  async function handleAdvance() {
    if (!data) return;
    setAdvancing(true);
    setError(null);
    setNotice(null);
    const results: AdvanceResultInput[] = data.gamesNeedingInput.flatMap((g): AdvanceResultInput[] => {
      const entry = entries[g.gameId];
      if (!entry?.outcome) return [];
      return [{
        gameId: g.gameId,
        outcome: entry.outcome as "home" | "away" | "tie",
        homeScore: entry.homeScore.trim() === "" ? null : Number(entry.homeScore),
        awayScore: entry.awayScore.trim() === "" ? null : Number(entry.awayScore),
      }];
    });
    try {
      await recApi.completeAdvanceWeek({
        guildId,
        nextWeekNumber: Number(nextWeekNumber),
        nextSeasonStage,
        results,
      });
      setNotice(`Advanced to Week ${nextWeekNumber} (${nextSeasonStage}).`);
      setEntries({});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete the advance.");
    } finally {
      setAdvancing(false);
    }
  }

  function loadDivisions() {
    recApi
      .getDivisionWinnerOptions(guildId)
      .then(setDivisions)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load division winner options."));
  }

  async function handleSaveWinners() {
    if (!divisions) return;
    setSavingWinners(true);
    setError(null);
    const selected = Object.entries(winners).filter(([, teamId]) => teamId);
    try {
      await recApi.saveDivisionWinners({
        guildId,
        seasonNumber: divisions.league.seasonNumber,
        winners: selected.map(([divisionKey, teamId]) => ({ divisionKey, teamId })),
      });
      setNotice("Division winners saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save division winners.");
    } finally {
      setSavingWinners(false);
    }
  }

  async function handleSaveTime() {
    setSavingTime(true);
    setError(null);
    try {
      await recApi.setNextAdvanceTime({ guildId, ...advanceDate });
      setNotice("Next advance time saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the next advance time.");
    } finally {
      setSavingTime(false);
    }
  }

  function loadDmPreview() {
    setLoadingDms(true);
    setError(null);
    recApi
      .previewAdvanceDms(guildId)
      .then(setDmPreview)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to generate the DM preview."))
      .finally(() => setLoadingDms(false));
  }

  if (error && !data) return <div><PageHeader title="Advance" subtitle="Weekly league advance." /><ErrorState message={error} /></div>;
  if (!data) return <LoadingState />;

  return (
    <div>
      <PageHeader title="Advance" subtitle={`${data.league.name} — Week ${data.currentWeek}, ${data.currentStage.replace(/_/g, " ")}`} />
      {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
      {error && <ErrorState message={error} />}

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>This Week's Games</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {data.games.map((g) => {
            const entry = entries[g.gameId];
            return (
              <div key={g.gameId} style={{ borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                  <span>{g.awayTeamName} @ {g.homeTeamName}</span>
                  {!g.needsInput && <Badge status="approved">{g.existingResultSource ?? "Has result"}</Badge>}
                  {g.needsInput && <Badge status="pending">Needs input</Badge>}
                </div>
                {g.needsInput && (
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
                    <select className="form-select" style={{ width: "auto" }} value={entry?.outcome ?? ""} onChange={(e) => setEntry(g.gameId, { outcome: e.target.value as GameEntry["outcome"] })}>
                      <option value="">Outcome…</option>
                      <option value="home">{g.homeTeamName} Win</option>
                      <option value="away">{g.awayTeamName} Win</option>
                      <option value="tie">Tie</option>
                    </select>
                    <input className="form-input" style={{ width: 90 }} type="number" placeholder="Home" value={entry?.homeScore ?? ""} onChange={(e) => setEntry(g.gameId, { homeScore: e.target.value })} />
                    <input className="form-input" style={{ width: 90 }} type="number" placeholder="Away" value={entry?.awayScore ?? ""} onChange={(e) => setEntry(g.gameId, { awayScore: e.target.value })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginTop: "var(--space-4)" }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="next-week">Next Week</label>
            <input id="next-week" className="form-input" type="number" min={0} max={30} value={nextWeekNumber} onChange={(e) => setNextWeekNumber(e.target.value)} />
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="next-stage">Next Season Stage</label>
            <select id="next-stage" className="form-select" value={nextSeasonStage} onChange={(e) => setNextSeasonStage(e.target.value)}>
              {SEASON_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: "var(--space-4)" }}>
          <Button variant="tactical" onClick={handleAdvance} disabled={advancing || !nextWeekNumber}>
            {advancing ? "Advancing…" : "Complete Advance"}
          </Button>
        </div>
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>Division Winners</h2>
        {!divisions && <Button variant="secondary" onClick={loadDivisions}>Load Division Winners</Button>}
        {divisions && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              {divisions.divisions.map((d) => (
                <div key={d.key} className="form-field" style={{ marginBottom: 0 }}>
                  <label className="form-label" htmlFor={`div-${d.key}`}>{d.label}</label>
                  <select id={`div-${d.key}`} className="form-select" value={winners[d.key] ?? ""} onChange={(e) => setWinners((prev) => ({ ...prev, [d.key]: e.target.value }))}>
                    <option value="">—</option>
                    {d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <Button variant="primary" onClick={handleSaveWinners} disabled={savingWinners}>
              {savingWinners ? "Saving…" : "Save Division Winners"}
            </Button>
          </>
        )}
      </Card>

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>Set Next Advance Time</h2>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
          {(["year", "month", "day", "hour", "minute"] as const).map((field) => (
            <div key={field} className="form-field" style={{ marginBottom: 0, width: 100 }}>
              <label className="form-label" htmlFor={`adv-${field}`}>{field}</label>
              <input id={`adv-${field}`} className="form-input" type="number" value={advanceDate[field]} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, [field]: Number(e.target.value) }))} />
            </div>
          ))}
          <div className="form-field" style={{ marginBottom: 0, width: 100 }}>
            <label className="form-label" htmlFor="adv-tz">Timezone</label>
            <select id="adv-tz" className="form-select" value={advanceDate.tzLabel} onChange={(e) => setAdvanceDate((prev) => ({ ...prev, tzLabel: e.target.value }))}>
              {TZ_LABELS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
        </div>
        <Button variant="primary" onClick={handleSaveTime} disabled={savingTime}>
          {savingTime ? "Saving…" : "Save Advance Time"}
        </Button>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Advance DMs (Preview)</h2>
        <p className="form-hint" style={{ marginTop: 0 }}>This previews what would be sent to each coach — actual delivery still has to happen from Discord.</p>
        {!dmPreview && <Button variant="secondary" onClick={loadDmPreview} disabled={loadingDms}>{loadingDms ? "Loading…" : "Preview Advance DMs"}</Button>}
        {dmPreview && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {dmPreview.users.map((u) => (
              <div key={u.discordId} style={{ borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-2)" }}>
                <strong>{u.displayName}</strong>{u.teamName ? ` — ${u.teamName}` : ""}
                {[u.sections.transactions, u.sections.badges, u.sections.eosProgress, u.sections.powerRanking].filter(Boolean).map((s, i) => (
                  <p key={i} style={{ margin: "var(--space-1) 0 0", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>{s}</p>
                ))}
              </div>
            ))}
            {dmPreview.users.length === 0 && <p style={{ color: "var(--text-secondary)" }}>Nothing to send.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
