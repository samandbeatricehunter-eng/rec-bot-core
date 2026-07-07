import { regularSeasonWeeks } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";

// ─── Tunable SOS constants ─────────────────────────────────────────────────────
// SOS = Σ over each scheduled game (repeats counted): typeWeight(opp) × quality(opp)
//   typeWeight = 1.0 human / 0.5 CPU
//   quality    = clamp(1 + K_W·(effWinPct − .5) + K_D·normPD, QUALITY_MIN, QUALITY_MAX)
//   effWinPct  = shrinkage blend of this-season win% with a small prior-season prior
//   normPD     = clamp(avg point differential / DOMINANCE_SCALE, −1, 1) — this season only
const K_W = 0.5;             // win% weight
const K_D = 0.25;            // point-differential weight
const DOMINANCE_SCALE = 14;  // avg margin (pts/game) treated as max dominance
const PRIOR_WEIGHT = 3;      // prior-season "pseudo-games" (small; fades as games are played)
const K_M = 0.2;             // momentum (recent form) weight
const QUALITY_MIN = 0.5;
const QUALITY_MAX = 1.5;

// Recent-form adjustment from a team's current streak: 0 until a 2-game streak,
// ramping linearly to ±1 at a 5+ game streak. Positive = hot (win streak),
// negative = cold (loss streak).
function momentumAdj(streak: number): number {
  const mag = Math.abs(streak);
  if (mag < 2) return 0;
  return Math.sign(streak) * (Math.min(mag - 1, 4) / 4);
}

type TeamRecord = { wins: number; losses: number; ties: number; pf: number; pa: number; scored: number };
const emptyRecord = (): TeamRecord => ({ wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, scored: 0 });
const gamesPlayed = (r: TeamRecord) => r.wins + r.losses + r.ties;
const winPct = (r: TeamRecord) => (gamesPlayed(r) > 0 ? (r.wins + 0.5 * r.ties) / gamesPlayed(r) : 0.5);
const avgPointDiff = (r: TeamRecord) => (r.scored > 0 ? (r.pf - r.pa) / r.scored : 0);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

function teamDisplayName(t: any): string {
  if (t?.is_relocated && (t.display_city || t.display_nick)) {
    return `${t.display_city ?? ""} ${t.display_nick ?? ""}`.trim() || (t.name ?? "Team");
  }
  return t?.name ?? "Team";
}

function matchupKey(week: number | null | undefined, a: string, b: string): string {
  return `${week ?? 0}:${[a, b].sort().join("-")}`;
}

// Aggregate per-team W/L/T and points for/against for one league season from the
// unified game-results ledger (covers both box-score and commissioner-advance games).
async function loadTeamRecords(leagueId: string, seasonNumber: number): Promise<Map<string, TeamRecord>> {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("home_team_id,away_team_id,home_score,away_score,winning_team_id,losing_team_id,is_tie")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);
  if (error) throw new ApiError(500, "Failed to load game results for SOS.", error);

  const map = new Map<string, TeamRecord>();
  const rec = (id: string) => {
    let r = map.get(id);
    if (!r) { r = emptyRecord(); map.set(id, r); }
    return r;
  };

  for (const g of data ?? []) {
    const { home_team_id: h, away_team_id: a, home_score: hs, away_score: as_, winning_team_id: w, losing_team_id: l, is_tie } = g as any;
    if (is_tie) {
      if (h) rec(h).ties++;
      if (a) rec(a).ties++;
    } else {
      if (w) rec(w).wins++;
      if (l) rec(l).losses++;
    }
    if (hs != null && as_ != null) {
      if (h) { const r = rec(h); r.pf += hs; r.pa += as_; r.scored++; }
      if (a) { const r = rec(a); r.pf += as_; r.pa += hs; r.scored++; }
    }
  }
  return map;
}

