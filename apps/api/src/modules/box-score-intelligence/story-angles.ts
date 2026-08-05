// Game-story generation. Angle selection is score-based (not a chain of if/else):
// every angle accrues points from the game's tracked stats, and the highest score
// wins. Stories are told from the winner's perspective. Only tracked stats appear
// in headlines/bodies — never TDs, player names, attempts, or percentages we don't
// store.

import { type GameStats, returnYards } from "./types.js";

export interface StoryContext {
  winner: GameStats;
  loser: GameStats;
  winnerName: string;
  loserName: string;
}

export interface GameStory {
  primaryAngle: string;
  headline: string;
  body: string;
  notes: string[];
  angleScores: Record<string, number>;
}

// The original 20 required story angles (blueprint §9), plus 12 more added 2026-08-05 drawing
// on tracked stats none of the original 20 touched: game stakes/context (playoff/SB/conf
// champ/divisional round), and CFB-only fields (time of possession, yards/play, penalties,
// punting, rush/pass TDs) that were sitting unused. CFB-only scorers null-guard every field —
// Madden's box score leaves those null, which must score 0, not silently pass a `null <= x`
// comparison (JS coerces null to 0 in numeric comparisons, which would wrongly fire "disciplined
// game" for every Madden game with no penalty data at all).
export const STORY_ANGLES = [
  "ground_control",
  "air_raid",
  "balanced_attack",
  "nickel_and_dime",
  "drive_extender",
  "red_zone_clinic",
  "red_zone_wall",
  "bend_dont_break",
  "turnover_collapse",
  "turnover_survivor",
  "ball_security",
  "shootout",
  "defensive_grind",
  "statement_win",
  "close_escape",
  "empty_yards",
  "return_game_edge",
  "two_point_specialist",
  "home_fortress",
  "road_warrior",
  "championship_moment",
  "conference_statement",
  "divisional_grit",
  "playoff_grit",
  "clock_control",
  "big_play_offense",
  "disciplined_execution",
  "field_position_king",
  "ground_and_pound_tds",
  "air_strike_tds",
  "yardage_gap",
  "stone_wall_defense",
] as const;

export type StoryAngle = (typeof STORY_ANGLES)[number];

type Scorer = (w: GameStats, l: GameStats) => number;

