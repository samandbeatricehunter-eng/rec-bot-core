import {
  WAGER_MARKET_BY_KEY,
  WAGER_MARKETS,
  marketsForGame,
  moneylineOddsFromProb,
  spreadOrTotalOdds,
  type WagerMarket,
} from "@rec/shared";

export type TournamentBoxScoreSide = {
  totalYards?: number | null;
  rushYards?: number | null;
  passYards?: number | null;
  turnovers?: number | null;
  redzoneOff?: number | null;
  redzoneDef?: number | null;
};

export type TournamentBoxScore = {
  home?: TournamentBoxScoreSide | null;
  away?: TournamentBoxScoreSide | null;
};

const HOME_FIELD_ADVANTAGE = 3;
const MAX_SPREAD = 24;
const MIN_TURNOVER_LINE = 1;
const LEAGUE_BASELINE = {
  points: 24,
  total_yards: 350,
  rush_yards: 120,
  pass_yards: 230,
  turnovers: 1.5,
  redzone_off: 55,
  redzone_def: 55,
};

export type TournamentWagerSide = { pick: string; label: string; odds: number };
export type TournamentWagerMarketOption = {
  market: string;
  label: string;
  kind: WagerMarket["kind"];
  line: number | null;
  unit?: string;
  sides: TournamentWagerSide[];
};

export type TournamentMatchWagerOptions = {
  matchId: string;
  homeUserId: string;
  awayUserId: string;
  homeLabel: string;
  awayLabel: string;
  humanInvolved: true;
  bettingOpen: boolean;
  markets: TournamentWagerMarketOption[];
};

function clamp01(n: number) {
  return Math.max(0.05, Math.min(0.95, n));
}

function clampSpread(n: number) {
  return Math.max(-MAX_SPREAD, Math.min(MAX_SPREAD, Math.round(n * 2) / 2));
}

function winRate(record: { wins: number; losses: number } | null) {
  const wins = Number(record?.wins ?? 0);
  const losses = Number(record?.losses ?? 0);
  return (wins + 1) / (wins + losses + 2);
}

function rating(record: { wins: number; losses: number; pointDifferential: number } | null) {
  const pd = Number(record?.pointDifferential ?? 0);
  return winRate(record) * 40 + Math.tanh(pd / 80) * 8;
}

export function buildTournamentMatchWagerOptions(input: {
  matchId: string;
  homeUserId: string;
  awayUserId: string;
  homeLabel: string;
  awayLabel: string;
  bettingOpen: boolean;
  homeRecord: { wins: number; losses: number; pointDifferential: number; pointsFor: number; gamesPlayed: number } | null;
  awayRecord: { wins: number; losses: number; pointDifferential: number; pointsFor: number; gamesPlayed: number } | null;
}): TournamentMatchWagerOptions {
  const homeRating = rating(input.homeRecord);
  const awayRating = rating(input.awayRecord);
  const edge = homeRating - awayRating;
  const homeProb = clamp01(1 / (1 + 10 ** (-edge / 10)));
  const awayProb = 1 - homeProb;
  const rawSpread = clampSpread(HOME_FIELD_ADVANTAGE + edge * 0.6);
  const homePpg = input.homeRecord && input.homeRecord.gamesPlayed > 0
    ? input.homeRecord.pointsFor / input.homeRecord.gamesPlayed
    : LEAGUE_BASELINE.points;
  const awayPpg = input.awayRecord && input.awayRecord.gamesPlayed > 0
    ? input.awayRecord.pointsFor / input.awayRecord.gamesPlayed
    : LEAGUE_BASELINE.points;
  const projectedHome = Math.round((homePpg + LEAGUE_BASELINE.points) / 2);
  const projectedAway = Math.round((awayPpg + LEAGUE_BASELINE.points) / 2);

  const markets: TournamentWagerMarketOption[] = [];
  // Tournament match reports no longer collect box-score stats (yards/rush/pass/turnovers/
  // red zone) -- there's no source left to grade a requiresBoxScore market against, so those
  // markets are never offered here (league wagers keep them; league box scores still come from
  // real screenshot OCR, unaffected by this).
  for (const def of marketsForGame(true).filter((market) => !market.requiresBoxScore)) {
    if (def.kind === "moneyline") {
      markets.push({
        market: def.key,
        label: def.label,
        kind: def.kind,
        line: null,
        sides: [
          { pick: input.awayUserId, label: input.awayLabel, odds: moneylineOddsFromProb(awayProb) },
          { pick: input.homeUserId, label: input.homeLabel, odds: moneylineOddsFromProb(homeProb) },
        ],
      });
    } else if (def.kind === "spread") {
      const homeLine = -rawSpread;
      const awayLine = rawSpread;
      markets.push({
        market: def.key,
        label: def.label,
        kind: def.kind,
        line: rawSpread,
        unit: def.unit,
        sides: [
          { pick: input.awayUserId, label: `${input.awayLabel} ${awayLine > 0 ? "+" : ""}${awayLine}`, odds: spreadOrTotalOdds() },
          { pick: input.homeUserId, label: `${input.homeLabel} ${homeLine > 0 ? "+" : ""}${homeLine}`, odds: spreadOrTotalOdds() },
        ],
      });
    } else if (def.kind === "team_total") {
      const isHome = (def.team ?? "home") === "home";
      const line = def.statKey === "points"
        ? (isHome ? projectedHome : projectedAway)
        : teamPropLine(def.statKey ?? "points", isHome);
      const teamLabel = isHome ? input.homeLabel : input.awayLabel;
      markets.push({
        market: def.key,
        label: `${teamLabel} ${def.label.replace(/^Home Team |^Away Team /, "")}`,
        kind: def.kind,
        line,
        unit: def.unit,
        sides: [
          { pick: "over", label: `Over ${line}${def.unit ? ` ${def.unit}` : ""}`, odds: spreadOrTotalOdds() },
          { pick: "under", label: `Under ${line}${def.unit ? ` ${def.unit}` : ""}`, odds: spreadOrTotalOdds() },
        ],
      });
    } else {
      const line = def.statKey === "points"
        ? projectedHome + projectedAway
        : combinedPropLine(def.statKey ?? "points");
      markets.push({
        market: def.key,
        label: def.label,
        kind: def.kind,
        line,
        unit: def.unit,
        sides: [
          { pick: "over", label: `Over ${line}${def.unit ? ` ${def.unit}` : ""}`, odds: spreadOrTotalOdds() },
          { pick: "under", label: `Under ${line}${def.unit ? ` ${def.unit}` : ""}`, odds: spreadOrTotalOdds() },
        ],
      });
    }
  }

  return {
    matchId: input.matchId,
    homeUserId: input.homeUserId,
    awayUserId: input.awayUserId,
    homeLabel: input.homeLabel,
    awayLabel: input.awayLabel,
    humanInvolved: true,
    bettingOpen: input.bettingOpen,
    markets,
  };
}

