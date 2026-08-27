// Player of the Week scoring -- a community-deconstructed approximation of Madden's own
// internal performance grading, expressed purely in terms of our canonical stat keys
// (packages/shared/src/stats/stat-definitions.ts) so it works off rec_player_weekly_stats
// without touching raw EA field names. One offense + one defense winner per conference per
// week (4 total): AFC offense, AFC defense, NFC offense, NFC defense.
//
// Offense: (pass yards * 0.04) + (rush + receiving yards * 0.1) + (touchdowns * 6) - (turnovers * 4)
// Defense: (tackles * 1) + (sacks * 4) + (interceptions * 4) + (forced fumbles * 3)
//          + (fumble recoveries * 3) + (tackles for loss * 2) + (defensive TDs * 6)
//
// The initial version weighted every yard (passing included) at 0.1, per the community
// formula as given. Checked against EA's own real Week 10 "Top Players" picks (screenshot,
// 2026-08-25) that flat weight got the offensive side wrong on both conferences: Baker
// Mayfield (185 pass, 23 rush, 6 total TD) was the actual NFC pick over Trevor Lawrence (296
// pass, 56 rush, 4 TD) despite Lawrence scoring higher under a flat 0.1/yard; same story for
// Adrian Peterson over Tom Brady in the AFC. Splitting passing yards to the standard-fantasy
// 0.04/yard (1pt/25yd) while keeping rush/receiving at 0.1/yard (1pt/10yd) reproduces both
// real winners exactly.
//
// Checked again against weeks 1-9's real picks (screenshots, 2026-08-25): the original defense
// formula couldn't explain several real winners at all -- Talanoa Hufanga (Week 2 AFC) won with
// a stat line of *only* 2 forced fumbles + 4 fumble recoveries (zero sacks/INTs/TFL/TDs), which
// scored a flat 0 under the original formula. Forced fumbles and fumble recoveries were missing
// entirely. Added both at weight 3 (between a takeaway's 4 and a TFL's 2) -- this reproduces
// Hufanga's win outright (no other category could have given him a nonzero score at all) and is
// directionally consistent with the other weeks checked, though a perfect week-by-week
// reproduction of every single pick wasn't achieved from 9 data points; EA's real selection may
// include tie-break or context criteria (e.g. snap count, "highlight-worthy" flags) this system
// has no data for. Ties are broken alphabetically by player name here, which is very unlikely to
// match EA's real tie-break rule (unknown) -- acceptable for a rare edge case, not chased further.
//
// Deliberately dropped from the community defensive formula: "allowed big plays /
// concessions" has no per-player canonical stat in this system (only team-level yards/points
// allowed are tracked) -- there's nothing to subtract, so it's simply omitted rather than
// faked with a proxy. Tackles-for-loss also always contributes 0 in practice -- EA's Madden
// Companion export has no TFL field at all (confirmed against a raw defensive payload), only
// defTotalTackles/defSacks/defInts/defTDs/defFumRec/defForcedFum/defDeflections/defSafeties --
// left in the formula for the day EA's export adds it, but it's currently a no-op.
//
// Checked again against real Week 11 picks (screenshot, 2026-08-27): both defensive picks were
// wrong. Caleb Ransaw (6 TKL, 1 INT, 1 TD) was the real AFC pick over a computed winner with 1
// INT + 1 fumble recovery + 1 TD but only 3 tackles; Patrick Surtain II (5 TKL, 2 INT, *no* TD)
// was the real NFC pick over a computed winner with 1 INT + 1 TD but only 2 tackles. Plain
// tackles -- tracked in the stat line for display only until now -- were never part of the score
// at all, so a big tackle game couldn't outweigh a single splash play the way it clearly does in
// EA's real grading. Added tackles at weight 1 (the lowest per-unit weight in the formula, since
// a single tackle is the least impactful defensive unit): this reproduces the Surtain pick
// outright (13 vs. 12) and the Ransaw pick via the existing name tie-break (both score 16 with
// tackles included) -- not a clean win, but the tie-break happens to land on the right name here.
// Only 2 data points for this specific weight; if a future real pick contradicts it, that's the
// next thing to check before assuming the weight is right.

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
  forcedFumbles: number;
  fumbleRecoveries: number;
  tacklesForLoss: number;
  defensiveTds: number;
  /** Display-only -- not part of either score formula, just shown on the award card/post. */
  tackles: number;
};

export function emptyWeeklyPlayerStatLine(): WeeklyPlayerStatLine {
  return {
    passYards: 0, rushYards: 0, receivingYards: 0, passTds: 0, rushTds: 0, receivingTds: 0,
    interceptionsThrown: 0, rushingFumbles: 0, sacks: 0, interceptions: 0,
    forcedFumbles: 0, fumbleRecoveries: 0, tacklesForLoss: 0, defensiveTds: 0,
    tackles: 0,
  };
}

export function offensePlayerOfWeekScore(line: WeeklyPlayerStatLine): number {
  const rushRecYards = line.rushYards + line.receivingYards;
  const touchdowns = line.passTds + line.rushTds + line.receivingTds;
  const turnovers = line.interceptionsThrown + line.rushingFumbles;
  return line.passYards * 0.04 + rushRecYards * 0.1 + touchdowns * 6 - turnovers * 4;
}

export function defensePlayerOfWeekScore(line: WeeklyPlayerStatLine): number {
  return line.tackles + line.sacks * 4 + line.interceptions * 4 + line.forcedFumbles * 3 + line.fumbleRecoveries * 3
    + line.tacklesForLoss * 2 + line.defensiveTds * 6;
}

// A defensive line with zero recorded defensive stats isn't a "defensive performance" at
// all (e.g. a punter/kicker row, or a lineman with a clean but statistically empty game) --
// exclude it from defensive POTW consideration rather than let it win 0-0 by default when no
// one else has a line either.
export function hasDefensiveStatLine(line: WeeklyPlayerStatLine): boolean {
  return line.sacks > 0 || line.interceptions > 0 || line.forcedFumbles > 0 || line.fumbleRecoveries > 0
    || line.tacklesForLoss > 0 || line.defensiveTds > 0;
}

export function hasOffensiveStatLine(line: WeeklyPlayerStatLine): boolean {
  return line.passYards > 0 || line.rushYards > 0 || line.receivingYards > 0
    || line.passTds > 0 || line.rushTds > 0 || line.receivingTds > 0;
}