// Scores tuned so the most defining narrative wins. A small margin-based base on
// statement/close means there is always a positive-scoring angle to fall back on.
const ANGLE_SCORERS: Record<StoryAngle, Scorer> = {
  ground_control: (w) => (w.rushingYards >= 200 ? 100 : w.rushingYards >= 150 ? 60 : 0),
  air_raid: (w) => (w.passingYards >= 375 ? 100 : w.passingYards >= 300 ? 60 : 0),
  balanced_attack: (w) => (w.passingYards >= 225 && w.rushingYards >= 125 ? 80 : 0),
  nickel_and_dime: (w) => (w.firstDowns >= 24 && w.thirdDownConversions >= 8 ? 85 : 0),
  drive_extender: (w) => (w.thirdDownConversions >= 10 ? 80 : 0),
  red_zone_clinic: (w) => (w.redZoneOffensivePct >= 100 ? 85 : w.redZoneOffensivePct >= 75 ? 50 : 0),
  red_zone_wall: (w) => (w.opponentRedZoneOffensivePct <= 40 ? 80 : 0),
  bend_dont_break: (w, l) => (w.margin <= 7 && l.firstDowns >= 22 && l.thirdDownConversions >= 7 ? 110 : 0),
  turnover_collapse: (w, l) => (l.turnoversCommitted >= 3 ? 90 : 0),
  turnover_survivor: (w) => (w.turnoversCommitted >= 3 ? 95 : 0),
  ball_security: (w) => (w.turnoversCommitted === 0 ? 35 : 0),
  shootout: (w, l) => (w.pointsFor >= 38 && l.pointsFor >= 28 ? 90 : 0),
  defensive_grind: (w) => (w.pointsAgainst <= 14 ? 80 : 0),
  statement_win: (w) => (w.margin >= 28 ? 100 : w.margin >= 14 ? 40 : 0),
  close_escape: (w) => (w.margin <= 3 ? 85 : w.margin <= 7 ? 30 : 0),
  empty_yards: (w, l) => (l.totalYards >= 400 && l.pointsFor <= 21 ? 70 : 0),
  return_game_edge: (w) => (returnYards(w) >= 200 ? 80 : returnYards(w) >= 150 ? 60 : 0),
  two_point_specialist: (w) => (w.twoPointConversions >= 2 ? 70 : 0),
  home_fortress: (w) => (w.homeAway === "home" && w.margin >= 10 ? 55 : 0),
  road_warrior: (w) => (w.homeAway === "away" && w.margin >= 10 ? 65 : 0),

  // Stakes-based — scored well above regular-season angles so the biggest available stage
  // always wins the framing (highest-score-wins already handles the overlap: isPlayoff is
  // true for every later round too, but championship/conference/divisional score higher and
  // naturally take priority without needing explicit exclusions).
  championship_moment: (w) => (w.isSuperBowl ? 150 : 0),
  conference_statement: (w) => (w.isConferenceChampionshipGame ? 130 : 0),
  divisional_grit: (w) => (w.isDivisionalRound ? 115 : 0),
  playoff_grit: (w) => (w.isPlayoff ? 58 : 0),

  // CFB-only (null on Madden games — every comparison null-guards first so a missing stat
  // scores 0, never a false positive from JS coercing null to 0 in `<=`/`>=` comparisons).
  clock_control: (w) => (w.timeOfPossessionSeconds != null && w.timeOfPossessionSeconds >= 1980 ? 75 : w.timeOfPossessionSeconds != null && w.timeOfPossessionSeconds >= 1800 ? 45 : 0),
  big_play_offense: (w) => (w.yardsPerPlay != null && w.yardsPerPlay >= 7.5 ? 80 : w.yardsPerPlay != null && w.yardsPerPlay >= 6.5 ? 50 : 0),
  disciplined_execution: (w) => (w.penalties != null && w.penalties <= 3 ? 40 : 0),
  field_position_king: (w) => (w.puntAvgYards != null && w.puntAvgYards >= 45 ? 65 : w.puntAvgYards != null && w.puntAvgYards >= 42 ? 40 : 0),
  ground_and_pound_tds: (w) => (w.rushTDs != null && w.rushTDs >= 4 ? 85 : w.rushTDs != null && w.rushTDs >= 3 ? 50 : 0),
  air_strike_tds: (w) => (w.passTDs != null && w.passTDs >= 4 ? 85 : w.passTDs != null && w.passTDs >= 3 ? 50 : 0),
  yardage_gap: (w, l) => (w.totalYards - l.totalYards >= 200 ? 75 : w.totalYards - l.totalYards >= 150 ? 45 : 0),
  stone_wall_defense: (w) => (w.yardsAllowed <= 250 ? 75 : w.yardsAllowed <= 300 ? 45 : 0),
};

type Template = (ctx: StoryContext) => { headline: string; body: string };

const ABS = (n: number) => Math.abs(n);

