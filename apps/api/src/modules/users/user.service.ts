// @ts-nocheck
import { gameplaySeasonStages, postseasonPayoutStages, regularSeasonWeeks } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { findCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { computeLeagueSos } from "../schedule/sos.service.js";
import { OFFICIAL_RESULT_SOURCES } from "../official-records/official-records.service.js";
import { rebuildOfficialGlobalRecords } from "../official-records/official-records.service.js";
import { recomputeActiveLeagueBadgeBaselines } from "../box-score-intelligence/persistence.js";
import { CAREER_BADGES, GAME_BADGES, ladderLabelForTier, SEASON_BADGES, tierForOccurrenceCount, type BadgeDef } from "../box-score-intelligence/badge-rules.js";
import {
  formatTeamDisplayName,
  loadCareerBoxScoreStats,
  loadSeasonBoxScoreStats,
  loadUserFinancialSummary,
  resolveTeamNick,
  resolveTeamSchool,
} from "./user-profile-stats.service.js";

const ALL_BADGE_DEFS = [...GAME_BADGES, ...SEASON_BADGES, ...CAREER_BADGES];
const BADGE_LABELS = new Map<string, string>(ALL_BADGE_DEFS.map((badge: BadgeDef<any>) => [badge.key, badge.label]));
const BADGE_DESCRIPTIONS = new Map<string, string>(ALL_BADGE_DEFS.map((badge: BadgeDef<any>) => [badge.key, badge.description]));
const CFB_27_ONLY = ["cfb_27"];

const IDENTITY_GROUPS = [
  {
    key: "ground_game",
    label: "Ground-and-Pound Operator",
    summary: "Leans on the run game and repeated rushing-control achievements.",
    badges: new Set(["ground_and_pound", "run_heavy", "ground_commander", "ground_and_pound_veteran", "option_identity", "option_program"]),
    statScore: (s: any) => scoreAbove(s?.rushingYardsAvg, 110, 190, 26) + scoreAbove(rushShare(s), 0.38, 0.55, 16) + scoreAbove(s?.firstDownsAvg, 20, 27, 10),
  },
  {
    key: "air_game",
    label: "Air Raid Merchant",
    summary: "Creates identity through passing volume, explosive air production, and pass-heavy badge history.",
    badges: new Set(["air_raid", "pass_heavy", "air_commander", "air_raid_veteran", "air_raid_program"]),
    statScore: (s: any) => scoreAbove(s?.passingYardsAvg, 260, 380, 28) + scoreAbove(passShare(s), 0.62, 0.78, 18),
  },
  {
    key: "shootout",
    label: "Shootout Specialist",
    summary: "Regularly plays in high-scoring games and wins with offensive pressure.",
    badges: new Set(["shootout_winner", "offensive_explosion", "offensive_standard", "shootout_veteran", "shootout_legend", "track_meet"]),
    statScore: (s: any) => scoreAbove(s?.pointsForAvg, 31, 44, 25) + scoreAbove(s?.highScoringRate, 35, 75, 18) + scoreAbove(s?.offensiveYardsAvg, 390, 500, 12),
  },
  {
    key: "balanced",
    label: "Balanced Problem",
    summary: "Builds production through a balanced passing and rushing profile.",
    badges: new Set(["balanced_attack", "balanced_season", "balanced_identity"]),
    statScore: (s: any) => scoreAbove(Math.min(s?.passingYardsAvg ?? 0, (s?.rushingYardsAvg ?? 0) * 1.9), 210, 310, 18) + scoreBetween(passShare(s), 0.5, 0.68, 18),
  },
  {
    key: "efficiency",
    label: "Efficiency Manager",
    summary: "Protects possessions, finishes drives, and wins through clean execution.",
    badges: new Set(["ball_security", "perfect_red_zone", "red_zone_efficient", "red_zone_master", "ball_control_season", "ball_security_veteran", "ball_security_legend"]),
    statScore: (s: any) => scoreBelow(s?.turnoversCommittedAvg, 1.2, 0.2, 22) + scoreAbove(s?.redZoneOffPct, 72, 92, 16) + scoreAbove(s?.turnoverDifferentialAvg, 0.4, 1.8, 12),
  },
  {
    key: "defense",
    label: "Defensive Closer",
    summary: "Wins with defensive pressure, red-zone resistance, and low points allowed.",
    badges: new Set(["defensive_grind", "red_zone_wall", "red_zone_defense", "defensive_standard", "opportunistic", "takeaway_season", "red_zone_wall_career", "opportunist", "student_section_stand", "turnover_chain", "campus_fortress"]),
    statScore: (s: any) => scoreBelow(s?.pointsAgainstAvg, 22, 12, 24) + scoreBelow(s?.redZoneDefPct, 55, 35, 14) + scoreAbove(s?.turnoversGeneratedAvg, 1.2, 3, 14),
  },
  {
    key: "situational",
    label: "Situational Gambler",
    summary: "Shows up in fourth-down, close-game, and volatile matchup achievements.",
    badges: new Set(["fourth_down_gambler", "fourth_down_menace", "two_point_specialist", "two_point_identity", "close_escape", "turnover_survivor", "bend_dont_break"]),
    statScore: (s: any) => scoreAbove(s?.fourthDownConversionsAvg, 1.1, 3, 20) + scoreAbove(s?.closeGameRate, 35, 75, 12) + scoreAbove(s?.twoPointConversionsAvg, 0.2, 0.8, 4),
  },
  {
    key: "clock_control",
    label: "Clock Controller",
    summary: "Controls games through rushing volume, chains, and low-mistake possession football.",
    badges: new Set(["chain_mover", "drive_extender", "nickel_and_dime", "ball_security", "ground_and_pound", "chain_king", "drive_sustainer"]),
    statScore: (s: any) => scoreAbove(s?.firstDownsAvg, 21, 29, 24) + scoreAbove(s?.rushingYardsAvg, 100, 175, 14) + scoreBelow(s?.turnoversCommittedAvg, 1.4, 0.4, 10),
  },
  {
    key: "chaos",
    label: "Chaos Coach",
    summary: "Creates noisy, swing-heavy games through turnovers, explosive scoring, and volatile results.",
    badges: new Set(["turnover_trouble", "turnover_survivor", "opportunistic", "empty_yards", "heartbreaker", "shootout_winner", "campus_chaos", "track_meet"]),
    statScore: (s: any) => scoreAbove((s?.turnoversCommittedAvg ?? 0) + (s?.turnoversGeneratedAvg ?? 0), 3, 5.5, 22) + scoreAbove(s?.highScoringRate, 35, 75, 12) + scoreAbove(s?.closeGameRate, 35, 75, 8),
  },
  {
    key: "red_zone",
    label: "Red Zone Technician",
    summary: "Turns drives into points through red-zone execution and efficient finishing.",
    badges: new Set(["perfect_red_zone", "red_zone_efficient", "red_zone_master", "offensive_standard"]),
    statScore: (s: any) => scoreAbove(s?.redZoneOffPct, 76, 96, 24) + scoreAbove(s?.pointsForAvg, 27, 39, 12),
  },
  {
    key: "field_position",
    label: "Field Position Thief",
    summary: "Steals hidden yards through return production and short-field pressure.",
    badges: new Set(["return_game_edge", "hidden_yardage", "return_threat", "special_teams_spark"]),
    statScore: (s: any) => scoreAbove(s?.returnYardsAvg, 90, 170, 24),
  },
  {
    key: "bend_dont_break",
    label: "Bend-Don't-Break Defender",
    summary: "Can allow movement between the 20s but tightens up in scoring situations.",
    badges: new Set(["bend_dont_break", "red_zone_wall", "defensive_grind", "red_zone_defense"]),
    statScore: (s: any) => scoreAbove(s?.yardsAllowedAvg, 340, 450, 8) + scoreBelow(s?.pointsAgainstAvg, 24, 16, 16) + scoreBelow(s?.redZoneDefPct, 52, 34, 14),
  },
  {
    key: "grinder",
    label: "Grinder",
    summary: "Lives in lower-scoring, close-margin games where every possession matters.",
    badges: new Set(["close_escape", "heartbreaker", "defensive_grind", "ground_and_pound", "ball_security"]),
    statScore: (s: any) => scoreAbove(s?.closeGameRate, 40, 80, 18) + scoreBelow(s?.pointsForAvg, 30, 18, 7) + scoreBelow(s?.pointsAgainstAvg, 24, 15, 10),
  },
  {
    key: "option_program",
    label: "Option Program Builder",
    summary: "Builds the offense through heavy rushing volume, option-style yardage splits, and drive control.",
    games: CFB_27_ONLY,
    badges: new Set(["option_identity", "option_program", "ground_and_pound", "run_heavy", "ground_commander"]),
    statScore: (s: any) => scoreAbove(s?.rushingYardsAvg, 150, 260, 30) + scoreAbove(rushShare(s), 0.46, 0.66, 22) + scoreAbove(s?.firstDownsAvg, 19, 28, 8),
  },
  {
    key: "campus_power",
    label: "Campus Power",
    summary: "Looks like a weekly favorite: big margins, bowl-level wins, and enough season consistency to separate from the pack.",
    games: CFB_27_ONLY,
    badges: new Set(["bowl_statement", "statement_win", "bowl_eligible", "conference_contender", "perfect_regular_season", "ten_win_club"]),
    statScore: (s: any) => scoreAbove(s?.pointsForAvg - s?.pointsAgainstAvg, 10, 28, 26) + scoreAbove(s?.pointsForAvg, 30, 45, 10) + scoreBelow(s?.pointsAgainstAvg, 24, 14, 10),
  },
  {
    key: "home_field",
    label: "Home-Field Hammer",
    summary: "Turns home games into pressure spots, pairing home wins with defensive stands and low-scoring control.",
    games: CFB_27_ONLY,
    badges: new Set(["home_fortress", "home_fortress_career", "student_section_stand", "campus_fortress"]),
    statScore: (s: any) => scoreBelow(s?.pointsAgainstAvg, 21, 13, 18) + scoreBelow(s?.redZoneDefPct, 55, 36, 10),
  },
  {
    key: "special_teams",
    label: "Special Teams Catalyst",
    summary: "Changes field position with return production and forces opponents to defend more than the normal offensive script.",
    games: CFB_27_ONLY,
    badges: new Set(["special_teams_spark", "return_game_edge", "hidden_yardage", "return_threat"]),
    statScore: (s: any) => scoreAbove(s?.returnYardsAvg, 100, 190, 28),
  },
];

const TIER_WEIGHT: Record<string, number> = { normal: 1, bronze: 2, silver: 3, gold: 4, needs_work: 1, warning: 2, serious_problem: 3, shit_show: 4 };

function mapOwnedBadge(row: any) {
  const badgeKey = row.badge_key ?? row.badge_name ?? "badge";
  return {
    ...row,
    badge_name: badgeKey,
    badge_label: ladderLabelForTier(badgeKey, row.tier) ?? BADGE_LABELS.get(badgeKey) ?? badgeKey,
    badge_description: BADGE_DESCRIPTIONS.get(badgeKey) ?? null,
    earned_value: row.earned_count ?? 1,
    earned_at: row.updated_at ?? row.created_at ?? null,
    league_id: row.league_id ?? null,
    season_number: row.season ?? null,
  };
}

function aggregateOwnedBadges(rows: any[], currentLeagueId: string | null, currentSeason: number) {
  const byKey = new Map<string, any>();
  for (const source of rows) {
    const row = mapOwnedBadge(source);
    const key = String(row.badge_key ?? row.badge_name);
    const count = Number(row.earned_count ?? row.earned_value ?? 1);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, {
        ...row,
        earned_count: count,
        earned_value: count,
        league_earned_count: row.league_id === currentLeagueId ? count : 0,
        season_earned_count: row.league_id === currentLeagueId && Number(row.season) === currentSeason ? count : 0,
        scopes: [row.badge_scope],
      });
      continue;
    }
    current.earned_count += count;
    current.earned_value = current.earned_count;
    if (row.league_id === currentLeagueId) current.league_earned_count += count;
    if (row.league_id === currentLeagueId && Number(row.season) === currentSeason) current.season_earned_count += count;
    if (!current.scopes.includes(row.badge_scope)) current.scopes.push(row.badge_scope);
    if ((TIER_WEIGHT[row.tier] ?? 0) > (TIER_WEIGHT[current.tier] ?? 0)) current.tier = row.tier;
    if (Number(row.last_earned_week ?? 0) > Number(current.last_earned_week ?? 0)) current.last_earned_week = row.last_earned_week;
  }
  return [...byKey.values()].map((badge) => ({
    ...badge,
    tier: badge.scopes.includes("game")
      ? tierForOccurrenceCount(badge.earned_count, badge.polarity === "negative" ? "negative" : "positive")
      : badge.tier,
  })).sort((a, b) => String(a.badge_label).localeCompare(String(b.badge_label)));
}

