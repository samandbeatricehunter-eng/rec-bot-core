// Player of the Week scoring -- a community-deconstructed approximation of Madden's own
// internal performance grading, expressed purely in terms of our canonical stat keys
// (packages/shared/src/stats/stat-definitions.ts) so it works off rec_player_weekly_stats
// without touching raw EA field names. One offense + one defense winner per conference per
// week (4 total): AFC offense, AFC defense, NFC offense, NFC defense.
//
// Offense: (yards * 0.1) + (touchdowns * 6) - (turnovers * 4)
// Defense: (sacks * 4) + (interceptions * 4) + (tackles for loss * 2) + (defensive TDs * 6)
//
// Deliberately dropped from the community defensive formula: "allowed big plays /
// concessions" has no per-player canonical stat in this system (only team-level yards/points
// allowed are tracked) -- there's nothing to subtract, so it's simply omitted rather than
// faked with a proxy.

export type WeeklyPlayerStatLine = {
  passYards: number;
  rushYards: number;
  receivingYards: number;
  passTds: number;
  rushTds: number;
  receivingTds: number;
  interceptionsThrown: number;
  rushingFumbles: number;
  sacks: number;
  interceptions: number;
  tacklesForLoss: number;
  defensiveTds: number;
};

export function emptyWeeklyPlayerStatLine(): WeeklyPlayerStatLine {
  return {
    passYards: 0, rushYards: 0, receivingYards: 0, passTds: 0, rushTds: 0, receivingTds: 0,
    interceptionsThrown: 0, rushingFumbles: 0, sacks: 0, interceptions: 0, tacklesForLoss: 0, defensiveTds: 0,
  };
}

export function offensePlayerOfWeekScore(line: WeeklyPlayerStatLine): number {
  const yards = line.passYards + line.rushYards + line.receivingYards;
  const touchdowns = line.passTds + line.rushTds + line.receivingTds;
  const turnovers = line.interceptionsThrown + line.rushingFumbles;
  return yards * 0.1 + touchdowns * 6 - turnovers * 4;
}

export function defensePlayerOfWeekScore(line: WeeklyPlayerStatLine): number {
  return line.sacks * 4 + line.interceptions * 4 + line.tacklesForLoss * 2 + line.defensiveTds * 6;
}

// A defensive line with zero recorded defensive stats isn't a "defensive performance" at
// all (e.g. a punter/kicker row, or a lineman with a clean but statistically empty game) --
// exclude it from defensive POTW consideration rather than let it win 0-0 by default when no
// one else has a line either.
export function hasDefensiveStatLine(line: WeeklyPlayerStatLine): boolean {
  return line.sacks > 0 || line.interceptions > 0 || line.tacklesForLoss > 0 || line.defensiveTds > 0;
}

export function hasOffensiveStatLine(line: WeeklyPlayerStatLine): boolean {
  return line.passYards > 0 || line.rushYards > 0 || line.receivingYards > 0
    || line.passTds > 0 || line.rushTds > 0 || line.receivingTds > 0;
}