const TEMPLATES: Record<StoryAngle, Template> = {
  ground_control: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Pound the Rock Past ${loserName}`,
    body: `${winnerName} leaned on the run game for ${winner.rushingYards} rushing yards, controlling the line of scrimmage on the way to a ${ABS(winner.margin)}-point win over ${loserName}.`,
  }),
  air_raid: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Air It Out Over ${loserName}`,
    body: `${winnerName} torched ${loserName} through the air for ${winner.passingYards} passing yards, riding the aerial attack to a ${ABS(winner.margin)}-point victory.`,
  }),
  balanced_attack: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Stay Balanced to Beat ${loserName}`,
    body: `${winnerName} kept ${loserName} guessing with ${winner.passingYards} passing and ${winner.rushingYards} rushing yards, a balanced attack that produced a ${ABS(winner.margin)}-point win.`,
  }),
  nickel_and_dime: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Move the Chains on ${loserName}`,
    body: `${winnerName} methodically dismantled ${loserName}, piling up ${winner.firstDowns} first downs and ${winner.thirdDownConversions} third-down conversions to stay on the field all game.`,
  }),
  drive_extender: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Keep Drives Alive Against ${loserName}`,
    body: `${winnerName} converted ${winner.thirdDownConversions} third downs, extending drive after drive and wearing ${loserName} down in a ${ABS(winner.margin)}-point win.`,
  }),
  red_zone_clinic: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Put On a Red Zone Clinic vs ${loserName}`,
    body: `${winnerName} were ruthless inside the twenty, converting ${winner.redZoneOffensivePct}% of their red zone trips to bury ${loserName}.`,
  }),
  red_zone_wall: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Slam the Door on ${loserName}`,
    body: `${winnerName} turned the red zone into a wall, holding ${loserName} to ${winner.opponentRedZoneOffensivePct}% inside the twenty and escaping with a ${ABS(winner.margin)}-point win.`,
  }),
  bend_dont_break: ({ winner, loser, winnerName, loserName }) => ({
    headline: `${winnerName} Bend but Don't Break in Tight Win Over ${loserName}`,
    body: `${winnerName} allowed ${loserName} to move the chains throughout the game, giving up ${loser.firstDowns} first downs and ${loser.thirdDownConversions} third-down conversions. But the defense held firm when it mattered, surviving enough scoring chances to escape with a ${ABS(winner.margin)}-point win.`,
  }),
  turnover_collapse: ({ winner, loser, winnerName, loserName }) => ({
    headline: `${loserName} Give It Away as ${winnerName} Capitalize`,
    body: `${loserName} self-destructed with ${loser.turnoversCommitted} turnovers, and ${winnerName} made them pay in a ${ABS(winner.margin)}-point win.`,
  }),
  turnover_survivor: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Survive Their Own Mistakes Against ${loserName}`,
    body: `${winnerName} coughed it up ${winner.turnoversCommitted} times but still found a way past ${loserName}, gutting out a ${ABS(winner.margin)}-point win despite the giveaways.`,
  }),
  ball_security: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Protect the Ball in Win Over ${loserName}`,
    body: `${winnerName} played a clean game with zero turnovers, taking care of the football to beat ${loserName} by ${ABS(winner.margin)}.`,
  }),
  shootout: ({ winner, loser, winnerName, loserName }) => ({
    headline: `${winnerName} Outlast ${loserName} in a Shootout`,
    body: `Points came in bunches as ${winnerName} edged ${loserName} ${winner.pointsFor}-${loser.pointsFor} in a track meet that came down to who had the ball last.`,
  }),
  defensive_grind: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Win the Grind Over ${loserName}`,
    body: `${winnerName} smothered ${loserName}, allowing just ${winner.pointsAgainst} points in a defensive struggle decided by ${ABS(winner.margin)}.`,
  }),
  statement_win: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Make a Statement Against ${loserName}`,
    body: `${winnerName} left no doubt, rolling ${loserName} by ${ABS(winner.margin)} in a wire-to-wire beatdown, ${winner.pointsFor}-${winner.pointsAgainst}.`,
  }),
  close_escape: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Escape ${loserName} by a Hair`,
    body: `${winnerName} held on for dear life, surviving ${loserName} ${winner.pointsFor}-${winner.pointsAgainst} in a game that came down to the final possession.`,
  }),
  empty_yards: ({ winner, loser, winnerName, loserName }) => ({
    headline: `${loserName} Pile Up Empty Yards in Loss to ${winnerName}`,
    body: `${loserName} moved the ball for ${loser.totalYards} total yards but had little to show for it, managing only ${loser.pointsFor} points as ${winnerName} won where it counted.`,
  }),
  return_game_edge: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Win the Hidden Yardage Battle vs ${loserName}`,
    body: `${winnerName} flipped the field all day, racking up ${returnYards(winner)} combined return yards to set up short fields in a ${ABS(winner.margin)}-point win over ${loserName}.`,
  }),
  two_point_specialist: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Go For Two and Get It vs ${loserName}`,
    body: `${winnerName} dialed up ${winner.twoPointConversions} successful two-point conversions, the kind of aggression that separated them from ${loserName}.`,
  }),
  home_fortress: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Defend the Fortress Against ${loserName}`,
    body: `Home field stayed a fortress as ${winnerName} handled ${loserName} by ${ABS(winner.margin)} in front of their own crowd.`,
  }),
  road_warrior: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Go on the Road and Take Down ${loserName}`,
    body: `${winnerName} silenced the home crowd, going into ${loserName}'s building and winning by ${ABS(winner.margin)}.`,
  }),
  championship_moment: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Are Champions, Defeating ${loserName}`,
    body: `${winnerName} closed it out on the sport's biggest stage, beating ${loserName} ${winner.pointsFor}-${winner.pointsAgainst} to claim the title.`,
  }),
  conference_statement: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Punch Their Ticket, Topping ${loserName}`,
    body: `${winnerName} took care of business in the conference championship, beating ${loserName} ${winner.pointsFor}-${winner.pointsAgainst} to advance.`,
  }),
  divisional_grit: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Survive the Divisional Round Against ${loserName}`,
    body: `${winnerName} kept the run alive with a ${ABS(winner.margin)}-point win over ${loserName} in the divisional round.`,
  }),
  playoff_grit: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Advance Past ${loserName} in the Playoffs`,
    body: `${winnerName} did what they needed to in win-or-go-home football, beating ${loserName} ${winner.pointsFor}-${winner.pointsAgainst}.`,
  }),
  clock_control: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Own the Clock Against ${loserName}`,
    body: `${winnerName} controlled the ball for over ${Math.floor((winner.timeOfPossessionSeconds ?? 0) / 60)} minutes, keeping ${loserName}'s offense off the field in a ${ABS(winner.margin)}-point win.`,
  }),
  big_play_offense: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Strike Big Against ${loserName}`,
    body: `${winnerName} averaged ${winner.yardsPerPlay?.toFixed(1)} yards every time they snapped it, an explosive-play clinic in a ${ABS(winner.margin)}-point win over ${loserName}.`,
  }),
  disciplined_execution: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Play Clean to Beat ${loserName}`,
    body: `${winnerName} stayed disciplined with just ${winner.penalties} penalties, avoiding the self-inflicted mistakes in a ${ABS(winner.margin)}-point win over ${loserName}.`,
  }),
  field_position_king: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Win the Field Position Battle vs ${loserName}`,
    body: `${winnerName}'s punting unit flipped the field all day, averaging ${winner.puntAvgYards?.toFixed(1)} yards per punt to help seal a ${ABS(winner.margin)}-point win over ${loserName}.`,
  }),
  ground_and_pound_tds: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Pound It In Again and Again on ${loserName}`,
    body: `${winnerName} punched it in on the ground ${winner.rushTDs} times, wearing down ${loserName} in a ${ABS(winner.margin)}-point win.`,
  }),
  air_strike_tds: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName} Rain Touchdowns on ${loserName}`,
    body: `${winnerName} threw for ${winner.passTDs} touchdowns, picking apart ${loserName}'s defense in a ${ABS(winner.margin)}-point win.`,
  }),
  yardage_gap: ({ winner, loser, winnerName, loserName }) => ({
    headline: `${winnerName} Outgain ${loserName} by a Mile`,
    body: `${winnerName} out-gained ${loserName} ${winner.totalYards}-${loser.totalYards} total yards, a lopsided battle in the trenches that produced a ${ABS(winner.margin)}-point win.`,
  }),
  stone_wall_defense: ({ winner, winnerName, loserName }) => ({
    headline: `${winnerName}'s Defense Shuts Down ${loserName}`,
    body: `${winnerName} held ${loserName} to just ${winner.yardsAllowed} total yards, a stone-wall defensive performance in a ${ABS(winner.margin)}-point win.`,
  }),
};