export async function getUserBaselineByDiscordId(discordId: string) {
  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id, discord_id, username, global_name")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (account.error) throw new ApiError(500, "Failed to load Discord account", account.error);
  if (!account.data) throw new ApiError(404, "Discord account not found in REC Core");

  const [user, globalRecord, wallet, legacyBaseline] = await Promise.all([
    supabase.from("rec_users").select("*").eq("id", account.data.user_id).single(),
    supabase.from("rec_global_user_records").select("*").eq("user_id", account.data.user_id).maybeSingle(),
    supabase.from("rec_wallets").select("*").eq("user_id", account.data.user_id).maybeSingle(),
    supabase.from("rec_legacy_user_baselines").select("*").eq("user_id", account.data.user_id).maybeSingle()
  ]);

  if (user.error) throw new ApiError(500, "Failed to load REC user", user.error);
  if (globalRecord.error) throw new ApiError(500, "Failed to load global record", globalRecord.error);
  if (wallet.error) throw new ApiError(500, "Failed to load wallet", wallet.error);
  if (legacyBaseline.error) throw new ApiError(500, "Failed to load legacy baseline", legacyBaseline.error);

  return {
    user: user.data,
    discord: account.data,
    globalRecord: globalRecord.data,
    wallet: wallet.data,
    legacyBaseline: legacyBaseline.data
  };
}

export async function getWalletByDiscordId(discordId: string, guildId?: string) {
  const baseline = await getUserBaselineByDiscordId(discordId);

  let leagueId: string | null = null;
  if (guildId) {
    const context = await findCurrentLeagueContext(guildId);
    leagueId = context?.leagueId ?? null;
  }

  // When scoped to a guild, show only 10 transactions for that league.
  // Without a guild context, show 25 across all leagues.
  const limit = guildId ? 10 : 25;
  const transactions = await getRecentTransactionsByUserId(baseline.user.id, limit, leagueId ?? undefined);

  return {
    user: baseline.user,
    discord: baseline.discord,
    wallet: baseline.wallet ?? { wallet_balance: 0, savings_balance: 0 },
    transactions,
    leagueId
  };
}

// Transfer funds between a user's wallet and savings.
// direction "to_savings": moves money from wallet → savings.
// direction "from_savings": moves money from savings → wallet.
export async function transferSavings(discordId: string, amount: number, direction: "to_savings" | "from_savings") {
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, "Amount must be a positive number.");

  const baseline = await getUserBaselineByDiscordId(discordId);
  const walletRow = baseline.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const wallet = Number(walletRow.wallet_balance ?? 0);
  const savings = Number(walletRow.savings_balance ?? 0);

  if (direction === "to_savings") {
    if (wallet < amount) throw new ApiError(400, `Insufficient wallet balance. You have $${wallet}.`);
    const { error } = await supabase
      .from("rec_wallets")
      .upsert({ user_id: baseline.user.id, wallet_balance: wallet - amount, savings_balance: savings + amount, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new ApiError(500, "Transfer failed", error);
  } else {
    if (savings < amount) throw new ApiError(400, `Insufficient savings balance. You have $${savings}.`);
    const { error } = await supabase
      .from("rec_wallets")
      .upsert({ user_id: baseline.user.id, wallet_balance: wallet + amount, savings_balance: savings - amount, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new ApiError(500, "Transfer failed", error);
  }

  const updated = await supabase.from("rec_wallets").select("wallet_balance,savings_balance").eq("user_id", baseline.user.id).single();
  return {
    transferred: amount,
    direction,
    wallet_balance: updated.data?.wallet_balance ?? 0,
    savings_balance: updated.data?.savings_balance ?? 0
  };
}

export async function getRecentTransactionsByUserId(userId: string, limit = 25, leagueId?: string) {
  let query = supabase
    .from("rec_dollar_ledger")
    .select("id,amount,transaction_type,description,source,source_reference,created_at,league_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (leagueId) query = query.eq("league_id", leagueId);

  const ledger = await query;
  if (ledger.error) {
    throw new ApiError(500, "Failed to load wallet transactions", ledger.error);
  }

  return ledger.data ?? [];
}

function badgeScore(row: any) {
  return Math.max(1, Number(row.earned_count ?? 1)) * (TIER_WEIGHT[String(row.tier ?? "normal")] ?? 1);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function scoreAbove(value: unknown, floor: number, ceiling: number, max: number) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= floor) return 0;
  return Math.round(clamp01((n - floor) / Math.max(1, ceiling - floor)) * max);
}

function scoreBelow(value: unknown, floor: number, ceiling: number, max: number) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n >= floor) return 0;
  return Math.round(clamp01((floor - n) / Math.max(0.1, floor - ceiling)) * max);
}

function scoreBetween(value: unknown, low: number, high: number, max: number) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < low || n > high) return 0;
  const midpoint = (low + high) / 2;
  const half = Math.max(0.01, (high - low) / 2);
  return Math.round((1 - Math.abs(n - midpoint) / half) * max);
}

function passShare(stats: any) {
  const pass = Number(stats?.passingYards ?? 0);
  const rush = Number(stats?.rushingYards ?? 0);
  return pass + rush > 0 ? pass / (pass + rush) : 0;
}