// Each team's current win/loss streak (signed: + win streak, − loss streak),
// from the chronological game-results sequence. Ties end a streak.
async function loadTeamStreaks(leagueId: string, seasonNumber: number): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("week_number,winning_team_id,losing_team_id,home_team_id,away_team_id,is_tie")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("week_number", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load streaks for SOS.", error);

  const seq = new Map<string, ("W" | "L" | "T")[]>();
  const push = (id: string | null, r: "W" | "L" | "T") => {
    if (!id) return;
    const a = seq.get(id) ?? [];
    a.push(r);
    seq.set(id, a);
  };
  for (const g of data ?? []) {
    const { winning_team_id: w, losing_team_id: l, home_team_id: h, away_team_id: a, is_tie } = g as any;
    if (is_tie) { push(h, "T"); push(a, "T"); }
    else { push(w, "W"); push(l, "L"); }
  }

  const streaks = new Map<string, number>();
  for (const [id, results] of seq) {
    let streak = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      const r = results[i];
      if (r === "T") break;
      if (streak === 0) streak = r === "W" ? 1 : -1;
      else if (streak > 0 && r === "W") streak++;
      else if (streak < 0 && r === "L") streak--;
      else break;
    }
    streaks.set(id, streak);
  }
  return streaks;
}

// Scheduled matchups (this season) that already have a logged result, so SOS can
// split full-season from remaining-games.
async function loadPlayedMatchupKeys(leagueId: string, seasonNumber: number): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("rec_game_results")
    .select("week_number,home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);
  if (error) throw new ApiError(500, "Failed to load played games for SOS.", error);
  const keys = new Set<string>();
  for (const r of data ?? []) {
    if (r.home_team_id && r.away_team_id) keys.add(matchupKey(r.week_number, r.home_team_id, r.away_team_id));
  }
  return keys;
}

export type SosTeamRow = {
  teamId: string;
  teamName: string;
  abbr: string | null;
  isHuman: boolean;
  rank: number;
  sosFull: number;
  sosRemaining: number;
  sosFullPerGame: number;
  gamesScheduled: number;
  gamesRemaining: number;
  humanCount: number;
  cpuCount: number;
  oppRecord: number; // aggregate win% of all scheduled opponents (this season)
};

