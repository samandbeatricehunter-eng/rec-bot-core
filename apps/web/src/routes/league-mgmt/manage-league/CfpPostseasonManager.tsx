import { useEffect, useMemo, useState } from "react";
import { CFB_BOWL_NAMES } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CfpPostseasonState, ScheduleTeam } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type RankingDraft = { rank: number; teamId: string; conferenceChampion: boolean };

export function CfpPostseasonManager() {
  const { guildId } = useReadyAuth();
  const [teams, setTeams] = useState<ScheduleTeam[]>([]);
  const [state, setState] = useState<CfpPostseasonState | null>(null);
  const [draft, setDraft] = useState<RankingDraft[]>(Array.from({ length: 25 }, (_, index) => ({ rank: index + 1, teamId: "", conferenceChampion: false })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([recApi.listScheduleTeams(guildId), recApi.getCfpPostseason(guildId)])
      .then(([teamResult, postseason]) => {
        setTeams(teamResult.teams);
        setState(postseason);
        if (postseason.rankings.length) {
          setDraft(postseason.rankings.map((row) => ({ rank: row.rank, teamId: row.team_id, conferenceChampion: row.conference_champion })));
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load CFP setup."));
  }, [guildId]);

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const selectedTeams = draft.map((row) => row.teamId).filter(Boolean);
  const duplicates = new Set(selectedTeams).size !== selectedTeams.length;
  const complete = selectedTeams.length === 25 && !duplicates;

  async function saveRankings() {
    setBusy(true); setError(null);
    try { setState(await recApi.saveCfpTop25({ guildId, rankings: draft })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save CFP rankings."); }
    finally { setBusy(false); }
  }

  async function generate() {
    setBusy(true); setError(null);
    try { setState(await recApi.generateCfpBracket({ guildId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not generate CFP bracket."); }
    finally { setBusy(false); }
  }

  return <div>
    <PageHeader title="CFP Top 25 & Bracket" subtitle="Enter the in-game CFP Top 25, identify conference champions, then generate the 12-team bracket and team schedules." />
    {error && <ErrorState message={error} />}
    {!state && !error ? <LoadingState label="Loading CFP postseason…" /> : null}
    <Card>
      <h2>In-game CFP Top 25</h2>
      <p className="form-hint">The first 12 form the suggested playoff field. Entries remain editable until an affected CFP game has a recorded result.</p>
      <div className="cfp-top25-grid">
        {draft.map((row, index) => <div className="cfp-ranking-row" key={row.rank}>
          <strong>#{row.rank}</strong>
          <select className="form-select" value={row.teamId} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, teamId: event.target.value } : item))}>
            <option value="">Select team</option>
            {sortedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
          <label><input type="checkbox" checked={row.conferenceChampion} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, conferenceChampion: event.target.checked } : item))} /> Conference champion</label>
        </div>)}
      </div>
      {duplicates ? <p className="error-text">Each ranking must use a different team.</p> : null}
      <div className="form-actions">
        <Button variant="primary" disabled={!complete || busy} onClick={() => void saveRankings()}>Save Top 25</Button>
        <Button variant="secondary" disabled={state?.rankings.length !== 25 || busy} onClick={() => void generate()}>Generate / Rebuild CFP Bracket</Button>
      </div>
    </Card>
    {state?.bracket.length ? <Card>
      <h2>12-team CFP bracket</h2>
      <div className="cfp-bracket">
        {(["first_round", "quarterfinal", "semifinal", "championship"] as const).map((round) => <section key={round}>
          <h3>{round.replaceAll("_", " ")}</h3>
          {state.bracket.filter((slot) => slot.round === round).map((slot) => <article key={slot.slot_id ?? `${round}-${slot.slot_number}`}>
            <span>{slot.home_seed ? `#${slot.home_seed} ` : ""}{slot.home_team_name ?? "Winner TBD"}</span>
            <strong>vs</strong>
            <span>{slot.away_seed ? `#${slot.away_seed} ` : ""}{slot.away_team_name ?? "Winner TBD"}</span>
            {slot.game_status === "completed" ? <em>{slot.home_score}–{slot.away_score}</em> : null}
          </article>)}
        </section>)}
      </div>
      <p className="form-hint">First-round games and top-four byes are written to schedules immediately. Confirmed results lock their participants.</p>
    </Card> : null}
    <Card><h2>Bowl catalog</h2><p className="form-hint">{CFB_BOWL_NAMES.length - 1} real 2026–27 bowls are installed, plus Custom Bowl.</p></Card>
  </div>;
}