function rushShare(stats: any) {
  const share = passShare(stats);
  return share > 0 ? 1 - share : 0;
}

function blendLabel(parts: Array<{ key: string; label: string }>) {
  const keys = parts.map((part) => part.key);
  if (keys.includes("shootout") && keys.includes("air_game") && keys.includes("chaos")) return "Volatile Air Raid Finisher";
  if (keys.includes("option_program") && keys.includes("clock_control")) return "Option-Control Architect";
  if (keys.includes("option_program") && keys.includes("campus_power")) return "Power Option Program";
  if (keys.includes("campus_power") && keys.includes("defense")) return "Campus Power Closer";
  if (keys.includes("special_teams") && keys.includes("field_position")) return "Hidden-Yardage Catalyst";
  if (keys.includes("home_field") && keys.includes("defense")) return "Home-Field Defensive Hammer";
  if (keys.includes("shootout") && keys.includes("air_game")) return "Air Raid Finisher";
  if (keys.includes("shootout") && keys.includes("chaos")) return "Volatile Shootout Artist";
  if (keys.includes("clock_control") && keys.includes("defense")) return "Possession-Control Closer";
  if (keys.includes("balanced") && keys.includes("clock_control")) return "Balanced Possession Problem";
  if (keys.includes("balanced") && keys.includes("defense")) return "Balanced Defensive Problem";
  if (keys.includes("ground_game") && keys.includes("clock_control")) return "Ground-Control Grinder";
  if (keys.includes("red_zone") && keys.includes("efficiency")) return "Red Zone Efficiency Engine";
  if (keys.includes("defense") && keys.includes("bend_dont_break")) return "Bend-Don't-Break Closer";
  if (keys.includes("field_position") && keys.includes("defense")) return "Hidden-Yardage Defender";
  if (parts.length >= 2) return `${parts[0].label.replace(/ Coach$| Operator$| Specialist$| Manager$| Problem$| Merchant$/, "")} / ${parts[1].label}`;
  return parts[0]?.label ?? "Unscouted Coach";
}

function statEvidence(stats: any, keys: string[]) {
  const evidence: string[] = [];
  if (keys.includes("air_game")) evidence.push(`${stats.passingYardsAvg} passing YPG, ${Math.round(passShare(stats) * 100)}% pass-yard share`);
  if (keys.includes("ground_game")) evidence.push(`${stats.rushingYardsAvg} rushing YPG, ${Math.round(rushShare(stats) * 100)}% rush-yard share`);
  if (keys.includes("shootout")) evidence.push(`${stats.pointsForAvg} PPG, ${stats.highScoringRate}% high-scoring games`);
  if (keys.includes("balanced")) evidence.push(`${stats.passingYardsAvg}/${stats.rushingYardsAvg} pass/rush YPG balance`);
  if (keys.includes("efficiency")) evidence.push(`${stats.redZoneOffPct}% red-zone offense, ${stats.turnoversCommittedAvg} giveaways/G`);
  if (keys.includes("defense")) evidence.push(`${stats.pointsAgainstAvg} points allowed/G, ${stats.turnoversGeneratedAvg} takeaways/G`);
  if (keys.includes("situational")) evidence.push(`${stats.fourthDownConversionsAvg} fourth-down conversions/G, ${stats.closeGameRate}% close games`);
  if (keys.includes("clock_control")) evidence.push(`${stats.firstDownsAvg} first downs/G with ${stats.turnoversCommittedAvg} giveaways/G`);
  if (keys.includes("chaos")) evidence.push(`${(stats.turnoversCommittedAvg + stats.turnoversGeneratedAvg).toFixed(1)} combined turnovers/G`);
  if (keys.includes("red_zone")) evidence.push(`${stats.redZoneOffPct}% red-zone offense`);
  if (keys.includes("field_position")) evidence.push(`${stats.returnYardsAvg} return yards/G`);
  if (keys.includes("option_program")) evidence.push(`${stats.rushingYardsAvg} rushing YPG, ${Math.round(rushShare(stats) * 100)}% rush-yard share`);
  if (keys.includes("campus_power")) evidence.push(`${(stats.pointsForAvg - stats.pointsAgainstAvg).toFixed(1)} point differential/G`);
  if (keys.includes("home_field")) evidence.push(`${stats.pointsAgainstAvg} points allowed/G with ${stats.redZoneDefPct}% opponent red-zone offense`);
  if (keys.includes("special_teams")) evidence.push(`${stats.returnYardsAvg} return yards/G`);
  if (keys.includes("bend_dont_break")) evidence.push(`${stats.yardsAllowedAvg} yards allowed/G but ${stats.pointsAgainstAvg} points allowed/G`);
  if (keys.includes("grinder")) evidence.push(`${stats.closeGameRate}% close games`);
  return [...new Set(evidence)];
}

function styleSummary(parts: Array<{ key: string; label: string; summary: string }>, stats: any) {
  const keys = parts.map((part) => part.key);
  if (!parts.length) return "Not enough approved box-score data has been logged to build a reliable scouting profile yet.";

  const lead = (() => {
    if (keys.includes("shootout") && keys.includes("air_game") && keys.includes("chaos")) {
      return "This coach wants the game fast and noisy: passing volume, scoring pressure, and turnover swings all show up in the profile.";
    }
    if (keys.includes("option_program") && keys.includes("clock_control")) {
      return "This coach is building a college-style option identity: rushing volume creates the base, first downs keep the offense on schedule, and the game tends to bend around their pace.";
    }
    if (keys.includes("option_program") && keys.includes("campus_power")) {
      return "This coach turns a run-first offense into program pressure, using option-style production to create separation instead of just surviving close possessions.";
    }
    if (keys.includes("campus_power") && keys.includes("defense")) {
      return "This coach profiles like a ranked-program problem: strong margins, enough scoring punch to build leads, and defensive resistance that keeps opponents from trading evenly.";
    }
    if (keys.includes("home_field") && keys.includes("defense")) {
      return "This coach's profile gets heavier in home-field games, where defensive stands and low points allowed make the matchup feel uncomfortable early.";
    }
    if (keys.includes("special_teams") && keys.includes("field_position")) {
      return "This coach changes the field before the offense snaps the ball, stacking return yards and hidden-yardage edges that shorten drives.";
    }
    if (keys.includes("clock_control") && keys.includes("defense")) {
      return "This coach is built to shorten games, stack first downs, and force opponents to win long drives against a defense that closes well.";
    }
    if (keys.includes("efficiency") && keys.includes("grinder")) {
      return "This coach plays a low-waste, possession-focused style where clean drives and close-game execution matter more than fireworks.";
    }
    if (keys.includes("defense") && keys.includes("bend_dont_break")) {
      return "This coach can concede movement, but the profile tightens near scoring range and keeps games from turning into track meets.";
    }
    if (keys.includes("red_zone") && keys.includes("efficiency")) {
      return "This coach's offense is defined by finishing drives: fewer empty possessions, strong red-zone conversion, and controlled mistakes.";
    }
    if (keys.includes("ground_game") && keys.includes("clock_control")) {
      return "This coach leans into possession football, using the run game and chain-moving drives to keep opponents chasing the tempo.";
    }
    if (keys.includes("balanced") && keys.includes("defense")) {
      return "This coach has a balanced offensive base with enough defensive resistance to avoid becoming one-dimensional in close games.";
    }
    if (keys.includes("balanced") && keys.includes("clock_control")) {
      return "This coach mixes run and pass production into sustained drives, creating a balanced profile that still values possession control.";
    }
    if (keys.includes("field_position")) {
      return "This coach gets value outside the normal box score, using return yards and hidden field position to tilt possessions.";
    }
    return parts[0].summary;
  })();

  const texture: string[] = [];
  if (stats?.gamesLogged) {
    if (Number(stats.pointsForAvg ?? 0) >= 32) texture.push(`The offense is producing ${stats.pointsForAvg} points per game`);
    if (Number(stats.pointsAgainstAvg ?? 99) <= 20) texture.push(`the defense is holding opponents to ${stats.pointsAgainstAvg} points per game`);
    if (Number(stats.turnoversCommittedAvg ?? 99) <= 1) texture.push(`giveaways are staying low at ${stats.turnoversCommittedAvg} per game`);
    if (Number(stats.closeGameRate ?? 0) >= 45) texture.push(`${stats.closeGameRate}% of logged games are close`);
  }

  const detail = texture.length ? ` ${texture.slice(0, 2).join(", ")}.` : "";
  return `${lead}${detail}`;
}