export async function computeLeagueSos(guildId: string, viewerDiscordId?: string | null) {
  const context = await getCurrentLeagueContext(guildId);
  const leagueId = context.leagueId;
  const currentSeason = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const seasonId = await resolveSeasonId(leagueId, currentSeason);

  const [teamsRes, assignmentsRes, gamesRes] = await Promise.all([
    supabase
      .from("rec_teams")
      .select("id,name,abbreviation,display_abbr,display_city,display_nick,is_relocated")
      .eq("league_id", leagueId),
    supabase
      .from("rec_team_assignments")
      .select("team_id,user_id")
      .eq("league_id", leagueId)
      .eq("assignment_status", "active")
      .is("ended_at", null),
    supabase
      .from("rec_games")
      .select("week_number,home_team_id,away_team_id")
      .eq("league_id", leagueId)
      .eq("season_id", seasonId)
      .lte("week_number", regularSeasonWeeks(context.rec_leagues.game)),
  ]);
  if (teamsRes.error) throw new ApiError(500, "Failed to load teams for SOS.", teamsRes.error);
  if (assignmentsRes.error) throw new ApiError(500, "Failed to load assignments for SOS.", assignmentsRes.error);
  if (gamesRes.error) throw new ApiError(500, "Failed to load schedule for SOS.", gamesRes.error);

  const teams = teamsRes.data ?? [];
  const humanTeamIds = new Set((assignmentsRes.data ?? []).map((r) => r.team_id).filter(Boolean));
  const userIdByTeam = new Map((assignmentsRes.data ?? []).map((r) => [r.team_id, r.user_id]));

  const hasPrior = currentSeason > 1;
  const [currentRecords, priorRecords, playedKeys, streaks] = await Promise.all([
    loadTeamRecords(leagueId, currentSeason),
    hasPrior ? loadTeamRecords(leagueId, currentSeason - 1) : Promise.resolve(new Map<string, TeamRecord>()),
    loadPlayedMatchupKeys(leagueId, currentSeason),
    loadTeamStreaks(leagueId, currentSeason),
  ]);

  const typeWeight = (oppId: string) => (humanTeamIds.has(oppId) ? 1.0 : 0.5);
  const quality = (oppId: string) => {
    const cur = currentRecords.get(oppId) ?? emptyRecord();
    const gp = gamesPlayed(cur);
    let eff = winPct(cur);
    if (hasPrior) {
      const prior = priorRecords.get(oppId);
      if (prior && gamesPlayed(prior) > 0) {
        eff = (gp * winPct(cur) + PRIOR_WEIGHT * winPct(prior)) / (gp + PRIOR_WEIGHT);
      }
    }
    const normPd = clamp(avgPointDiff(cur) / DOMINANCE_SCALE, -1, 1);
    const momentum = momentumAdj(streaks.get(oppId) ?? 0);
    return clamp(1 + K_W * (eff - 0.5) + K_D * normPd + K_M * momentum, QUALITY_MIN, QUALITY_MAX);
  };

  type Acc = { full: number; remaining: number; games: number; remGames: number; human: number; cpu: number; oppW: number; oppGp: number };
  const acc = new Map<string, Acc>();
  const getAcc = (id: string) => {
    let a = acc.get(id);
    if (!a) { a = { full: 0, remaining: 0, games: 0, remGames: 0, human: 0, cpu: 0, oppW: 0, oppGp: 0 }; acc.set(id, a); }
    return a;
  };

  for (const g of gamesRes.data ?? []) {
    const h = g.home_team_id;
    const a = g.away_team_id;
    if (!h || !a) continue;
    const played = playedKeys.has(matchupKey(g.week_number, h, a));
    for (const [teamId, oppId] of [[h, a], [a, h]] as [string, string][]) {
      const acu = getAcc(teamId);
      const term = typeWeight(oppId) * quality(oppId);
      acu.full += term;
      acu.games++;
      if (humanTeamIds.has(oppId)) acu.human++; else acu.cpu++;
      const oppCur = currentRecords.get(oppId) ?? emptyRecord();
      acu.oppW += oppCur.wins + 0.5 * oppCur.ties;
      acu.oppGp += gamesPlayed(oppCur);
      if (!played) { acu.remaining += term; acu.remGames++; }
    }
  }

  const rows: SosTeamRow[] = teams.map((t) => {
    const a = acc.get(t.id);
    return {
      teamId: t.id,
      teamName: teamDisplayName(t),
      abbr: t.display_abbr ?? t.abbreviation ?? null,
      isHuman: humanTeamIds.has(t.id),
      rank: 0,
      sosFull: round(a?.full ?? 0, 2),
      sosRemaining: round(a?.remaining ?? 0, 2),
      sosFullPerGame: a && a.games > 0 ? round(a.full / a.games, 3) : 0,
      gamesScheduled: a?.games ?? 0,
      gamesRemaining: a?.remGames ?? 0,
      humanCount: a?.human ?? 0,
      cpuCount: a?.cpu ?? 0,
      oppRecord: a && a.oppGp > 0 ? round(a.oppW / a.oppGp, 3) : 0.5,
    };
  });

  // Rank by full-season SOS (1 = toughest); break ties by opponent record then name.
  rows.sort((x, y) => y.sosFull - x.sosFull || y.oppRecord - x.oppRecord || x.teamName.localeCompare(y.teamName));
  rows.forEach((r, i) => { r.rank = i + 1; });

  let viewerTeamId: string | null = null;
  if (viewerDiscordId) {
    const acct = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", viewerDiscordId).maybeSingle();
    const userId = acct.data?.user_id ?? null;
    if (userId) {
      for (const [teamId, uId] of userIdByTeam.entries()) {
        if (uId === userId) { viewerTeamId = teamId; break; }
      }
    }
  }

  return {
    league: { id: leagueId, name: context.rec_leagues.name ?? null },
    currentSeason,
    currentWeek,
    hasPrior,
    scheduleLogged: (gamesRes.data ?? []).length > 0,
    totalTeams: rows.length,
    viewerTeamId,
    teams: rows,
  };
}