function scoreAngles(w: GameStats, l: GameStats): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const angle of STORY_ANGLES) scores[angle] = ANGLE_SCORERS[angle](w, l);
  return scores;
}

function pickPrimaryAngle(scores: Record<string, number>): StoryAngle {
  let best: StoryAngle = "statement_win";
  let bestScore = -1;
  for (const angle of STORY_ANGLES) {
    if (scores[angle] > bestScore) {
      bestScore = scores[angle];
      best = angle;
    }
  }
  // Nothing distinctive fired — fall back to the result shape.
  if (bestScore <= 0) return "close_escape";
  return best;
}

function buildNotes(ctx: StoryContext, earnedBadgeLabels: string[]): string[] {
  const { winner, loser, winnerName, loserName } = ctx;
  const notes = [
    `${winnerName} finished with ${winner.passingYards} passing yards and ${winner.rushingYards} rushing yards.`,
    `${winnerName} converted ${winner.thirdDownConversions} third downs.`,
    `${loserName} committed ${loser.turnoversCommitted} turnovers.`,
  ];
  if (earnedBadgeLabels.length) notes.push(`${winnerName} earned: ${earnedBadgeLabels.join(", ")}.`);
  return notes;
}

/**
 * Build the game story. Pass the winner's earned weekly badge labels to include
 * them in the Key Notes (badge qualification itself lives in badge-rules.ts).
 */
export function generateGameStory(ctx: StoryContext, earnedBadgeLabels: string[] = []): GameStory {
  const angleScores = scoreAngles(ctx.winner, ctx.loser);
  const primaryAngle = pickPrimaryAngle(angleScores);
  const { headline, body } = TEMPLATES[primaryAngle](ctx);
  return {
    primaryAngle,
    headline,
    body,
    notes: buildNotes(ctx, earnedBadgeLabels),
    angleScores,
  };
}