function buildIdentityFromSignals(badges: any[], seasonStats: any, game?: string | null) {
  if (!badges.length && (!seasonStats || seasonStats.gamesLogged === 0)) {
    return {
      identityKey: "unscouted",
      identityLabel: "Unscouted Coach",
      summary: "Not enough approved box-score badge history has been logged yet.",
      primary: null,
      secondary: null,
      accent: null,
      confidence: 0,
      scores: {},
      topBadges: [],
      evidence: ["No badge history yet."],
    };
  }

  const availableGroups = IDENTITY_GROUPS.filter((group) => !group.games?.length || group.games.includes(String(game ?? "madden_26")));
  const groupScores = availableGroups.map((group) => {
    const matching = badges.filter((badge) => group.badges.has(String(badge.badge_key)));
    const badgePoints = matching.reduce((sum, badge) => sum + badgeScore(badge), 0);
    const statPoints = seasonStats ? group.statScore(seasonStats) : 0;
    const score = badgePoints + statPoints;
    return { group, matching, score, badgePoints, statPoints };
  }).sort((a, b) => b.score - a.score);

  const best = groupScores[0];
  const fallback = best && best.score > 0 ? null : {
    key: "badge_collector",
    label: "Badge Collector",
    summary: "Has a broad achievement profile without one dominant tendency yet.",
  };
  const primary = fallback ? fallback : best.group;
  const meaningful = groupScores.filter((entry) => entry.score >= 12);
  const secondary = meaningful[1] && meaningful[1].score >= Math.max(12, meaningful[0].score * 0.7) ? meaningful[1].group : null;
  const accent = meaningful[2] && meaningful[2].score >= Math.max(10, meaningful[0].score * 0.5) ? meaningful[2].group : null;
  const parts = [primary, secondary, accent].filter(Boolean) as Array<{ key: string; label: string; summary: string }>;
  const evidenceBadges = (best?.matching?.length ? best.matching : badges)
    .sort((a, b) => badgeScore(b) - badgeScore(a))
    .slice(0, 3)
    .map(mapOwnedBadge);
  const statLines = seasonStats?.gamesLogged ? statEvidence(seasonStats, parts.map((part) => part.key)).slice(0, 4) : [];
  const badgeLines = evidenceBadges.map((badge) => {
    const earns = Number(badge.earned_count ?? badge.earned_value ?? 1);
    const tier = badge.tier && badge.tier !== "normal" ? `${String(badge.tier).toUpperCase()} ` : "";
    return `${tier}${badge.badge_label}: ${earns} earn${earns === 1 ? "" : "s"}${badge.badge_description ? ` - ${badge.badge_description}` : ""}`;
  });

  return {
    identityKey: parts.map((part) => part.key).join("+"),
    identityLabel: blendLabel(parts),
    summary: styleSummary(parts, seasonStats),
    primary: primary.key,
    secondary: secondary?.key ?? null,
    accent: accent?.key ?? null,
    confidence: Math.min(99, Math.round((meaningful[0]?.score ?? 0) + (secondary ? 8 : 0) + (accent ? 4 : 0))),
    scores: Object.fromEntries(groupScores.map((entry) => [entry.group.key, { total: entry.score, badges: entry.badgePoints, stats: entry.statPoints }])),
    topBadges: evidenceBadges,
    evidence: [...statLines, ...badgeLines].slice(0, 6),
  };
}

export async function getLeagueUserIdentities(guildId: string) {
  const context = await findCurrentLeagueContext(guildId);
  const leagueId = context?.leagueId ?? null;
  const league: any = context?.rec_leagues ?? null;
  if (!leagueId) return { league: null, identities: [] };

  const seasonNumber = Number(league?.season_number ?? league?.display_season_number ?? 1);
  const [{ data: assignments, error: assignmentError }, { data: badges, error: badgeError }] = await Promise.all([
    supabase
      .from("rec_team_assignments")
      .select("user_id,team_id,user:rec_users(display_name),team:rec_teams(name,abbreviation,display_city,display_nick,is_relocated)")
      .eq("league_id", leagueId)
      .eq("assignment_status", "active")
      .is("ended_at", null),
    supabase
      .from("rec_badge_ownership")
      .select("badge_key,badge_scope,tier,earned_count,last_earned_week,created_at,updated_at,league_id,season,week,user_id")
      .eq("league_id", leagueId)
      .or(`season.eq.${seasonNumber},season.is.null`),
  ]);
  if (assignmentError) throw new ApiError(500, "Failed to load active users for identities.", assignmentError);
  if (badgeError) throw new ApiError(500, "Failed to load badge identities.", badgeError);

  const userIds = [...new Set((assignments ?? []).map((assignment: any) => assignment.user_id).filter(Boolean))];
  const discordResult = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", userIds)
    : { data: [], error: null };
  if (discordResult.error) throw new ApiError(500, "Failed to load Discord identities.", discordResult.error);
  const discordByUser = new Map((discordResult.data ?? []).map((account: any) => [account.user_id, account]));

  const badgesByUser = new Map<string, any[]>();
  for (const badge of badges ?? []) {
    if (!badge.user_id) continue;
    const rows = badgesByUser.get(badge.user_id) ?? [];
    rows.push(badge);
    badgesByUser.set(badge.user_id, rows);
  }

  const identities = await Promise.all((assignments ?? []).map(async (assignment: any) => {
    const discordAcc = discordByUser.get(assignment.user_id) ?? null;
    const seasonStats = assignment.user_id
      ? await loadSeasonBoxScoreStats(assignment.user_id, leagueId, seasonNumber).catch(() => null)
      : null;
    const userBadges = badgesByUser.get(assignment.user_id) ?? [];
    const identity = buildIdentityFromSignals(userBadges, seasonStats, league?.game);
    const careerBadges = userBadges
      .filter((b: any) => b.badge_scope === "career")
      .map((b: any) => ({ ...b, badgeLabel: BADGE_LABELS.get(b.badge_key) ?? b.badge_key }));
    return {
      userId: assignment.user_id,
      teamId: assignment.team_id,
      discordId: discordAcc?.discord_id ?? null,
      displayName: assignment.user?.display_name ?? discordAcc?.global_name ?? discordAcc?.username ?? "Coach",
      teamName: formatTeamDisplayName(assignment.team) ?? assignment.team?.name ?? null,
      seasonStats,
      careerTrophies: careerBadges,
      ...identity,
    };
  }));
  identities.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));

  return {
    league: {
      id: leagueId,
      name: league?.name ?? null,
      seasonNumber,
      currentWeek: league?.current_week ?? null,
    },
    identities,
  };
}

export async function refreshActiveLeagueBadgeBaselines(guildId: string) {
  const context = await findCurrentLeagueContext(guildId);
  const leagueId = context?.leagueId ?? null;
  const league: any = context?.rec_leagues ?? null;
  if (!leagueId) throw new ApiError(404, "No active league found for this guild.");

  const { data: assignments, error } = await supabase
    .from("rec_team_assignments")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (error) throw new ApiError(500, "Failed to load active users for badge refresh.", error);

  const userIds = [...new Set((assignments ?? []).map((row) => row.user_id).filter(Boolean))];
  if (userIds.length) await rebuildOfficialGlobalRecords(userIds);
  const seasonNumber = Number(league?.season_number ?? league?.display_season_number ?? 1);
  const badgeResult = await recomputeActiveLeagueBadgeBaselines(leagueId, seasonNumber);
  return { ok: true, usersUpdated: badgeResult.usersUpdated, leagueId, seasonNumber };
}

export async function getLeagueSeasonXfBadges(guildId: string, seasonNumber?: number | null) {
  const context = await findCurrentLeagueContext(guildId);
  const leagueId = context?.leagueId ?? null;
  const league: any = context?.rec_leagues ?? null;
  if (!leagueId) return { league: null, badges: [] };

  const season = Number(seasonNumber ?? league?.season_number ?? league?.display_season_number ?? 1);
  // "XF" badges: the old streak-tiering system's top special tier. Repurposed to mean
  // gold-tier positive game-scope badges (10+ occurrences this season) under the
  // occurrence-count tiering model — same "call out an exceptional season" intent.
  const [{ data: rows, error }, { data: assignments }] = await Promise.all([
    supabase
      .from("rec_badge_ownership")
      .select("user_id,team_id,badge_key,tier,earned_count,last_earned_week,updated_at")
      .eq("league_id", leagueId)
      .eq("season", season)
      .eq("badge_scope", "game")
      .eq("polarity", "positive")
      .eq("tier", "gold")
      .order("updated_at", { ascending: false }),
    supabase
      .from("rec_team_assignments")
      .select("user_id,team_id,user:rec_users(display_name),team:rec_teams(name,abbreviation,display_city,display_nick,is_relocated)")
      .eq("league_id", leagueId)
      .eq("assignment_status", "active")
      .is("ended_at", null),
  ]);
  if (error) throw new ApiError(500, "Failed to load XF season badges.", error);

  const userIds = [...new Set((assignments ?? []).map((assignment: any) => assignment.user_id).filter(Boolean))];
  const discordResult = userIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id,username,global_name").in("user_id", userIds)
    : { data: [], error: null };
  if (discordResult.error) throw new ApiError(500, "Failed to load Discord identities.", discordResult.error);
  const discordByUser = new Map((discordResult.data ?? []).map((account: any) => [account.user_id, account]));

  const activeByUser = new Map((assignments ?? []).map((assignment: any) => [assignment.user_id, assignment]));
  const badges = (rows ?? []).map((row: any) => {
    const assignment = activeByUser.get(row.user_id);
    const discordAcc = discordByUser.get(row.user_id) ?? null;
    return {
      ...row,
      badgeLabel: BADGE_LABELS.get(row.badge_key) ?? row.badge_key,
      badgeDescription: BADGE_DESCRIPTIONS.get(row.badge_key) ?? null,
      discordId: discordAcc?.discord_id ?? null,
      displayName: assignment?.user?.display_name ?? discordAcc?.global_name ?? discordAcc?.username ?? "Coach",
      teamName: formatTeamDisplayName(assignment?.team) ?? null,
    };
  });

  return {
    league: { id: leagueId, name: league?.name ?? null, seasonNumber: season },
    badges,
  };
}

