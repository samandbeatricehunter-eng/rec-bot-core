export type AwardCategory = "football" | "league" | "community";

export interface AwardDefinition {
  key: string;
  name: string;
  category: AwardCategory;
  requiresVoting: boolean;
  nomineeCount: number;
  payoutAmount: number;
  description: string;
}

export const AWARD_DEFINITIONS: AwardDefinition[] = [
  // ── Football Awards ──────────────────────────────────────────────────────
  { key: "mvp", name: "Most Valuable Player", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "The most valuable player in the league this season." },
  { key: "coach_of_the_year", name: "Coach of the Year", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best coaching performance based on wins, improvement, schedule, upset wins, and point differential." },
  { key: "opoy", name: "Offensive Player of the Year", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best overall offensive production in the league." },
  { key: "dpoy", name: "Defensive Player of the Year", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best overall defensive performance in the league." },
  { key: "offensive_rookie", name: "Offensive Rookie of the Year", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best offensive production among rookies." },
  { key: "defensive_rookie", name: "Defensive Rookie of the Year", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best defensive performance among rookies." },
  { key: "best_qb", name: "Best QB", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best quarterback based on passing TDs, yards, completion %, passer rating, and win %." },
  { key: "best_rb", name: "Best RB", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best running back based on rushing yards, TDs, yards per carry, and win %." },
  { key: "best_wr", name: "Best WR", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best wide receiver based on receiving yards, TDs, receptions, and win %." },
  { key: "best_ol", name: "Best OL", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best offensive line unit (team award) based on fewest sacks allowed and average OL overall rating." },
  { key: "best_dl", name: "Best DL", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best defensive line based on sacks (65%), forced fumbles (25%), and tackles (10%)." },
  { key: "best_lb", name: "Best LB", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best linebacker based on tackles (50%), sacks (30%), and interceptions (20%)." },
  { key: "best_db", name: "Best DB", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best defensive back based on interceptions (45%), pass deflections (25%), tackles (20%), and defensive TDs (10%)." },
  { key: "best_kicker", name: "Best Kicker", category: "football", requiresVoting: true, nomineeCount: 10, payoutAmount: 100, description: "Best kicker based on FG % (55%), XP % (30%), and longest FG (15%). Minimum 50 combined attempts." },

  // ── REC League Awards ────────────────────────────────────────────────────
  { key: "commissioners_award", name: "Commissioner's Award", category: "community", requiresVoting: true, nomineeCount: 32, payoutAmount: 100, description: "Recognizes sportsmanship and fair play. All linked coaches are nominees." },
  { key: "best_h2h_record", name: "Best H2H Record", category: "league", requiresVoting: false, nomineeCount: 10, payoutAmount: 100, description: "Highest H2H win percentage (minimum 8 games). Auto-awarded." },
  { key: "best_streamer", name: "Best Streamer", category: "league", requiresVoting: true, nomineeCount: 5, payoutAmount: 100, description: "Most streams logged. Top 5 nominees. Stream count is primary factor (75%)." },
  { key: "challenge_king", name: "Challenge King", category: "league", requiresVoting: false, nomineeCount: 10, payoutAmount: 100, description: "Most completed weekly challenges. Auto-awarded." },
  { key: "badge_collector", name: "Badge Collector", category: "league", requiresVoting: false, nomineeCount: 10, payoutAmount: 100, description: "Most badges earned during the regular season. Auto-awarded." },
  { key: "best_roster", name: "Best Roster Construction", category: "league", requiresVoting: false, nomineeCount: 10, payoutAmount: 100, description: "Highest cumulative roster OVR. Auto-awarded." }
];

export const AWARD_KEYS = AWARD_DEFINITIONS.map((a) => a.key);

export function getAwardDef(key: string): AwardDefinition | undefined {
  return AWARD_DEFINITIONS.find((a) => a.key === key);
}

export const POTY_CATEGORIES = [
  { key: "best_td", label: "Best Touchdown" },
  { key: "best_run", label: "Best Run Play" },
  { key: "best_catch", label: "Best Catch" },
  { key: "best_defensive_play", label: "Best Defensive Play" },
  { key: "best_special_teams", label: "Best Special Teams Play" },
  { key: "most_clutch", label: "Most Clutch Moment" }
] as const;

export type PotyCategory = (typeof POTY_CATEGORIES)[number]["key"];
