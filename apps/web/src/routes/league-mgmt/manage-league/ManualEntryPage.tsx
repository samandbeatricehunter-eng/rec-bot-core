import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { AdvanceWeekGames, TeamManagementSummary } from "../../../types/api.js";
import { Button } from "../../../components/ui/Button.js";
import { Card } from "../../../components/ui/Card.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";

// Manual data entry, reached from Import Data → Input Data Manually. Two halves:
//   Game Results — the week's games as a 2-column grid of typed final-score inputs
//     (recordManualScore, the same call the schedule builder makes).
//   Player Stats — pick team → position → player, then type a stat line for the
//     selected week (submitPlayerStatLine queues it for commissioner review like any
//     other player submission, so backdated weeks flow through the same review).
export function ManualEntryPage({ summary, onBack }: { summary: TeamManagementSummary; onBack: () => void }) {
  const { guildId, discordId } = useReadyAuth();
  const [week, setWeek] = useState<number>(summary.league.currentWeek || 1);
  const maxWeek = Math.max(week, summary.league.currentWeek || 1, 18);

  const [games, setGames] = useState<AdvanceWeekGames | null>(null);
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, { home: string; away: string }>>({});
  const [scoreNotice, setScoreNotice] = useState<string | null>(null);
  const [savingGameId, setSavingGameId] = useState<string | null>(null);

  useEffect(() => {
    setGames(null);
    setGamesError(null);
    recApi
      .getAdvanceWeekGames(guildId)
      .then(setGames)
      .catch((err) => setGamesError(err instanceof Error ? err.message : "Failed to load this week's games."));
  }, [guildId]);

  function setScore(gameId: string, side: "home" | "away", value: string) {
    setScores((prev) => ({ ...prev, [gameId]: { home: prev[gameId]?.home ?? "", away: prev[gameId]?.away ?? "", [side]: value } }));
  }

  async function saveGameResult(gameId: string, homeTeam: string, awayTeam: string) {
    const entry = scores[gameId];
    const home = Number(entry?.home);
    const away = Number(entry?.away);
    if (!entry || entry.home.trim() === "" || entry.away.trim() === "" || Number.isNaN(home) || Number.isNaN(away)) {
      setScoreNotice("Enter both scores before saving a result.");
      return;
    }
    setSavingGameId(gameId);
    setScoreNotice(null);
    try {
      await recApi.recordManualScore({
        guildId,
        gameId,
        outcome: home > away ? "home" : away > home ? "away" : "tie",
        homeScore: home,
        awayScore: away,
      });
      setScoreNotice(`${awayTeam} @ ${homeTeam} result saved.`);
    } catch (err) {
      setScoreNotice(err instanceof Error ? err.message : "Failed to save the result.");
    } finally {
      setSavingGameId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Manual Data Entry"
        subtitle={`Log results and stat lines by hand for ${summary.league.name ?? "your league"} — no EA link or Companion App required.`}
        actions={
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft size={16} /> Back to Teams
          </Button>
        }
      />

      <Card style={{ marginBottom: "var(--space-4)" }}>
        <div className="form-field" style={{ margin: 0, maxWidth: 220 }}>
          <label className="form-label" htmlFor="manual-week">Week being entered</label>
          <select id="manual-week" className="form-select" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}{w === summary.league.currentWeek ? " (current)" : ""}
              </option>
            ))}
          </select>
          <p className="form-hint">Game results always apply to the game you save them on; the week selector sets the week for player stat lines (for backdating).</p>
        </div>
      </Card>

      <section style={{ marginBottom: "var(--space-5)" }}>
        <h3 style={{ margin: "0 0 var(--space-3)", color: "var(--gold)" }}>Game Results</h3>
        {gamesError && <ErrorState message={gamesError} />}
        {!games && !gamesError && <LoadingState label="Loading this week's games…" />}
        {games && games.games.length === 0 && <Card><p style={{ margin: 0, color: "var(--text-secondary)" }}>No games scheduled for the current week.</p></Card>}
        {games && games.games.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "var(--space-3)" }}>
            {games.games.map((g) => (
              <Card key={g.gameId}>
                <div style={{ fontWeight: 700, marginBottom: "var(--space-2)" }}>{g.awayTeamName} @ {g.homeTeamName}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                  <label className="form-field" style={{ margin: 0 }}>
                    <span className="form-label">{g.awayTeamName}</span>
                    <input className="form-input" type="number" inputMode="numeric" placeholder="Away score" value={scores[g.gameId]?.away ?? ""} onChange={(e) => setScore(g.gameId, "away", e.target.value)} />
                  </label>
                  <label className="form-field" style={{ margin: 0 }}>
                    <span className="form-label">{g.homeTeamName}</span>
                    <input className="form-input" type="number" inputMode="numeric" placeholder="Home score" value={scores[g.gameId]?.home ?? ""} onChange={(e) => setScore(g.gameId, "home", e.target.value)} />
                  </label>
                </div>
                <div style={{ marginTop: "var(--space-2)" }}>
                  <Button size="compact" disabled={savingGameId === g.gameId} onClick={() => void saveGameResult(g.gameId, g.homeTeamName, g.awayTeamName)}>
                    {savingGameId === g.gameId ? "Saving…" : "Save Result"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
        {scoreNotice && <p className="form-hint" style={{ color: "var(--gold)" }}>{scoreNotice}</p>}
      </section>

      <PlayerStatsSection guildId={guildId} discordId={discordId} summary={summary} week={week} />
    </div>
  );
}

// ── Player stats ──

type StatCategory = "passing" | "rushing" | "receiving" | "defense";

const STAT_FIELDS: Record<StatCategory, Array<{ key: string; label: string }>> = {
  passing: [
    { key: "completions", label: "Completions" },
    { key: "attempts", label: "Attempts" },
    { key: "yards", label: "Yards" },
    { key: "touchdowns", label: "TD" },
    { key: "interceptions", label: "INT" },
  ],
  rushing: [
    { key: "attempts", label: "Attempts" },
    { key: "yards", label: "Yards" },
    { key: "touchdowns", label: "TD" },
    { key: "longest", label: "Longest" },
  ],
  receiving: [
    { key: "receptions", label: "Receptions" },
    { key: "yards", label: "Yards" },
    { key: "touchdowns", label: "TD" },
    { key: "longest", label: "Longest" },
  ],
  defense: [
    { key: "tackles", label: "Tackles" },
    { key: "sacks", label: "Sacks" },
    { key: "interceptions", label: "INT" },
    { key: "forcedFumbles", label: "FF" },
  ],
};

function PlayerStatsSection({
  guildId,
  discordId,
  summary,
  week,
}: {
  guildId: string;
  discordId: string;
  summary: TeamManagementSummary;
  week: number;
}) {
  const [teamId, setTeamId] = useState("");
  const [position, setPosition] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [category, setCategory] = useState<StatCategory>("passing");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [roster, setRoster] = useState<Array<{ id: string; fullName: string; position: string }>>([]);

  useEffect(() => {
    setRoster([]);
    setPosition("");
    setPlayerName("");
    if (!teamId) return;
    recApi
      .getTeamRoster({ guildId, teamId })
      .then((res) => setRoster(res.players.map((p) => ({ id: p.id, fullName: p.fullName, position: p.position }))))
      .catch(() => setRoster([]));
  }, [guildId, teamId]);

  const positions = useMemo(
    () => [...new Set(roster.map((p) => p.position).filter((p): p is string => Boolean(p)))].sort(),
    [roster],
  );
  const playersAtPosition = useMemo(
    () => (position ? roster.filter((p) => p.position === position) : roster),
    [roster, position],
  );

  async function submit() {
    if (!playerName.trim()) {
      setError("Pick a player first.");
      return;
    }
    const statLines = STAT_FIELDS[category]
      .filter((field) => values[field.key]?.trim() !== "" && values[field.key] !== undefined)
      .map((field) => ({ statKey: field.key, label: field.label, value: Number(values[field.key]) }));
    if (statLines.length === 0) {
      setError("Enter at least one stat value.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await recApi.submitPlayerStatLine({ guildId, discordId, playerName: playerName.trim(), category, statLines });
      setNotice(`Stat line for ${playerName} (Week ${week}) submitted for review.`);
      setValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit the stat line.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 style={{ margin: "0 0 var(--space-3)", color: "var(--gold)" }}>Player Stats</h3>
      <Card>
        {error && <ErrorState message={error} />}
        {notice && <p className="form-hint" style={{ color: "var(--gold)" }}>{notice}</p>}
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <div className="form-field" style={{ margin: 0, minWidth: 180 }}>
            <label className="form-label" htmlFor="stat-team">Team</label>
            <select id="stat-team" className="form-select" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Select a team…</option>
              {summary.teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ margin: 0, minWidth: 140 }}>
            <label className="form-label" htmlFor="stat-position">Position</label>
            <select id="stat-position" className="form-select" value={position} onChange={(e) => { setPosition(e.target.value); setPlayerName(""); }} disabled={!teamId}>
              <option value="">Any…</option>
              {positions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ margin: 0, minWidth: 200 }}>
            <label className="form-label" htmlFor="stat-player">Player</label>
            <select id="stat-player" className="form-select" value={playerName} onChange={(e) => setPlayerName(e.target.value)} disabled={!teamId}>
              <option value="">Select a player…</option>
              {playersAtPosition.map((p) => (
                <option key={p.id} value={p.fullName}>{p.fullName}</option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ margin: 0, minWidth: 150 }}>
            <label className="form-label" htmlFor="stat-category">Category</label>
            <select id="stat-category" className="form-select" value={category} onChange={(e) => { setCategory(e.target.value as StatCategory); setValues({}); }}>
              {(Object.keys(STAT_FIELDS) as StatCategory[]).map((c) => (
                <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          {STAT_FIELDS[category].map((field) => (
            <label key={field.key} className="form-field" style={{ margin: 0 }}>
              <span className="form-label">{field.label}</span>
              <input
                className="form-input"
                type="number"
                inputMode="numeric"
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div style={{ marginTop: "var(--space-3)" }}>
          <Button disabled={busy} onClick={() => void submit()}>{busy ? "Submitting…" : `Submit Stat Line (Week ${week})`}</Button>
        </div>
        <p className="form-hint">Submitted lines land in the commissioner review queue, same as player-submitted stats.</p>
      </Card>
    </section>
  );
}
