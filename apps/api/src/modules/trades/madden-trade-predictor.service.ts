import { computeRecTeamPositionNeeds, type RecTeamPositionNeeds } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";

export const MADDEN_CPU_TRADE_PREDICTOR_VERSION = "madden-cpu-trade-v1.0.0";

export type MaddenTradeLegInput =
  | { type: "player"; playerId: string }
  | { type: "pick"; draftPickId: string };

export type MaddenTeamWindow = "rebuild" | "neutral" | "contend";
export type MaddenAcceptanceBand = "very_unlikely" | "unlikely" | "coin_flip" | "likely" | "very_likely";
export type MaddenPredictionConfidence = "low" | "medium";

export type MaddenTradeValueBreakdown = {
  id: string;
  type: "player" | "pick" | "coins";
  label: string;
  value: number;
  baseValue: number;
  modifiers: Record<string, number>;
};

export type MaddenCpuTradePrediction = {
  version: string;
  applicable: boolean;
  reason: string | null;
  cpuTeamId: string | null;
  cpuTeamName: string | null;
  humanTeamId: string | null;
  teamWindow: MaddenTeamWindow | null;
  tradeDifficulty: string;
  acceptanceProbability: number | null;
  acceptanceBand: MaddenAcceptanceBand | null;
  confidence: MaddenPredictionConfidence;
  confidenceScore: number;
  valueRatio: number | null;
  humanOfferValue: number | null;
  cpuRequiredValue: number | null;
  cpuOutgoingRawValue: number | null;
  difficultyMultiplier: number;
  retentionPremium: number;
  estimatedAdditionalValueNeeded: number | null;
  humanOfferBreakdown: MaddenTradeValueBreakdown[];
  cpuOutgoingBreakdown: MaddenTradeValueBreakdown[];
  reasons: string[];
  warnings: string[];
  evidenceBasis: string[];
};

type PlayerRow = {
  id: string;
  full_name: string | null;
  position: string | null;
  overall_rating: number | null;
  dev_trait: string | null;
  age: number | null;
  years_pro: number | null;
  contract_years_left: number | null;
  contract_salary: number | null;
  cap_hit: number | null;
};

type PickRow = {
  id: string;
  season_number: number;
  round: number;
  pick_number: number | null;
};

type TeamContext = {
  teamId: string;
  teamName: string;
  isCpu: boolean;
  window: MaddenTeamWindow;
  gamesPlayed: number;
  winPct: number | null;
  standingRank: number | null;
  playoffSeed: number | null;
  teamOvr: number | null;
  capRoom: number | null;
  salaryCapEnabled: boolean;
  needs: RecTeamPositionNeeds;
};

type ResolvedAssets = {
  players: PlayerRow[];
  picks: PickRow[];
  coins: number;
};

const POSITION_VALUE: Record<string, number> = {
  QB: 2.55,
  LE: 2.02, RE: 2.02,
  LOLB: 1.92, ROLB: 1.92,
  CB: 1.90,
  WR: 1.78,
  DT: 1.68,
  LT: 1.62, RT: 1.56,
  FS: 1.48, SS: 1.48,
  MLB: 1.40,
  TE: 1.32,
  HB: 1.25,
  LG: 1.10, RG: 1.10, C: 1.10,
  FB: 0.70,
  K: 0.50, P: 0.50,
};

const DEV_VALUE: Record<string, number> = {
  normal: 1,
  star: 1.08,
  superstar: 1.18,
  xfactor: 1.30,
  "x-factor": 1.30,
};