// Returns all data needed for the User Snapshots paginated viewer in /menu > Rosters.
// Aggregates season records, global records, badges, power ranking, SOS, GOTW records,
// GOTW competition history, and awards won in the given guild.
export async function getUserSnapshot(targetDiscordId: string, guildId: string) {
  const baseline = await getUserBaselineByDiscordId(targetDiscordId);
  const userId = baseline.user.id;

  const context = await findCurrentLeagueContext(guildId);
  const leagueId = context?.leagueId ?? null;

  const assignmentResult = leagueId
    ? await supabase
        .from("rec_team_assignments")
        .select("team_id,team:rec_teams(name,abbreviation,display_city,display_nick,is_relocated)")
        .eq("league_id", leagueId)
        .eq("user_id", userId)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .maybeSingle()
    : { data: null };
  const teamId = (assignmentResult.data as any)?.team_id ?? null;
  const teamRow = (assignmentResult.data as any)?.team ?? null;

  const leagueInfoResult = leagueId
    ? await supabase.from("rec_leagues").select("name,game,season_number,display_season_number,current_week,season_stage").eq("id", leagueId).maybeSingle()
    : { data: null };
  const leagueInfo = leagueInfoResult.data;
  const seasonNumber = leagueInfo?.season_number ?? leagueInfo?.display_season_number ?? 1;
  const leagueGame = String(leagueInfo?.game ?? "madden_26");
  const sameGameLeagues = await supabase.from("rec_leagues").select("id").eq("game", leagueGame);
  if (sameGameLeagues.error) throw new ApiError(500, "Failed to load same-game badge leagues.", sameGameLeagues.error);
  const sameGameLeagueIds = (sameGameLeagues.data ?? []).map((row: any) => row.id).filter(Boolean);

  const [
    seasonRecord,
    seasonBadges,
    globalBadges,
    gotwGuessRecord,
    gotwCompetition,
    globalAwardWinners,
    eosPollWins,
    seasonStats,
    careerStats,
    financialSummary,
    globalRecordRow,
    gameGlobalRecordRow,
  ] = await Promise.all([
    leagueId
      ? supabase
          .from("rec_season_user_records")
          .select("wins,losses,ties,games_played,point_differential,points_for,points_against")
          .eq("league_id", leagueId)
          .eq("season_number", seasonNumber)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    leagueId
      ? supabase
          .from("rec_badge_ownership")
          .select("badge_key,badge_scope,polarity,tier,earned_count,last_earned_week,created_at,updated_at,league_id,season,week")
          .in("league_id", sameGameLeagueIds.length ? sameGameLeagueIds : [leagueId])
          .eq("user_id", userId)
          .in("badge_scope", ["game", "season"])
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    leagueId
      ? supabase
        .from("rec_badge_ownership")
        .select("badge_key,badge_scope,polarity,tier,earned_count,last_earned_week,created_at,updated_at,league_id,season,week")
        .in("league_id", sameGameLeagueIds.length ? sameGameLeagueIds : [leagueId])
        .eq("user_id", userId)
        .eq("badge_scope", "career")
        .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("rec_global_gotw_guessing_records").select("correct_guesses,wrong_guesses").eq("user_id", userId).maybeSingle(),
    leagueId
      ? supabase
          .from("rec_game_of_week_polls")
          .select("home_team_id,away_team_id,winning_team_id,status,week_number")
          .eq("league_id", leagueId)
          .not("status", "eq", "open")
          .order("week_number", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    supabase
      .from("rec_award_winners")
      .select("award_key,award_name,season_number,league_id")
      .eq("winner_user_id", userId)
      .order("season_number", { ascending: false }),
    supabase
      .from("rec_eos_award_polls")
      .select("category_key,category_label,season_number,league_id")
      .eq("winner_user_id", userId)
      .not("winner_user_id", "is", null),
    leagueId ? loadSeasonBoxScoreStats(userId, leagueId, seasonNumber) : Promise.resolve(null),
    loadCareerBoxScoreStats(userId),
    loadUserFinancialSummary(userId, leagueId),
    supabase.from("rec_global_user_records").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("rec_global_user_game_records").select("*").eq("user_id", userId).eq("game", leagueGame).maybeSingle(),
  ]);

  const teamName = formatTeamDisplayName(teamRow);
  const globalRecord = (globalRecordRow as any)?.data ?? baseline.globalRecord ?? {};
  const gameGlobalRecord = buildGameRecordForDisplay(
    (gameGlobalRecordRow as any)?.data ?? null,
    leagueGame,
    baseline.legacyBaseline?.global_record as Record<string, unknown> | null | undefined,
  );

  let gotwWins = 0;
  let gotwLosses = 0;
  const gotwPolls = (gotwCompetition as any)?.data ?? [];
  for (const poll of gotwPolls) {
    if (!teamId) break;
    const isParticipant = String(poll.home_team_id) === String(teamId) || String(poll.away_team_id) === String(teamId);
    if (!isParticipant || poll.status !== "settled" || !poll.winning_team_id) continue;
    if (String(poll.winning_team_id) === String(teamId)) gotwWins += 1;
    else gotwLosses += 1;
  }

  const seasonRecordData = (seasonRecord as any)?.data ?? {};
  const gotwGuess = (gotwGuessRecord as any)?.data;
  const gotwCorrect = gotwGuess?.correct_guesses ?? 0;
  const gotwWrong = gotwGuess?.wrong_guesses ?? 0;
  const gotwTotal = gotwCorrect + gotwWrong;
  const [rankingResult, sosResult] = leagueId && teamId
    ? await Promise.all([
        computePowerRankings(guildId, targetDiscordId).catch(() => null),
        computeLeagueSos(guildId, targetDiscordId).catch(() => null),
      ])
    : [null, null];
  const rankRow = rankingResult?.teams?.find((team: any) => String(team.teamId) === String(teamId)) ?? null;
  const sosRow = sosResult?.teams?.find((team: any) => String(team.teamId) === String(teamId)) ?? null;

  const globalAwardCounts = new Map<string, number>();
  for (const award of (globalAwardWinners as any)?.data ?? []) {
    const label = award.award_name ?? award.award_key ?? "Award";
    globalAwardCounts.set(label, (globalAwardCounts.get(label) ?? 0) + 1);
  }
  for (const poll of (eosPollWins as any)?.data ?? []) {
    const label = poll.category_label ?? poll.category_key ?? "EOS Poll";
    globalAwardCounts.set(label, (globalAwardCounts.get(label) ?? 0) + 1);
  }

  return {
    user: baseline.user,
    discord: baseline.discord,
    teamName,
    schoolName: resolveTeamSchool(teamRow) ?? teamName,
    leagueName: leagueInfo?.name ?? null,
    seasonNumber,
    currentWeek: leagueInfo?.current_week ?? null,
    seasonStage: leagueInfo?.season_stage ?? null,
    seasonRecord: {
      wins: seasonRecordData.wins ?? 0,
      losses: seasonRecordData.losses ?? 0,
      ties: seasonRecordData.ties ?? 0,
      pointDifferential: seasonRecordData.point_differential ?? 0,
      pointsFor: seasonRecordData.points_for ?? 0,
      pointsAgainst: seasonRecordData.points_against ?? 0,
      text: recordText(seasonRecordData),
      boxScoresUploaded: seasonStats?.boxScoresUploaded ?? 0,
      activeStreak: seasonStats?.activeStreak ?? "—",
    },
    globalRecord: {
      wins: globalRecord.wins ?? 0,
      losses: globalRecord.losses ?? 0,
      ties: globalRecord.ties ?? 0,
      pointDifferential: globalRecord.point_differential ?? 0,
      playoffWins: globalRecord.playoff_wins ?? 0,
      playoffLosses: globalRecord.playoff_losses ?? 0,
      superbowlWins: globalRecord.superbowl_wins ?? 0,
      superbowlLosses: globalRecord.superbowl_losses ?? 0,
      text: recordText(globalRecord),
      playoffText: playoffText(globalRecord),
      superbowlText: superbowlText(globalRecord),
      activeStreak: careerStats?.activeStreak ?? "—",
    },
    gameGlobalRecord: leagueId ? buildGameGlobalRecordDisplay(gameGlobalRecord, leagueGame) : null,
    powerRank: rankRow ? { rank: rankRow.rank, score: rankRow.score, sosScore: sosRow?.sosFullPerGame ?? sosRow?.sosFull ?? null } : null,
    gotwGuessing: gotwTotal > 0 ? { correct: gotwCorrect, total: gotwTotal, accuracy: Math.round((gotwCorrect / gotwTotal) * 100) } : null,
    gotwCompetition: gotwWins + gotwLosses > 0 ? { wins: gotwWins, losses: gotwLosses } : null,
    seasonStats,
    careerStats,
    badges: aggregateOwnedBadges([...((seasonBadges as any)?.data ?? []), ...((globalBadges as any)?.data ?? [])], leagueId, Number(seasonNumber)),
    seasonBadges: ((seasonBadges as any)?.data ?? []).filter((r: any) => r.badge_scope === "season").map(mapOwnedBadge),
    weeklyBadges: ((seasonBadges as any)?.data ?? []).filter((r: any) => r.badge_scope === "game").map(mapOwnedBadge),
    globalBadges: ((globalBadges as any)?.data ?? []).map(mapOwnedBadge),
    globalAwards: [...globalAwardCounts.entries()].map(([awardName, count]) => ({ awardName, count })).sort((a, b) => a.awardName.localeCompare(b.awardName)),
    financialSummary,
  };
}

function schedulePhaseOrder(phase?: string | null) {
  const normalized = String(phase ?? "regular_season");
  const order: Record<string, number> = {
    regular_season: 0,
    wild_card: 1,
    divisional: 2,
    conference_championship: 3,
    super_bowl: 4
  };
  return order[normalized] ?? 9;
}

function teamName(row: any, side: "home" | "away") {
  const team = side === "home" ? row.home_team : row.away_team;
  return team?.name ?? team?.abbreviation ?? (side === "home" ? "Home" : "Away");
}

function matchupKey(row: any) {
  return `match:${row.season_number ?? ""}:${row.week_number ?? ""}:${row.home_team_id ?? ""}:${row.away_team_id ?? ""}`;
}

export async function getUserScheduleByDiscordId(discordId: string, guildId: string) {
  const context = await findCurrentLeagueContext(guildId);
  const league: any = context?.rec_leagues ?? null;
  if (!context?.leagueId || !league?.id) {
    return { isLinked: false, hasLoggedSchedule: false, league: null, team: null, games: [] };
  }

  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id,username,global_name")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account", account.error);
  if (!account.data?.user_id) {
    return { isLinked: false, hasLoggedSchedule: false, league, team: null, games: [] };
  }

  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id,team:rec_teams(id,name,abbreviation,display_city,display_nick,is_relocated)")
    .eq("league_id", league.id)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load linked team", assignment.error);
  const teamId = (assignment.data as any)?.team_id;
  if (!teamId) {
    return { isLinked: false, hasLoggedSchedule: false, league, team: null, games: [] };
  }

  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const seasonId = await resolveSeasonId(league.id, seasonNumber);
  const [{ data: scheduledGames, error: gamesError }, { data: gameResults, error: resultsError }] = await Promise.all([
    supabase
      .from("rec_games")
      .select("id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)")
      .eq("league_id", league.id)
      .eq("season_id", seasonId)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .lte("week_number", 22),
    supabase
      .from("rec_game_results")
      .select("week_number,season_number,home_team_id,away_team_id,home_score,away_score,winning_user_id")
      .eq("league_id", league.id)
      .eq("season_number", seasonNumber)
      .lte("week_number", regularSeasonWeeks(league.game))
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`),
  ]);
  if (gamesError) throw new ApiError(500, "Failed to load schedule", gamesError);
  const hasLoggedSchedule = (scheduledGames ?? []).length > 0;
  if (resultsError) throw new ApiError(500, "Failed to load schedule results", resultsError);
  const resultsByMatchup = new Map(
    (gameResults ?? []).map((result: any) => [
      matchupKey({
        season_number: result.season_number,
        week_number: result.week_number,
        home_team_id: result.home_team_id,
        away_team_id: result.away_team_id,
      }),
      result,
    ]),
  );

  const scheduledTeamIds = [...new Set((scheduledGames ?? []).flatMap((game: any) => [game.home_team_id, game.away_team_id]).filter(Boolean))];
  const teamAssignments = scheduledTeamIds.length
    ? await supabase
        .from("rec_team_assignments")
        .select("team_id,user_id")
        .eq("league_id", league.id)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .in("team_id", scheduledTeamIds)
    : { data: [], error: null };
  if (teamAssignments.error) throw new ApiError(500, "Failed to load team assignments for schedule", teamAssignments.error);
  const userByTeamId = new Map((teamAssignments.data ?? []).map((row) => [row.team_id, row.user_id]));

  const opponentUserIds = [...new Set((scheduledGames ?? []).flatMap((game: any) => {
    const isHome = game.home_team_id === teamId;
    const opponentTeamId = isHome ? game.away_team_id : game.home_team_id;
    const opponentUserId = (isHome ? game.away_user_id : game.home_user_id) ?? userByTeamId.get(opponentTeamId);
    return opponentUserId ? [opponentUserId] : [];
  }))];
  // Include linked users for every scheduled team so H2H mentions resolve even when rec_games user ids are stale.
  for (const userId of userByTeamId.values()) {
    if (userId) opponentUserIds.push(userId);
  }
  const uniqueUserIds = [...new Set(opponentUserIds)];
  const opponentAccounts = uniqueUserIds.length
    ? await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", uniqueUserIds)
    : { data: [], error: null };
  if (opponentAccounts.error) throw new ApiError(500, "Failed to load opponent Discord accounts", opponentAccounts.error);
  const discordByUserId = new Map((opponentAccounts.data ?? []).map((row) => [row.user_id, row.discord_id]));

  const gamesByWeek = new Map<number, any>();
  for (const game of scheduledGames ?? []) {
    const weekNumber = Number(game.week_number ?? 0);
    // Include playoff weeks (19–22) too, so the current-week matchup resolves in
    // the postseason. The `games` array below stays regular-season only.
    if (weekNumber >= 1 && weekNumber <= 22) gamesByWeek.set(weekNumber, game);
  }

  function resolveGameUserId(game: any, side: "home" | "away") {
    const teamKey = side === "home" ? "home_team_id" : "away_team_id";
    const userKey = side === "home" ? "home_user_id" : "away_user_id";
    return game[userKey] ?? userByTeamId.get(game[teamKey]) ?? null;
  }

  function opponentLabel(game: any, isHome: boolean) {
    const opponentTeam = isHome ? game.away_team : game.home_team;
    const opponentUserId = isHome
      ? resolveGameUserId(game, "away")
      : resolveGameUserId(game, "home");
    if (opponentUserId) {
      const discordId = discordByUserId.get(opponentUserId);
      if (discordId) return `<@${discordId}>`;
    }
    return resolveTeamNick(opponentTeam);
  }

  // A team's display label: the linked user's @mention (renders as their nickname,
  // and doesn't ping inside an embed) for a user team, otherwise the team name.
  function sideLabel(game: any, side: "home" | "away") {
    const userId = resolveGameUserId(game, side);
    if (userId) {
      const discordId = discordByUserId.get(userId);
      if (discordId) return `<@${discordId}>`;
    }
    return resolveTeamNick(side === "home" ? game.home_team : game.away_team);
  }

  const games = [];
  for (let week = 1; week <= regularSeasonWeeks(league.game); week += 1) {
    const game = gamesByWeek.get(week);
    if (!game) {
      games.push({
        weekNumber: week,
        phase: "regular_season",
        isBye: true,
      });
      continue;
    }

    const isHome = game.home_team_id === teamId;
    const displayLabel = opponentLabel(game, isHome);
    const homeUserId = resolveGameUserId(game, "home");
    const awayUserId = resolveGameUserId(game, "away");
    const result = resultsByMatchup.get(matchupKey({
      season_number: seasonNumber,
      week_number: game.week_number,
      home_team_id: game.home_team_id,
      away_team_id: game.away_team_id,
    }));
    games.push({
      weekNumber: week,
      phase: game.phase ?? "regular_season",
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamName: formatTeamDisplayName(game.home_team) ?? teamName(game, "home"),
      awayTeamName: formatTeamDisplayName(game.away_team) ?? teamName(game, "away"),
      homeUserId,
      awayUserId,
      homeLabel: sideLabel(game, "home"),
      awayLabel: sideLabel(game, "away"),
      homeScore: result?.home_score ?? null,
      awayScore: result?.away_score ?? null,
      isCompleted: result?.home_score != null && result?.away_score != null,
      isHome,
      isH2h: Boolean(homeUserId && awayUserId),
      opponentLabel: displayLabel,
    });
  }

  // Current-week matchup, resolved from any week INCLUDING the playoffs (the
  // `games` array above is regular-season only). Consumers like the stream
  // header need the active matchup even in weeks 19–22.
  const currentWeekNum = Number(league.current_week ?? 0);
  const currentGame = gamesByWeek.get(currentWeekNum) ?? null;
  let currentMatchup: any = null;
  if (currentGame) {
    const homeUserId = resolveGameUserId(currentGame, "home");
    const awayUserId = resolveGameUserId(currentGame, "away");
    currentMatchup = {
      weekNumber: currentWeekNum,
      phase: currentGame.phase ?? null,
      homeTeamId: currentGame.home_team_id,
      awayTeamId: currentGame.away_team_id,
      homeTeamName: formatTeamDisplayName(currentGame.home_team) ?? teamName(currentGame, "home"),
      awayTeamName: formatTeamDisplayName(currentGame.away_team) ?? teamName(currentGame, "away"),
      homeUserId,
      awayUserId,
      homeLabel: sideLabel(currentGame, "home"),
      awayLabel: sideLabel(currentGame, "away"),
      isHome: currentGame.home_team_id === teamId,
      isH2h: Boolean(homeUserId && awayUserId),
    };
  }

  const teamRow = (assignment.data as any)?.team ?? null;
  return {
    isLinked: true,
    hasLoggedSchedule,
    league: {
      ...league,
      currentWeek: league.current_week ?? null,
      seasonStage: league.season_stage ?? league.current_phase ?? null,
    },
    team: teamRow ? { ...teamRow, name: formatTeamDisplayName(teamRow) ?? teamRow.name } : null,
    games,
    currentMatchup,
  };
}

function recordText(record: any) {
  return `${record?.wins ?? 0}-${record?.losses ?? 0}-${record?.ties ?? 0}`;
}

export function formatLeagueGameLabel(game?: string | null) {
  switch (String(game ?? "madden_26")) {
    case "madden_27": return "Madden NFL 27";
    case "cfb_27": return "College Football 27";
    default: return "Madden NFL 26";
  }
}

function recordTotalGames(record: Record<string, unknown> | null | undefined) {
  return Number(record?.games_played ?? record?.gamesPlayed ?? 0)
    || Number(record?.wins ?? 0) + Number(record?.losses ?? 0) + Number(record?.ties ?? 0);
}

function addRecordFields(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined) {
  return {
    wins: Number(a?.wins ?? 0) + Number(b?.wins ?? 0),
    losses: Number(a?.losses ?? 0) + Number(b?.losses ?? 0),
    ties: Number(a?.ties ?? 0) + Number(b?.ties ?? 0),
    playoff_wins: Number(a?.playoff_wins ?? 0) + Number(b?.playoff_wins ?? 0),
    playoff_losses: Number(a?.playoff_losses ?? 0) + Number(b?.playoff_losses ?? 0),
    superbowl_wins: Number(a?.superbowl_wins ?? 0) + Number(b?.superbowl_wins ?? 0),
    superbowl_losses: Number(a?.superbowl_losses ?? 0) + Number(b?.superbowl_losses ?? 0),
    point_differential: Number(a?.point_differential ?? 0) + Number(b?.point_differential ?? 0),
    games_played: recordTotalGames(a) + recordTotalGames(b),
  };
}

function buildGameRecordForDisplay(
  gameRecord: Record<string, unknown> | null | undefined,
  leagueGame: string,
  legacyBaselineRecord: Record<string, unknown> | null | undefined,
) {
  if (leagueGame !== "madden_26") return gameRecord ?? null;
  const baselineGames = recordTotalGames(legacyBaselineRecord);
  if (baselineGames <= 0) return gameRecord ?? null;
  const gameGames = recordTotalGames(gameRecord);

  // Some existing madden_26 rows were created from box scores only. The legacy
  // all-games baseline is Madden 26 history until newer game families exist.
  if (!gameRecord || gameGames < baselineGames) return addRecordFields(legacyBaselineRecord, gameRecord);
  return gameRecord;
}

function buildGameGlobalRecordDisplay(row: Record<string, unknown> | null | undefined, leagueGame: string) {
  const record = row ?? {};
  return {
    game: leagueGame,
    label: formatLeagueGameLabel(leagueGame),
    wins: Number(record.wins ?? 0),
    losses: Number(record.losses ?? 0),
    ties: Number(record.ties ?? 0),
    pointDifferential: Number(record.point_differential ?? 0),
    playoffWins: Number(record.playoff_wins ?? 0),
    playoffLosses: Number(record.playoff_losses ?? 0),
    superbowlWins: Number(record.superbowl_wins ?? 0),
    superbowlLosses: Number(record.superbowl_losses ?? 0),
    text: recordText(record),
    playoffText: playoffText(record),
    superbowlText: superbowlText(record),
  };
}

function playoffText(record: any) {
  return `${record?.playoff_wins ?? 0}-${record?.playoff_losses ?? 0}`;
}

function superbowlText(record: any) {
  return `${record?.superbowl_wins ?? 0}-${record?.superbowl_losses ?? 0}`;
}

function stageDisplay(stage?: string | null) {
  return String(stage ?? "regular_season").replaceAll("_", " ");
}

async function loadUserBadges(userId: string, leagueId: string) {
  try {
    const result = await supabase
      .from("rec_badge_ownership")
      .select("badge_key,badge_scope,polarity,tier,earned_count,last_earned_week,created_at,updated_at,league_id,season,week")
      .eq("league_id", leagueId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (result.error) return [];
    return (result.data ?? []).map(mapOwnedBadge);
  } catch {
    // Some environments may not have the badge table yet. Do not break /menu.
    return [];
  }
}

// Current win/loss/tie streak for a user, derived from completed game results (most recent first).
function streakFromGames(games: any[], userId: string): string {
  const completed = games
    .filter((g) => (Number(g.home_score) || 0) > 0 || (Number(g.away_score) || 0) > 0)
    .sort((a, b) => (a.season_number - b.season_number) || (a.week_number - b.week_number));
  let streak = 0;
  let type: "W" | "L" | "T" | null = null;
  for (let i = completed.length - 1; i >= 0; i--) {
    const g = completed[i];
    const isHome = g.home_user_id === userId;
    const mine = Number(isHome ? g.home_score : g.away_score) || 0;
    const opp = Number(isHome ? g.away_score : g.home_score) || 0;
    const res: "W" | "L" | "T" = mine > opp ? "W" : mine < opp ? "L" : "T";
    if (type === null) { type = res; streak = 1; }
    else if (res === type) streak += 1;
    else break;
  }
  return type && streak > 0 ? `${type}${streak}` : "—";
}

// Projected savings interest on the next advance (matches advance-time SAVINGS_INTEREST_RATE of 3.5%, floored).
const SAVINGS_INTEREST_RATE = 0.035;

export async function getUserMenuProfileByDiscordId(discordId: string, guildId: string) {
  const baseline = await getUserBaselineByDiscordId(discordId);
  const userId = baseline.user.id;

  const context = await findCurrentLeagueContext(guildId);
  const server: any = context?.rec_discord_servers ?? null;
  const league: any = context?.rec_leagues ?? null;

  let assignment: any = null;
  let membership: any = null;
  let seasonRecord: any = null;
  let displayRecord: any = null;
  let currentMatchup = "None";
  let currentGame: any = null;
  let gotwStatus = "No";
  let badges: any[] = [];
  let youAre = "BYE WEEK";
  let matchupType = "NONE";
  let opponentUserId: string | null = null;
  let opponentName: string | null = null;

  if (league?.id) {
    const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
    const currentWeek = league.current_week ?? 1;
    const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
    const isPostseason = postseasonPayoutStages(league.game).has(stage);
    const isPreseason = stage === "preseason" || stage === "preseason_training_camp";
    const isGameplayStage = gameplaySeasonStages(league.game).has(stage);

    const [assignmentResult, membershipResult, seasonRecordResult, displayRecordResult] = await Promise.all([
      supabase
        .from("rec_team_assignments")
        .select("team_id,assignment_status,team:rec_teams(id,name,abbreviation,display_city,display_nick,is_relocated)")
        .eq("league_id", league.id)
        .eq("user_id", userId)
        .eq("assignment_status", "active")
        .is("ended_at", null)
        .maybeSingle(),
      supabase
        .from("rec_league_memberships")
        .select("role,status")
        .eq("league_id", league.id)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("rec_season_user_records")
        .select("*")
        .eq("league_id", league.id)
        .eq("season_number", seasonNumber)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("rec_season_user_display_records")
        .select("wins,losses,ties,point_differential")
        .eq("league_id", league.id)
        .eq("season_number", seasonNumber)
        .eq("user_id", userId)
        .maybeSingle()
    ]);

    if (assignmentResult.error) throw new ApiError(500, "Failed to load linked team", assignmentResult.error);
    if (membershipResult.error) throw new ApiError(500, "Failed to load league role", membershipResult.error);
    if (seasonRecordResult.error) throw new ApiError(500, "Failed to load season record", seasonRecordResult.error);

    assignment = assignmentResult.data;
    membership = membershipResult.data;
    seasonRecord = seasonRecordResult.data;
    displayRecord = displayRecordResult.data ?? null;
    badges = await loadUserBadges(userId, league.id);

    if (assignment?.team_id) {
      // Preseason has no scheduled slate for anyone — never surface a matchup here even if
      // one was already entered into the schedule builder ahead of time.
      if (isPreseason) {
        currentMatchup = "Preseason (No Games)";
      } else {
        const games = await supabase
          .from("rec_games")
          .select("*, home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation), away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation)")
          .eq("league_id", league.id)
          .eq("week_number", currentWeek)
          .or(`home_team_id.eq.${assignment.team_id},away_team_id.eq.${assignment.team_id}`)
          .limit(1)
          .maybeSingle();

        if (!games.error && games.data) {
          const game: any = games.data;
          const isHome = game.home_team_id === assignment.team_id;
          const opponent = isHome ? game.away_team : game.home_team;
          const opponentUser = isHome ? game.away_user_id : game.home_user_id;

          currentGame = game;
          currentMatchup = `${opponent?.name ?? "Opponent"} (${opponentUser ? "User H2H" : "CPU"}, ${isHome ? "Home" : "Away"})`;
          youAre = isHome ? "Home" : "Away";
          matchupType = opponentUser ? "H2H" : "CPU";
          opponentUserId = opponentUser ?? null;
          opponentName = opponent?.name ?? null;

          const gotw = await supabase
            .from("rec_game_of_week_candidates")
            .select("id,is_selected,selection_source,strength_rating")
            .eq("league_id", league.id)
            .eq("season_number", seasonNumber)
            .eq("week_number", currentWeek)
            .eq("game_id", game.id)
            .eq("is_selected", true)
            .maybeSingle();

          if (!gotw.error && gotw.data) {
            gotwStatus = `Yes${gotw.data.strength_rating ? ` (${Number(gotw.data.strength_rating).toFixed(1)} rating)` : ""}`;
          } else if (isPostseason) {
            gotwStatus = "Yes - Playoff GOTW";
          }
        } else if (isGameplayStage) {
          // A real gameplay week (regular season or postseason) with no rec_games row for
          // this team — distinguish a deliberately-scheduled bye from a matchup the
          // commissioner just hasn't entered yet.
          const byeCheck = await supabase
            .from("rec_team_byes")
            .select("id")
            .eq("league_id", league.id)
            .eq("season_number", seasonNumber)
            .eq("team_id", assignment.team_id)
            .eq("week_number", currentWeek)
            .maybeSingle();
          if (byeCheck.error) throw new ApiError(500, "Failed to check bye week status", byeCheck.error);
          currentMatchup = "BYE WEEK";
        } else if (isPostseason) {
          currentMatchup = "Season Concluded";
        } else {
          currentMatchup = stageDisplay(stage);
        }
      }
    } else {
      currentMatchup = "None";
    }
  }

  const leagueGame = String(league?.game ?? "madden_26");
  const [globalRecordResult, gameGlobalRecordResult] = await Promise.all([
    supabase.from("rec_global_user_records").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("rec_global_user_game_records").select("*").eq("user_id", userId).eq("game", leagueGame).maybeSingle(),
  ]);
  const globalRecord = globalRecordResult.data ?? baseline.globalRecord ?? {};
  const gameGlobalRecord = buildGameRecordForDisplay(
    gameGlobalRecordResult.data ?? null,
    leagueGame,
    baseline.legacyBaseline?.global_record as Record<string, unknown> | null | undefined,
  );

  // GOTW voting record — read from the settled aggregate table (populated by settleGotwVotes
  // during advance). The raw rec_game_of_week_votes table can have null user_id when the
  // Discord→user lookup fails at vote-cast time, so the aggregate is more reliable.
  let gotwVotingRecord = null;
  const { data: gotwRecord } = await supabase
    .from("rec_global_gotw_guessing_records")
    .select("correct_guesses,wrong_guesses")
    .eq("user_id", userId)
    .maybeSingle();

  if (gotwRecord) {
    const correct = gotwRecord.correct_guesses ?? 0;
    const wrong = gotwRecord.wrong_guesses ?? 0;
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    gotwVotingRecord = { correct, total, accuracy };
  }

  // Projected next-advance savings interest (3.5% of savings, floored).
  const savingsBalance = baseline.wallet?.savings_balance ?? 0;
  const projectedInterest = Math.floor(savingsBalance * SAVINGS_INTEREST_RATE);

  // User/opponent current streaks and opponent season record.
  let userStreakText = "—";
  let opponentRecordText = "—";
  let opponentPointDifferential = 0;
  let opponentStreakText = "—";
  if (league?.id) {
    const profileSeason = league.season_number ?? league.display_season_number ?? 1;
    const { data: userGames } = await supabase
      .from("rec_game_results")
      .select("home_user_id,away_user_id,home_score,away_score,season_number,week_number,source")
      .eq("league_id", league.id)
      .eq("season_number", profileSeason)
      .in("source", [...OFFICIAL_RESULT_SOURCES])
      .or(`home_user_id.eq.${userId},away_user_id.eq.${userId}`);
    userStreakText = streakFromGames(userGames ?? [], userId);

    if (opponentUserId) {
      const [oppRecordResult, oppGamesResult] = await Promise.all([
        supabase.from("rec_season_user_records").select("*").eq("league_id", league.id).eq("season_number", profileSeason).eq("user_id", opponentUserId).maybeSingle(),
        supabase.from("rec_game_results").select("home_user_id,away_user_id,home_score,away_score,season_number,week_number,source").eq("league_id", league.id).eq("season_number", profileSeason).in("source", [...OFFICIAL_RESULT_SOURCES]).or(`home_user_id.eq.${opponentUserId},away_user_id.eq.${opponentUserId}`)
      ]);
      opponentRecordText = recordText(oppRecordResult.data ?? {});
      opponentPointDifferential = oppRecordResult.data?.point_differential ?? 0;
      opponentStreakText = streakFromGames(oppGamesResult.data ?? [], opponentUserId);
    }
  }

  // All-time GOTW head-to-head record (populated during advance once GOTW games are settled).
  let gotwH2hRecordText = "No GOTW games yet";
  const { data: gotwH2h } = await supabase
    .from("rec_global_gotw_h2h_records")
    .select("wins,losses,ties")
    .eq("user_id", userId)
    .maybeSingle();
  if (gotwH2h) {
    const w = gotwH2h.wins ?? 0, l = gotwH2h.losses ?? 0, t = gotwH2h.ties ?? 0;
    if (w + l + t > 0) gotwH2hRecordText = t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
  }

  return {
    user: baseline.user,
    discord: baseline.discord,
    wallet: baseline.wallet ?? { wallet_balance: 0, savings_balance: 0 },
    server,
    league,
    team: assignment?.team ?? null,
    role: membership?.role ?? null,
    seasonRecord,
    currentMatchup,
    currentGame,
    globalRecord,
    gameGlobalRecord,
    badges,
    gotwVotingRecord,
    display: {
      discordUsername: baseline.discord.global_name ?? baseline.discord.username ?? baseline.user.display_name,
      teamName: assignment?.team?.name ?? null,
      schoolName: resolveTeamSchool(assignment?.team) ?? assignment?.team?.name ?? null,
      highestRole: membership?.role ?? null,
      wallet: baseline.wallet?.wallet_balance ?? 0,
      savings: baseline.wallet?.savings_balance ?? 0,
      leagueName: league?.name ?? "Current League",
      seasonNumber: league?.season_number ?? league?.display_season_number ?? 1,
      currentWeek: league?.current_week ?? 1,
      seasonStage: league?.season_stage ?? league?.current_phase ?? "regular_season",
      leagueTeamRecordText: recordText(displayRecord),
      leagueUserRecordText: recordText(seasonRecord),
      leagueSeasonRecordText: recordText(seasonRecord),
      leagueSeasonPointDifferential: seasonRecord?.point_differential ?? 0,
      currentMatchupText: currentMatchup,
      gotwStatus,
      gotwVotingRecordText: gotwVotingRecord ? `${gotwVotingRecord.correct}-${gotwVotingRecord.total - gotwVotingRecord.correct} (${gotwVotingRecord.accuracy}%)` : "No votes yet",
      globalRecordText: recordText(globalRecord),
      globalChampionships: Number(globalRecord?.superbowl_wins ?? 0),
      globalPointDifferential: globalRecord?.point_differential ?? 0,
      gameGlobalRecord: league?.id
        ? buildGameGlobalRecordDisplay(gameGlobalRecord, leagueGame)
        : null,
      gameGlobalRecordText: league?.id ? recordText(gameGlobalRecord ?? {}) : null,
      gameGlobalPlayoffText: league?.id ? playoffText(gameGlobalRecord ?? {}) : null,
      gameGlobalSuperbowlText: league?.id ? superbowlText(gameGlobalRecord ?? {}) : null,
      gameGlobalPointDifferential: gameGlobalRecord?.point_differential ?? 0,
      gameGlobalLabel: league?.id ? formatLeagueGameLabel(leagueGame) : null,
      game: leagueGame,
      projectedInterest,
      youAreText: youAre,
      matchupType,
      opponentName,
      opponentRecordText,
      opponentPointDifferential,
      opponentStreakText,
      userStreakText,
      gotwH2hRecordText,
      badges
    }
  };
}
