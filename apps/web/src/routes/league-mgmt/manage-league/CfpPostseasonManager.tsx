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
import { HeismanRaceCard } from "./HeismanRaceCard.js";

type RankingDraft = { rank: number; teamId: string; conferenceChampion: boolean };
type SeedDraft = { seed: number; teamId: string };

const EMPTY_TOP25: RankingDraft[] = Array.from({ length: 25 }, (_, index) => ({ rank: index + 1, teamId: "", conferenceChampion: false }));
const EMPTY_SEEDS: SeedDraft[] = Array.from({ length: 12 }, (_, index) => ({ seed: index + 1, teamId: "" }));

export function CfpPostseasonManager() {
  const { guildId } = useReadyAuth();
  const [teams, setTeams] = useState<ScheduleTeam[]>([]);
  const [state, setState] = useState<CfpPostseasonState | null>(null);
  const [top25Draft, setTop25Draft] = useState<RankingDraft[]>(EMPTY_TOP25);
  const [seedDraft, setSeedDraft] = useState<SeedDraft[]>(EMPTY_SEEDS);
  const [savingTop25, setSavingTop25] = useState(false);
  const [savingSeeds, setSavingSeeds] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function seedDraftFromState(postseason: CfpPostseasonState): SeedDraft[] {
    const seedFromBracket = new Map<number, string>();
    for (const slot of postseason.bracket) {
      if (slot.round !== "first_round") continue;
      if (slot.home_seed && slot.home_team_id) seedFromBracket.set(slot.home_seed, slot.home_team_id);
      if (slot.away_seed && slot.away_team_id) seedFromBracket.set(slot.away_seed, slot.away_team_id);
    }
    const top12ByRank = new Map(postseason.rankings.filter((r) => r.rank <= 12).map((r) => [r.rank, r.team_id]));
    return EMPTY_SEEDS.map((row) => ({ seed: row.seed, teamId: seedFromBracket.get(row.seed) ?? top12ByRank.get(row.seed) ?? "" }));
  }

  function load() {
    Promise.all([recApi.listScheduleTeams(guildId), recApi.getCfpPostseason(guildId)])
      .then(([teamResult, postseason]) => {
        setTeams(teamResult.teams);
        setState(postseason);
        const savedByRank = new Map(postseason.rankings.map((row) => [row.rank, row]));
        // Always keep all 25 slots visible so a top-12-only save can be extended to 13+ later.
        setTop25Draft(EMPTY_TOP25.map((row) => {
          const saved = savedByRank.get(row.rank);
          return saved ? { rank: row.rank, teamId: saved.team_id, conferenceChampion: saved.conference_champion } : row;
        }));
        setSeedDraft(seedDraftFromState(postseason));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load CFP setup."));
  }

  useEffect(load, [guildId]);

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);

  // ---- Top 25 poll ----
  const selectedTop25 = top25Draft.map((row) => row.teamId).filter(Boolean);
  const filledRanks = top25Draft.filter((row) => row.teamId).map((row) => row.rank).sort((a, b) => a - b);
  const top25Duplicates = new Set(selectedTop25).size !== selectedTop25.length;
  // The top-N must be contiguous (#1..#N) — same rule the API enforces.
  const top25Contiguous = filledRanks.length > 0 && filledRanks.every((rank, index) => rank === index + 1);
  const top25Complete = filledRanks.length >= 12 && !top25Duplicates && top25Contiguous;
  const top25Locked = state?.top25Locked ?? false;

  async function saveTop25() {
    setSavingTop25(true); setError(null);
    try {
      const submitted = top25Draft.filter((row) => row.teamId);
      setState(await recApi.saveCfpTop25({ guildId, rankings: submitted }));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save CFP rankings."); }
    finally { setSavingTop25(false); }
  }

  // ---- Bracket seeding ----
  const lockedSeeds = useMemo(() => {
    const locked = new Set<number>();
    if (!state) return locked;
    for (const slot of state.bracket) {
      if (slot.round !== "first_round" || slot.game_status !== "completed") continue;
      if (slot.home_seed) locked.add(slot.home_seed);
      if (slot.away_seed) locked.add(slot.away_seed);
    }
    return locked;
  }, [state]);

  const selectedSeedTeams = seedDraft.map((row) => row.teamId).filter(Boolean);
  const seedDuplicates = new Set(selectedSeedTeams).size !== selectedSeedTeams.length;
  const seedsComplete = seedDraft.every((row) => row.teamId) && !seedDuplicates;

  function resetSeedsFromTop25() {
    if (!state) return;
    const top12ByRank = new Map(state.rankings.filter((r) => r.rank <= 12).map((r) => [r.rank, r.team_id]));
    setSeedDraft(EMPTY_SEEDS.map((row) => ({ seed: row.seed, teamId: lockedSeeds.has(row.seed) ? seedDraft.find((s) => s.seed === row.seed)?.teamId ?? "" : top12ByRank.get(row.seed) ?? "" })));
  }

  async function saveSeeds() {
    setSavingSeeds(true); setError(null);
    try {
      const seeds = seedDraft.map((row) => ({ seed: row.seed, teamId: row.teamId }));
      setState(await recApi.generateCfpBracket({ guildId, seeds }));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the CFP bracket."); }
    finally { setSavingSeeds(false); }
  }

  const bracketExists = Boolean(state?.bracket.length);

  return <div>
    <PageHeader title="CFP Top 25 & Bracket" subtitle="Track the in-game CFP Top 25 poll, seed the 12-team playoff bracket, and manage bowls." />
    {error && <ErrorState message={error} />}
    {!state && !error ? <LoadingState label="Loading CFP postseason…" /> : null}

    <Card>
      <h2>CFP Top 25 poll</h2>
      <p className="form-hint">
        This is the in-game CFP Top 25 poll — enter it manually from the game's own rankings each week. Fill at least the
        top 12 so there's a full field to seed the bracket from; ranks 13–25 just round out the complete poll and flag
        conference champions. The poll locks once the league advances into the playoffs (Week 16) and becomes a
        historical record — seeding from here on happens in the bracket editor below, independently of this poll.
      </p>
      {top25Locked && (
        <div className="cfp-locked-banner">
          Locked — the league has advanced into the CFP first round. This poll is now a record of the final regular-season
          rankings and can no longer be edited.
        </div>
      )}
      <div className="cfp-top25-grid">
        {top25Draft.map((row, index) => <div className="cfp-ranking-row" key={row.rank}>
          <strong>#{row.rank}</strong>
          <select
            className="form-select"
            value={row.teamId}
            disabled={top25Locked}
            onChange={(event) => setTop25Draft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, teamId: event.target.value } : item))}
          >
            <option value="">Select team</option>
            {sortedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
          <label>
            <input
              type="checkbox"
              checked={row.conferenceChampion}
              disabled={top25Locked}
              onChange={(event) => setTop25Draft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, conferenceChampion: event.target.checked } : item))}
            /> Conf. champ
          </label>
        </div>)}
      </div>
      {top25Duplicates ? <p className="error-text">Each ranking must use a different team.</p> : null}
      {!top25Contiguous && filledRanks.length > 0 ? <p className="error-text">Rankings must be filled top-down — no gaps below the last ranked team.</p> : null}
      <div className="form-actions">
        <Button variant="primary" disabled={!top25Complete || savingTop25 || top25Locked} onClick={() => void saveTop25()}>
          {savingTop25 ? "Saving…" : "Save Rankings"}
        </Button>
      </div>
    </Card>

    <Card>
      <h2>Playoff bracket seeding</h2>
      <p className="form-hint">
        Assign a team to each of the 12 seeds — seeds 1–4 get byes; #5 hosts #12, #6 hosts #11, #7 hosts #10, #8 hosts
        #9. Defaults come from the Top 25's top 12, but you can reassign any seed independently of the poll. A seed
        locks once its first-round game has a recorded result — everything else stays editable, and the schedule
        updates automatically as later rounds are generated.
      </p>
      <div className="cfp-seed-grid">
        {seedDraft.map((row, index) => {
          const locked = lockedSeeds.has(row.seed);
          return <div className={`cfp-seed-row${locked ? " is-locked" : ""}`} key={row.seed}>
            <strong>#{row.seed}</strong>
            <select
              className="form-select"
              value={row.teamId}
              disabled={locked}
              onChange={(event) => setSeedDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, teamId: event.target.value } : item))}
            >
              <option value="">Select team</option>
              {sortedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            {locked && <span className="cfp-seed-lock-badge">Locked — game played</span>}
          </div>;
        })}
      </div>
      {seedDuplicates ? <p className="error-text">Each seed must use a different team.</p> : null}
      <div className="form-actions">
        <Button variant="primary" disabled={!seedsComplete || savingSeeds} onClick={() => void saveSeeds()}>
          {savingSeeds ? "Saving…" : bracketExists ? "Update Bracket" : "Generate Bracket"}
        </Button>
        <Button variant="secondary" disabled={savingSeeds || !state?.rankings.some((r) => r.rank <= 12)} onClick={resetSeedsFromTop25}>
          Reset from Top 25
        </Button>
      </div>
    </Card>

    {bracketExists ? <Card>
      <h2>12-team CFP bracket</h2>
      <div className="cfp-bracket">
        {(["first_round", "quarterfinal", "semifinal", "championship"] as const).map((round) => <section key={round}>
          <h3>{round.replaceAll("_", " ")}</h3>
          {state!.bracket.filter((slot) => slot.round === round).map((slot) => <article key={slot.slot_id ?? `${round}-${slot.slot_number}`}>
            <span>{slot.home_seed ? `#${slot.home_seed} ` : ""}{slot.home_team_name ?? "Winner TBD"}</span>
            <strong>vs</strong>
            <span>{slot.away_seed ? `#${slot.away_seed} ` : ""}{slot.away_team_name ?? "Winner TBD"}</span>
            {slot.game_status === "completed" ? <em>{slot.home_score}–{slot.away_score}</em> : null}
          </article>)}
        </section>)}
      </div>
      <p className="form-hint">First-round games and top-four byes are written to schedules immediately. Confirmed results lock their participants and automatically advance the winner into the next round's schedule.</p>
    </Card> : null}

    <HeismanRaceCard guildId={guildId} teams={sortedTeams} />

    <Card><h2>Bowl catalog</h2><p className="form-hint">{CFB_BOWL_NAMES.length - 1} real 2026–27 bowls are installed, plus Custom Bowl.</p></Card>
  </div>;
}