const DIFFICULTY_MULTIPLIER: Record<string, number> = {
  very_easy: 1.22,
  easy: 1.10,
  normal: 1,
  hard: 0.90,
  very_hard: 0.82,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeDifficulty(value: string | null | undefined) {
  const normalized = String(value ?? "normal").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized in DIFFICULTY_MULTIPLIER ? normalized : "normal";
}

function normalizedDev(value: string | null | undefined) {
  return String(value ?? "normal").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function basePlayerValue(overall: number) {
  const aboveReplacement = Math.max(0, overall - 58);
  return Math.pow(aboveReplacement, 1.82) * 0.108;
}

function resolvedAge(player: PlayerRow) {
  if (typeof player.age === "number" && player.age >= 18 && player.age <= 50) return { age: player.age, exact: true };
  const years = typeof player.years_pro === "number" ? player.years_pro : 3;
  return { age: 21 + Math.max(0, years), exact: false };
}

function ageFactor(position: string, age: number) {
  const p = position.toUpperCase();
  if (p === "QB") {
    if (age <= 25) return 1.08;
    if (age <= 29) return 1.10;
    if (age <= 32) return 1.03;
    if (age <= 35) return 0.90;
    return 0.72;
  }
  if (p === "HB" || p === "FB") {
    if (age <= 23) return 1.12;
    if (age <= 25) return 1.05;
    if (age === 26) return 0.94;
    if (age === 27) return 0.82;
    if (age === 28) return 0.70;
    return 0.56;
  }
  if (["WR", "CB", "FS", "SS"].includes(p)) {
    if (age <= 23) return 1.10;
    if (age <= 27) return 1.07;
    if (age <= 29) return 0.96;
    if (age <= 31) return 0.82;
    return 0.67;
  }
  if (p === "TE") {
    if (age <= 24) return 1.08;
    if (age <= 28) return 1.06;
    if (age <= 30) return 0.96;
    if (age <= 32) return 0.82;
    return 0.66;
  }
  if (["LT", "LG", "C", "RG", "RT"].includes(p)) {
    if (age <= 24) return 1.05;
    if (age <= 29) return 1.08;
    if (age <= 31) return 1.00;
    if (age <= 33) return 0.88;
    return 0.72;
  }
  if (["LE", "RE", "DT", "LOLB", "MLB", "ROLB"].includes(p)) {
    if (age <= 24) return 1.08;
    if (age <= 28) return 1.07;
    if (age <= 30) return 0.96;
    if (age <= 32) return 0.82;
    return 0.66;
  }
  if (p === "K" || p === "P") {
    if (age <= 30) return 1.02;
    if (age <= 34) return 1.00;
    if (age <= 38) return 0.90;
    return 0.76;
  }
  if (age <= 25) return 1.06;
  if (age <= 29) return 1.03;
  if (age <= 31) return 0.92;
  return 0.72;
}

function expectedCapHit(overall: number, position: string) {
  const p = position.toUpperCase();
  const premium = p === "QB" ? 1.75
    : ["LE", "RE", "LOLB", "ROLB"].includes(p) ? 1.28
    : p === "WR" ? 1.20
    : p === "CB" ? 1.12
    : ["LT", "RT"].includes(p) ? 1.08
    : p === "DT" ? 1.05
    : ["K", "P", "FB"].includes(p) ? 0.55
    : 0.92;
  const quality = clamp((overall - 64) / 32, 0.06, 1.10);
  return 30_000_000 * quality * quality * premium;
}

function contractFactor(player: PlayerRow, team: TeamContext) {
  const overall = player.overall_rating ?? 60;
  const position = player.position ?? "";
  let factor = 1;
  const years = player.contract_years_left;
  if (typeof years === "number") {
    if (years >= 4) factor *= 1.09;
    else if (years === 3) factor *= 1.06;
    else if (years === 2) factor *= 1.01;
    else if (years === 1) factor *= 0.91;
    else factor *= 0.82;
  }
  if (typeof player.cap_hit === "number" && player.cap_hit > 0) {
    const expected = expectedCapHit(overall, position);
    const efficiency = clamp((expected - player.cap_hit) / Math.max(expected, 1), -1, 1);
    factor *= clamp(1 + efficiency * 0.16, 0.84, 1.16);
    if (team.salaryCapEnabled && typeof team.capRoom === "number" && team.capRoom >= 0 && player.cap_hit > team.capRoom) {
      factor *= 0.78;
    }
  }
  const age = resolvedAge(player).age;
  if ((player.years_pro ?? 99) <= 3 && age <= 25 && (player.contract_years_left ?? 0) >= 2) factor *= 1.05;
  return clamp(factor, 0.64, 1.24);
}

function needFactor(team: TeamContext, position: string) {
  const need = team.needs[position.toUpperCase()] ?? 0.5;
  return 0.88 + need * 0.34;
}

function windowPlayerFactor(team: TeamContext, player: PlayerRow, direction: "acquire" | "retain") {
  const overall = player.overall_rating ?? 60;
  const age = resolvedAge(player).age;
  if (team.window === "contend") {
    if (overall >= 88) return direction === "retain" ? 1.08 : 1.10;
    if (overall >= 82) return 1.06;
    if (age <= 24 && overall < 78) return 0.96;
    return 1.01;
  }
  if (team.window === "rebuild") {
    if (age <= 24) return overall >= 80 ? 1.12 : 1.07;
    if (age <= 27) return 1.02;
    if (age >= 31) return 0.82;
    if (age >= 29) return 0.90;
    return 0.97;
  }
  return 1;
}

function playerRetentionPremium(player: PlayerRow, team: TeamContext) {
  const overall = player.overall_rating ?? 60;
  const age = resolvedAge(player).age;
  const dev = normalizedDev(player.dev_trait);
  const p = (player.position ?? "").toUpperCase();
  let premium = 1;
  if (overall >= 95) premium *= 1.16;
  else if (overall >= 92) premium *= 1.12;
  else if (overall >= 88) premium *= 1.07;
  if (p === "QB" && overall >= 84) premium *= 1.08;
  if (age <= 25 && ["superstar", "xfactor", "x-factor"].includes(dev)) premium *= 1.06;
  const need = team.needs[p] ?? 0.5;
  if (need >= 0.75) premium *= 1.05;
  return clamp(premium, 1, 1.34);
}

function playerValue(player: PlayerRow, team: TeamContext, direction: "acquire" | "retain") {
  const overall = clamp(player.overall_rating ?? 60, 40, 99);
  const position = String(player.position ?? "").toUpperCase();
  const ageInfo = resolvedAge(player);
  const base = basePlayerValue(overall);
  const positionMultiplier = POSITION_VALUE[position] ?? 1.2;
  const devMultiplier = DEV_VALUE[normalizedDev(player.dev_trait)] ?? 1;
  const ageMultiplier = ageFactor(position, ageInfo.age);
  const contractMultiplier = contractFactor(player, team);
  const needMultiplier = needFactor(team, position);
  const windowMultiplier = windowPlayerFactor(team, player, direction);
  const value = base * positionMultiplier * devMultiplier * ageMultiplier * contractMultiplier * needMultiplier * windowMultiplier;
  return {
    value,
    exactAge: ageInfo.exact,
    breakdown: {
      id: player.id,
      type: "player" as const,
      label: `${position || "?"} ${player.full_name ?? "Player"}`,
      value: round(value),
      baseValue: round(base),
      modifiers: {
        position: round(positionMultiplier, 3),
        development: round(devMultiplier, 3),
        age: round(ageMultiplier, 3),
        contract: round(contractMultiplier, 3),
        teamNeed: round(needMultiplier, 3),
        competitiveWindow: round(windowMultiplier, 3),
      },
    },
  };
}

function pickBaseValue(pick: PickRow, teamsInLeague: number) {
  const teams = Math.max(1, teamsInLeague);
  const overallPick = pick.pick_number == null
    ? (pick.round - 1) * teams + Math.ceil(teams / 2)
    : (pick.round - 1) * teams + pick.pick_number;
  return Math.max(3, 150 * Math.exp(-0.025 * Math.max(0, overallPick - 1)));
}

function pickWindowFactor(window: MaddenTeamWindow, direction: "acquire" | "retain") {
  if (window === "rebuild") return direction === "retain" ? 1.12 : 1.10;
  if (window === "contend") return direction === "retain" ? 0.93 : 0.95;
  return 1;
}

function pickValue(pick: PickRow, team: TeamContext, currentSeason: number, teamsInLeague: number, direction: "acquire" | "retain") {
  const base = pickBaseValue(pick, teamsInLeague);
  const yearsOut = Math.max(0, pick.season_number - currentSeason);
  const futureMultiplier = yearsOut <= 0 ? 1 : yearsOut === 1 ? 0.88 : yearsOut === 2 ? 0.78 : 0.70;
  const windowMultiplier = pickWindowFactor(team.window, direction);
  const value = base * futureMultiplier * windowMultiplier;
  return {
    value,
    exactSlot: pick.pick_number != null,
    breakdown: {
      id: pick.id,
      type: "pick" as const,
      label: `S${pick.season_number} R${pick.round}${pick.pick_number != null ? ` #${pick.pick_number}` : " (projected mid-round)"}`,
      value: round(value),
      baseValue: round(base),
      modifiers: {
        futureYear: round(futureMultiplier, 3),
        competitiveWindow: round(windowMultiplier, 3),
      },
    },
  };
}

function probabilityForRatio(ratio: number) {
  // 50% is intentionally just above 1.00 because Madden's reciprocity logic often asks for a
  // modest surplus when the CPU is surrendering a scarce/elite asset. The retention premium is
  // already applied separately; this curve only turns the remaining ratio into an uncertainty band.
  const raw = 1 / (1 + Math.exp(-11 * (ratio - 1.025)));
  return clamp(raw, 0.01, 0.99);
}

function bandForProbability(probability: number): MaddenAcceptanceBand {
  if (probability < 0.15) return "very_unlikely";
  if (probability < 0.40) return "unlikely";
  if (probability < 0.60) return "coin_flip";
  if (probability < 0.85) return "likely";
  return "very_likely";
}

async function resolveAssets(leagueId: string, legs: MaddenTradeLegInput[], coins: number): Promise<ResolvedAssets> {
  const playerIds = legs.filter((leg): leg is { type: "player"; playerId: string } => leg.type === "player").map((leg) => leg.playerId);
  const pickIds = legs.filter((leg): leg is { type: "pick"; draftPickId: string } => leg.type === "pick").map((leg) => leg.draftPickId);
  const [players, picks] = await Promise.all([
    playerIds.length
      ? supabase.from("rec_players")
        .select("id,full_name,position,overall_rating,dev_trait,age,years_pro,contract_years_left,contract_salary,cap_hit")
        .eq("league_id", leagueId).in("id", playerIds)
      : Promise.resolve({ data: [] as PlayerRow[], error: null }),
    pickIds.length
      ? supabase.from("rec_draft_picks")
        .select("id,season_number,round,pick_number")
        .eq("league_id", leagueId).in("id", pickIds)
      : Promise.resolve({ data: [] as PickRow[], error: null }),
  ]);
  if (players.error) throw new ApiError(500, "We couldn't load players for the Madden trade predictor.", players.error);
  if (picks.error) throw new ApiError(500, "We couldn't load draft picks for the Madden trade predictor.", picks.error);
  return { players: (players.data ?? []) as PlayerRow[], picks: (picks.data ?? []) as PickRow[], coins: Math.max(0, coins) };
}

async function teamContext(leagueId: string, seasonNumber: number, teamId: string, salaryCapEnabled: boolean): Promise<TeamContext> {
  const [team, assignment, roster, standing] = await Promise.all([
    supabase.from("rec_teams").select("name,display_city,display_nick,team_overall").eq("league_id", leagueId).eq("id", teamId).maybeSingle(),
    supabase.from("rec_team_assignments").select("user_id").eq("league_id", leagueId).eq("team_id", teamId)
      .eq("assignment_status", "active").is("ended_at", null).limit(1).maybeSingle(),
    supabase.from("rec_players").select("position,overall_rating").eq("league_id", leagueId).eq("team_id", teamId).eq("roster_status", "active"),
    supabase.from("rec_team_standings_snapshots")
      .select("total_wins,total_losses,total_ties,win_pct,standing_rank,playoff_seed,team_ovr,cap_room,week_number,season_index")
      .eq("league_id", leagueId).eq("team_id", teamId).eq("season_number", seasonNumber)
      .order("season_index", { ascending: false }).order("week_number", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (team.error) throw new ApiError(500, "We couldn't load a team for the Madden trade predictor.", team.error);
  if (assignment.error) throw new ApiError(500, "We couldn't determine whether that team is CPU-controlled.", assignment.error);
  if (roster.error) throw new ApiError(500, "We couldn't load a roster for the Madden trade predictor.", roster.error);
  if (standing.error) throw new ApiError(500, "We couldn't load standings for the Madden trade predictor.", standing.error);

  const row: any = standing.data ?? {};
  const wins = Number(row.total_wins ?? 0);
  const losses = Number(row.total_losses ?? 0);
  const ties = Number(row.total_ties ?? 0);
  const gamesPlayed = wins + losses + ties;
  const winPct = row.win_pct == null ? (gamesPlayed ? (wins + ties * 0.5) / gamesPlayed : null) : Number(row.win_pct);
  const standingRank = row.standing_rank == null ? null : Number(row.standing_rank);
  const playoffSeed = row.playoff_seed == null ? null : Number(row.playoff_seed);
  const teamOvr = row.team_ovr == null ? (team.data?.team_overall == null ? null : Number(team.data.team_overall)) : Number(row.team_ovr);
  let window: MaddenTeamWindow = "neutral";
  if (gamesPlayed >= 4) {
    if ((playoffSeed != null && playoffSeed >= 1 && playoffSeed <= 7) || (winPct != null && winPct >= 0.60) || (standingRank != null && standingRank <= 10)) {
      window = "contend";
    } else if ((winPct != null && winPct <= 0.40) && (standingRank == null || standingRank >= 20)) {
      window = "rebuild";
    }
  }
  const teamName = team.data?.name
    ?? [team.data?.display_city, team.data?.display_nick].filter(Boolean).join(" ")
    ?? "CPU Team";
  const needs = computeRecTeamPositionNeeds((roster.data ?? []).map((player: any) => ({
    position: String(player.position ?? ""), overallRating: Number(player.overall_rating ?? 60),
  })));
  return {
    teamId,
    teamName,
    isCpu: !assignment.data?.user_id,
    window,
    gamesPlayed,
    winPct,
    standingRank,
    playoffSeed,
    teamOvr,
    capRoom: row.cap_room == null ? null : Number(row.cap_room),
    salaryCapEnabled,
    needs,
  };
}

function summarizeReasons(input: {
  cpu: TeamContext;
  difficulty: string;
  difficultyMultiplier: number;
  humanPlayers: PlayerRow[];
  cpuPlayers: PlayerRow[];
  ratio: number;
}) {
  const reasons: string[] = [];
  if (input.cpu.window === "rebuild") reasons.push("CPU profile: rebuilding — younger players and draft capital receive extra weight.");
  else if (input.cpu.window === "contend") reasons.push("CPU profile: contender — immediate-impact veterans receive extra weight and picks are discounted slightly.");
  else reasons.push("CPU profile: neutral — no strong contender/rebuild adjustment is being applied.");
  if (input.difficultyMultiplier < 1) reasons.push(`Trade difficulty (${input.difficulty.replace(/_/g, " ")}) devalues the user's package in the prediction.`);
  else if (input.difficultyMultiplier > 1) reasons.push(`Trade difficulty (${input.difficulty.replace(/_/g, " ")}) increases the user's package value in the prediction.`);
  const eliteOutgoing = input.cpuPlayers.find((player) => (player.overall_rating ?? 0) >= 90);
  if (eliteOutgoing) reasons.push(`${eliteOutgoing.full_name ?? "The CPU's outgoing star"} triggers an elite-asset retention premium.`);
  const youngPremiumIncoming = input.humanPlayers.find((player) => resolvedAge(player).age <= 24 && ["superstar", "xfactor", "x-factor"].includes(normalizedDev(player.dev_trait)));
  if (youngPremiumIncoming) reasons.push(`${youngPremiumIncoming.full_name ?? "A young incoming player"} receives extra value for age plus development trait.`);
  if (input.ratio >= 1.10) reasons.push("The adjusted offer clears the modeled CPU requirement by a meaningful margin.");
  else if (input.ratio < 0.90) reasons.push("The adjusted offer remains materially below the modeled CPU requirement.");
  else reasons.push("The package is near the modeled acceptance boundary, where Madden-specific hidden logic matters most.");
  return reasons.slice(0, 5);
}

export async function getMaddenCpuTradePrediction(guildId: string, input: {
  proposingTeamId: string;
  receivingTeamId: string;
  offeredLegs: MaddenTradeLegInput[];
  requestedLegs: MaddenTradeLegInput[];
  offeredCoins: number;
  requestedCoins: number;
}): Promise<MaddenCpuTradePrediction> {
  const context = await getCurrentLeagueContext(guildId);
  if (!String(context.league.game ?? "").startsWith("madden")) {
    throw new ApiError(400, "The Madden CPU trade predictor is available for Madden leagues only.");
  }
  const leagueId = context.leagueId;
  const seasonNumber = resolveSeasonNumber(context);
  const [config, teamCount] = await Promise.all([
    supabase.from("rec_league_configuration").select("trade_difficulty,salary_cap_enabled").eq("league_id", leagueId).maybeSingle(),
    supabase.from("rec_teams").select("id", { count: "exact", head: true }).eq("league_id", leagueId),
  ]);
  if (config.error) throw new ApiError(500, "We couldn't load trade difficulty for the Madden predictor.", config.error);
  const salaryCapEnabled = Boolean(config.data?.salary_cap_enabled ?? true);
  const [proposingTeam, receivingTeam] = await Promise.all([
    teamContext(leagueId, seasonNumber, input.proposingTeamId, salaryCapEnabled),
    teamContext(leagueId, seasonNumber, input.receivingTeamId, salaryCapEnabled),
  ]);
  const cpuSides = [proposingTeam, receivingTeam].filter((team) => team.isCpu);
  const difficulty = normalizeDifficulty(config.data?.trade_difficulty);
  const difficultyMultiplier = DIFFICULTY_MULTIPLIER[difficulty] ?? 1;
  const evidenceBasis = [
    "EA-documented player-value inputs: OVR, position, development, age curves, contracts, team need and competitive window.",
    "EA-documented trade-difficulty behavior: user packages are devalued on harder settings and increased on easier settings.",
    "Public Madden/community trade calculators and draft-value curves provide numerical priors where EA does not publish coefficients.",
  ];

  if (cpuSides.length !== 1) {
    return {
      version: MADDEN_CPU_TRADE_PREDICTOR_VERSION,
      applicable: false,
      reason: cpuSides.length === 0 ? "Both teams are user-controlled; CPU acceptance prediction does not apply." : "Both teams are CPU-controlled; this calculator predicts user-to-CPU acceptance only.",
      cpuTeamId: null, cpuTeamName: null, humanTeamId: null, teamWindow: null,
      tradeDifficulty: difficulty, acceptanceProbability: null, acceptanceBand: null,
      confidence: "low", confidenceScore: 0.45, valueRatio: null, humanOfferValue: null,
      cpuRequiredValue: null, cpuOutgoingRawValue: null, difficultyMultiplier,
      retentionPremium: 1, estimatedAdditionalValueNeeded: null,
      humanOfferBreakdown: [], cpuOutgoingBreakdown: [], reasons: [], warnings: [], evidenceBasis,
    };
  }

  const cpu = cpuSides[0]!;
  const cpuIsReceivingTeam = cpu.teamId === receivingTeam.teamId;
  const human = cpuIsReceivingTeam ? proposingTeam : receivingTeam;
  const humanLegs = cpuIsReceivingTeam ? input.offeredLegs : input.requestedLegs;
  const humanCoins = cpuIsReceivingTeam ? input.offeredCoins : input.requestedCoins;
  const cpuLegs = cpuIsReceivingTeam ? input.requestedLegs : input.offeredLegs;
  const cpuCoins = cpuIsReceivingTeam ? input.requestedCoins : input.offeredCoins;
  const [humanAssets, cpuAssets] = await Promise.all([
    resolveAssets(leagueId, humanLegs, humanCoins),
    resolveAssets(leagueId, cpuLegs, cpuCoins),
  ]);
  const teamsInLeague = teamCount.count ?? 32;
  const humanBreakdown: MaddenTradeValueBreakdown[] = [];
  const cpuBreakdown: MaddenTradeValueBreakdown[] = [];
  let humanRaw = 0;
  let cpuRaw = 0;
  let exactAgeCount = 0;
  let ageCount = 0;
  let exactPickCount = 0;
  let pickCount = 0;

  for (const player of humanAssets.players) {
    const valued = playerValue(player, cpu, "acquire");
    humanRaw += valued.value;
    humanBreakdown.push(valued.breakdown);
    ageCount += 1;
    if (valued.exactAge) exactAgeCount += 1;
  }
  for (const pick of humanAssets.picks) {
    const valued = pickValue(pick, cpu, seasonNumber, teamsInLeague, "acquire");
    humanRaw += valued.value;
    humanBreakdown.push(valued.breakdown);
    pickCount += 1;
    if (valued.exactSlot) exactPickCount += 1;
  }
  if (humanAssets.coins > 0) {
    const value = humanAssets.coins / 1000;
    humanRaw += value;
    humanBreakdown.push({ id: "human-coins", type: "coins", label: `${humanAssets.coins.toLocaleString()} coins`, value: round(value), baseValue: round(value), modifiers: {} });
  }

  let retentionWeighted = 0;
  for (const player of cpuAssets.players) {
    const valued = playerValue(player, cpu, "retain");
    const retention = playerRetentionPremium(player, cpu);
    cpuRaw += valued.value;
    retentionWeighted += valued.value * retention;
    cpuBreakdown.push({ ...valued.breakdown, value: round(valued.value * retention), modifiers: { ...valued.breakdown.modifiers, retentionPremium: round(retention, 3) } });
    ageCount += 1;
    if (valued.exactAge) exactAgeCount += 1;
  }
  for (const pick of cpuAssets.picks) {
    const valued = pickValue(pick, cpu, seasonNumber, teamsInLeague, "retain");
    cpuRaw += valued.value;
    retentionWeighted += valued.value;
    cpuBreakdown.push(valued.breakdown);
    pickCount += 1;
    if (valued.exactSlot) exactPickCount += 1;
  }
  if (cpuAssets.coins > 0) {
    const value = cpuAssets.coins / 1000;
    cpuRaw += value;
    retentionWeighted += value;
    cpuBreakdown.push({ id: "cpu-coins", type: "coins", label: `${cpuAssets.coins.toLocaleString()} coins`, value: round(value), baseValue: round(value), modifiers: {} });
  }

  const retentionPremium = cpuRaw > 0 ? retentionWeighted / cpuRaw : 1;
  const adjustedHumanOffer = humanRaw * difficultyMultiplier;
  const cpuRequired = Math.max(retentionWeighted, 0.01);
  const ratio = adjustedHumanOffer / cpuRequired;
  const probability = probabilityForRatio(ratio);
  const additionalNeeded = Math.max(0, cpuRequired - adjustedHumanOffer) / Math.max(difficultyMultiplier, 0.01);

  let confidenceScore = 0.58;
  if (cpu.gamesPlayed >= 4) confidenceScore += 0.05;
  if (ageCount === 0 || exactAgeCount === ageCount) confidenceScore += 0.05;
  if (pickCount === 0 || exactPickCount === pickCount) confidenceScore += 0.04;
  if (difficulty === "normal") confidenceScore += 0.02;
  confidenceScore = clamp(confidenceScore, 0.45, 0.74);
  const warnings: string[] = [
    "EA does not publish Madden's exact trade-acceptance coefficients; this is an evidence-backed prediction, not an emulator of the closed game code.",
  ];
  if (cpu.gamesPlayed < 4) warnings.push("Competitive-window confidence is reduced before four games are played; the CPU team is treated as neutral.");
  if (ageCount > exactAgeCount) warnings.push("One or more players are missing imported age; those ages were estimated from years of experience.");
  if (pickCount > exactPickCount) warnings.push("One or more future picks do not have an exact slot yet and were valued at the middle of their round.");
  if (difficulty !== "normal") warnings.push("The exact numeric trade-difficulty multiplier is not public; the selected setting uses a conservative prior that should be recalibrated from observed REC results.");

  return {
    version: MADDEN_CPU_TRADE_PREDICTOR_VERSION,
    applicable: true,
    reason: null,
    cpuTeamId: cpu.teamId,
    cpuTeamName: cpu.teamName,
    humanTeamId: human.teamId,
    teamWindow: cpu.window,
    tradeDifficulty: difficulty,
    acceptanceProbability: Math.round(probability * 100),
    acceptanceBand: bandForProbability(probability),
    confidence: confidenceScore >= 0.56 ? "medium" : "low",
    confidenceScore: round(confidenceScore, 2),
    valueRatio: round(ratio, 3),
    humanOfferValue: round(adjustedHumanOffer),
    cpuRequiredValue: round(cpuRequired),
    cpuOutgoingRawValue: round(cpuRaw),
    difficultyMultiplier: round(difficultyMultiplier, 3),
    retentionPremium: round(retentionPremium, 3),
    estimatedAdditionalValueNeeded: round(additionalNeeded),
    humanOfferBreakdown: humanBreakdown,
    cpuOutgoingBreakdown: cpuBreakdown,
    reasons: summarizeReasons({ cpu, difficulty, difficultyMultiplier, humanPlayers: humanAssets.players, cpuPlayers: cpuAssets.players, ratio }),
    warnings,
    evidenceBasis,
  };
}