function combinedPropLine(statKey: string): number {
  const baseline = (LEAGUE_BASELINE as Record<string, number>)[statKey] ?? 0;
  if (statKey === "redzone_off" || statKey === "redzone_def") return baseline;
  if (statKey === "turnovers") return Math.max(MIN_TURNOVER_LINE, Math.round(baseline * 2 * 2) / 2);
  return Math.round(baseline * 2);
}

function teamPropLine(statKey: string, _isHome: boolean): number {
  const baseline = (LEAGUE_BASELINE as Record<string, number>)[statKey] ?? 0;
  if (statKey === "redzone_off" || statKey === "redzone_def") return baseline;
  if (statKey === "turnovers") return Math.max(MIN_TURNOVER_LINE, Math.round(baseline * 2) / 2);
  return Math.round(baseline);
}

export { WAGER_MARKETS, WAGER_MARKET_BY_KEY };

function boxStat(
  box: TournamentBoxScore | null | undefined,
  statKey: string,
): { home: number; away: number; combined: number; average: number } | null {
  const fieldByStat: Record<string, keyof TournamentBoxScoreSide> = {
    total_yards: "totalYards",
    rush_yards: "rushYards",
    pass_yards: "passYards",
    turnovers: "turnovers",
    redzone_off: "redzoneOff",
    redzone_def: "redzoneDef",
  };
  const field = fieldByStat[statKey];
  if (!field) return null;
  const home = Number(box?.home?.[field]);
  const away = Number(box?.away?.[field]);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away, combined: home + away, average: (home + away) / 2 };
}

export function parseTournamentBoxScore(value: unknown): TournamentBoxScore | null {
  if (!value || typeof value !== "object") return null;
  const row = value as TournamentBoxScore;
  if (!row.home && !row.away) return null;
  return row;
}

/** Grade a tournament market. `void` means the needed box-score stat was not recorded. */
export function resolveTournamentMarket(input: {
  marketKey: string;
  pick: string;
  line: number | null;
  wagerKind: "house" | "peer";
  homeUserId: string;
  awayUserId: string;
  homeScore: number | null;
  awayScore: number | null;
  winnerUserId: string | null;
  boxScore: TournamentBoxScore | null;
}): "won" | "lost" | "push" | "void" {
  const def = WAGER_MARKET_BY_KEY.get(input.marketKey);
  if (!def) return "void";
  const homeScore = input.homeScore;
  const awayScore = input.awayScore;
  const hasScores = homeScore != null && awayScore != null && Number.isFinite(homeScore) && Number.isFinite(awayScore);
  const isTie = hasScores && homeScore === awayScore;

  if (def.kind === "moneyline") {
    if (isTie) return input.wagerKind === "peer" ? "push" : "lost";
    if (!input.winnerUserId) return "void";
    return input.pick === input.winnerUserId ? "won" : "lost";
  }

  if (def.kind === "spread") {
    if (!hasScores) return "void";
    const pickIsHome = input.pick === input.homeUserId;
    const margin = pickIsHome ? Number(homeScore) - Number(awayScore) : Number(awayScore) - Number(homeScore);
    const adjusted = margin + Number(input.line ?? 0);
    if (adjusted === 0) return "push";
    return adjusted > 0 ? "won" : "lost";
  }

  const line = Number(input.line ?? 0);
  let actual: number | null = null;
  if (def.statKey === "points") {
    if (!hasScores) return "void";
    actual = def.team === "home"
      ? Number(homeScore)
      : def.team === "away"
        ? Number(awayScore)
        : Number(homeScore) + Number(awayScore);
  } else {
    const stat = boxStat(input.boxScore, def.statKey ?? "");
    if (!stat) return "void";
    if (def.kind === "team_total") {
      actual = (def.team ?? "home") === "home" ? stat.home : stat.away;
    } else {
      actual = def.statKey === "redzone_off" || def.statKey === "redzone_def" ? stat.average : stat.combined;
    }
  }
  if (actual == null) return "void";
  if (actual === line) return "push";
  const isOver = actual > line;
  return (input.pick === "over" && isOver) || (input.pick === "under" && !isOver) ? "won" : "lost";
}
