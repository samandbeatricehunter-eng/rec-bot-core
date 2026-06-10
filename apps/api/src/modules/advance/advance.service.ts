import { REC_GOTW_CORRECT_GUESS_PAYOUT, REC_POTW_PAYOUT_AMOUNT, REC_WEEKLY_CHALLENGE_PAYOUTS, calculateDefensivePotwScore, calculateOffensivePotwScore } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { calculateAdvanceGamePayouts } from "./advance-payouts.service.js";

const TIME_ZONES = [
  ["EST", "America/New_York"],
  ["CST", "America/Chicago"],
  ["PST", "America/Los_Angeles"],
  ["AKST", "America/Anchorage"]
] as const;

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickStat(stats: any, keys: string[]) {
  for (const key of keys) {
    if (stats?.[key] !== undefined && stats?.[key] !== null) return asNumber(stats[key]);
  }
  return 0;
}

export function formatAdvanceTimes(nextAdvanceAt?: string | null) {
  if (!nextAdvanceAt) return [];
  const date = new Date(nextAdvanceAt);
  if (Number.isNaN(date.getTime())) return [];
  return TIME_ZONES.map(([label, timeZone]) => ({
    label,
    value: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short"
    }).format(date)
  }));
}

// League teams are stored with full names ("Jacksonville Jaguars"); game channels and matchup
// text should use just the nickname ("Jaguars"). The nickname is the trailing word of the name.
function teamNickname(name: string | null | undefined, fallback: string) {
  const text = (name ?? "").trim();
  if (!text) return fallback;
  const parts = text.split(/\s+/);
  return parts[parts.length - 1] || fallback;
}

function humanizeFourthDownRule(type: string | null | undefined, custom: string | null | undefined) {
  if (!type) return "Use league settings.";
  if (type === "custom") return custom?.trim() || "Custom league fourth-down rule (see league rules).";
  if (type === "standard_rec") return "Standard REC Rule: past midfield on 4th & 3 or less. If trailing in the second half, you may go for it on any 4th down.";
  if (type === "none") return "No 4th down restrictions.";
  const text = type.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function streamingRequirementText(requirement: string | null | undefined) {
  if (requirement === "required") return "Streaming is required for this game.";
  if (requirement === "optional") return "Streaming is optional for this game.";
  if (requirement === "not_required") return "Streaming is not required for this game.";
  return "Based on league settings";
}

async function getLeagueConfiguration(leagueId: string) {
  const { data } = await supabase.from("rec_league_configuration").select("*").eq("league_id", leagueId).maybeSingle();
  return (data ?? null) as any;
}

async function resolveDiscordIdsByUser(userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", ids);
  for (const row of data ?? []) if (row.user_id && row.discord_id) map.set(String(row.user_id), String(row.discord_id));
  return map;
}

const BADGE_QUALIFIERS: Record<string, string> = {
  // Season-persistent badges
  comeback_artist: "winning after a 3+ game losing streak",
  record_breaker_wins: "breaking the league's all-time wins record",
  record_breaker_point_differential: "breaking the league's all-time point differential record",
  record_breaker_points_for: "breaking the league's all-time points scored record",
  record_holder_wins: "permanently holding the league's all-time wins record",
  record_holder_point_differential: "permanently holding the league's all-time point differential record",
  record_holder_points_for: "permanently holding the league's all-time points scored record",
  // Season-end cumulative badges
  undefeated: "going 17-0 through an undefeated regular season",
  dominant: "finishing the regular season with an 80%+ win rate",
  winning_season: "finishing the regular season with more wins than losses",
  scoring_leader: "leading the league in total points scored",
  high_octane: "averaging 40+ points per game",
  blowout_master: "winning 50%+ of games by 21+ points",
  shutout_king: "holding opponents scoreless 3+ times",
  closer: "winning 50%+ of games by 7 or fewer points",
  defensive_powerhouse: "allowing the fewest points in the league",
  h2h_dominator: "going undefeated in all head-to-head matchups",
  h2h_specialist: "maintaining an 85%+ win rate in H2H matchups",
  // New season-end badges
  road_warrior: "going undefeated on the road this season",
  home_fortress: "going undefeated at home this season",
  cardiac_cats: "winning 6+ games by one score or fewer",
  offensive_juggernaut: "finishing in the top 3 in scoring offense",
  defensive_anchor: "finishing in the top 3 in scoring defense",
  // Playoff/championship badges
  playoff_qualifier: "qualifying for the playoffs",
  wild_card_survivor: "winning the Wild Card round",
  conference_champion: "winning the Conference Championship",
  playoff_warrior: "earning 3+ playoff wins in a single postseason",
  perfect_playoff_run: "winning the Super Bowl without a single playoff loss",
  sb_champion: "winning the Super Bowl",
  sb_runner_up: "finishing as Super Bowl runner-up",
  // Weekly performance badges (earned per advance, tracked for prestige)
  air_raid: "throwing for 400+ yards with 4+ TDs in a win",
  ground_assault: "rushing for 200+ yards in a win",
  balanced_offense_week: "throwing for 250+ and rushing for 150+ yards in a win",
  turnover_machine: "forcing 3+ turnovers in a win",
  sack_artist: "recording 5+ sacks in a win",
  lockdown_week: "holding the opponent to 150 or fewer passing yards in a win"
};

function getPrestigeTier(totalEarned: number): string {
  if (totalEarned >= 50) return "diamond";
  if (totalEarned >= 30) return "platinum";
  if (totalEarned >= 15) return "gold";
  if (totalEarned >= 5) return "silver";
  return "bronze";
}

async function incrementBadgePrestige(userId: string, badgeName: string) {
  try {
    const { data: existing } = await supabase
      .from("rec_user_badge_prestige")
      .select("total_earned")
      .eq("user_id", userId)
      .eq("badge_name", badgeName)
      .maybeSingle();
    const newTotal = (existing?.total_earned ?? 0) + 1;
    const tier = getPrestigeTier(newTotal);
    const now = nowIso();
    if (existing) {
      await supabase.from("rec_user_badge_prestige")
        .update({ total_earned: newTotal, prestige_tier: tier, last_earned_at: now, updated_at: now })
        .eq("user_id", userId).eq("badge_name", badgeName);
    } else {
      await supabase.from("rec_user_badge_prestige").insert({
        user_id: userId, badge_name: badgeName, total_earned: 1,
        prestige_tier: "bronze", first_earned_at: now, last_earned_at: now,
        created_at: now, updated_at: now
      });
    }
  } catch {
    // Non-fatal
  }
}

async function issueBadgeBonuses(
  earnedBadges: Array<{ user_id: string; badge_name: string }>,
  leagueId: string,
  seasonNumber: number
) {
  if (earnedBadges.length === 0) return;
  const features = await getLeagueFeatureSettings(leagueId).catch(() => null);
  if (!features?.coin_economy_enabled) return;
  for (const badge of earnedBadges) {
    await creditUserWallet({
      userId: badge.user_id,
      leagueId,
      seasonNumber,
      amount: 5,
      transactionType: "badge_bonus",
      description: `Badge bonus: ${badge.badge_name.replace(/_/g, " ")}`,
      sourceReference: { idempotencyKey: `badge_bonus_${badge.user_id}_${leagueId}_${badge.badge_name}` }
    }).catch(() => undefined);
    await incrementBadgePrestige(badge.user_id, badge.badge_name);
  }
}

function slug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "game";
}

async function getLeagueContext(guildId: string) {
  const serverResult = await supabase
    .from("rec_discord_servers")
    .select("id,name,guild_id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (serverResult.error) throw serverResult.error;
  if (!serverResult.data) throw new Error("No REC Discord server record found for this guild.");

  const linkResult = await supabase
    .from("rec_server_league_links")
    .select("server_id, league_id")
    .eq("server_id", serverResult.data.id)
    .limit(1)
    .maybeSingle();
  if (linkResult.error) throw linkResult.error;
  if (!linkResult.data?.league_id) throw new Error("No league linked to this Discord server.");

  const leagueResult = await supabase
    .from("rec_leagues")
    .select("*")
    .eq("id", linkResult.data.league_id)
    .maybeSingle();
  if (leagueResult.error) throw leagueResult.error;
  if (!leagueResult.data) throw new Error("Linked REC league was not found.");

  return {
    server_id: serverResult.data.id,
    league_id: linkResult.data.league_id,
    rec_discord_servers: serverResult.data,
    rec_leagues: leagueResult.data
  } as any;
}

async function getRoutes(serverId: string) {
  const { data, error } = await supabase.from("rec_server_routes").select("*").eq("server_id", serverId).maybeSingle();
  if (error) throw error;
  return data as any;
}


function nowIso() {
  return new Date().toISOString();
}

function deadlineDisplay(date: Date) {
  return Object.fromEntries(formatAdvanceTimes(date.toISOString()).map((time) => [time.label, time.value]));
}

async function getDiscordIdForUserId(userId?: string | null) {
  if (!userId) return null;
  const { data } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId).maybeSingle();
  return data?.discord_id ?? null;
}

async function getLinkedActiveTeamUsers(leagueId: string) {
  const { data, error } = await supabase
    .from("rec_team_assignments")
    .select("team_id,user_id,rec_teams(id,name,abbreviation,conference,division)")
    .eq("league_id", leagueId)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (error) throw error;
  return (data ?? []) as any[];
}

async function getWalletBalance(userId: string) {
  const { data } = await supabase.from("rec_wallets").select("wallet_balance,savings_balance").eq("user_id", userId).maybeSingle();
  return { wallet: asNumber(data?.wallet_balance), savings: asNumber(data?.savings_balance) };
}

// BADGES SYSTEM
// Weekly and seasonal badge definitions and auto-assignment
const BADGE_DEFINITIONS = {
  // Weekly badges
  hot_streak: { name: "Hot Streak", tier: "gold", category: "weekly", description: "3+ wins in a row this season" },
  unstoppable: { name: "Unstoppable", tier: "gold", category: "weekly", description: "500+ points scored this week" },
  defensive_wall: { name: "Defensive Wall", tier: "silver", category: "weekly", description: "Opponent scored <10 points" },
  grind: { name: "Grind", tier: "bronze", category: "weekly", description: "Won a close game (≤7 point margin)" },
  shutout_king: { name: "Shutout King", tier: "platinum", category: "weekly", description: "Held opponent to 0 points" },
  challenge_master: { name: "Challenge Master", tier: "gold", category: "weekly", description: "Completed all 3 weekly challenge tiers" },
  perfect_week: { name: "Perfect Week", tier: "platinum", category: "weekly", description: "Won game + all 3 challenge tiers" },

  // Season-end badges
  champion: { name: "🏆 Champion", tier: "platinum", category: "season_end", description: "League champion" },
  runner_up: { name: "🥈 Runner-Up", tier: "gold", category: "season_end", description: "Playoff finals runner-up" },
  finals_appearance: { name: "Finals Appearance", tier: "gold", category: "season_end", description: "Made playoff finals" },
  playoff_clinch: { name: "Playoff Clinch", tier: "silver", category: "season_end", description: "Made playoffs" },
  most_points: { name: "Scoring Machine", tier: "gold", category: "season_end", description: "Most total points scored" },
  best_defense: { name: "Fort Knox", tier: "gold", category: "season_end", description: "Best defensive record" },
  comeback_king: { name: "Comeback King", tier: "silver", category: "season_end", description: "Won final game after losing streak" },
  iron_man: { name: "Iron Man", tier: "bronze", category: "season_end", description: "Played all games" }
};

/**
 * Assigns Record Breaker badges when users break existing league records
 * Called dynamically per advance to track record-breaking moments in real-time
 *
 * Records tracked:
 * - points_for: Total season points scored (highest wins)
 * - points_against: Total season points allowed (lowest wins)
 * - wins: Total wins in season (highest wins)
 *
 * Behavior:
 * - When a new record is set, previous holder's Record Breaker badge is removed
 * - New Record Breaker badge assigned to current record holder
 * - League record updated with new value and previous holder info
 * - At season end, Record Breaker → Record Holder badge conversion via assignPlayoffBadges()
 *
 * @param leagueId - League to check records for
 * @param seasonNumber - Current season
 * @returns Count of badges assigned
 */
async function assignRecordBreakerBadges(leagueId: string, seasonNumber: number) {
  const { data: allRecords } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,point_differential,points_for,games_played")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);

  if (!allRecords || allRecords.length === 0) return { assigned: 0, earned: [], removed: [] };

  const badgesToAssign: any[] = [];
  const removedBadges: Array<{ user_id: string; badge_name: string; badge_label: string }> = [];
  const recordsToUpdate: any[] = [];

  const records = [
    { metric: "wins", label: "Wins", getter: (r: any) => r.wins },
    { metric: "point_differential", label: "Point Differential", getter: (r: any) => r.point_differential },
    { metric: "points_for", label: "Points Scored", getter: (r: any) => r.points_for ?? 0 }
  ];

  for (const recordType of records) {
    const { data: existingRecord } = await supabase
      .from("rec_league_records")
      .select("*")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .eq("record_name", recordType.label)
      .maybeSingle();

    const recordHolder = existingRecord?.record_holder_id;
    const currentBestValue = existingRecord?.record_value ?? 0;

    let bestUser: string | null = null;
    let bestValue = currentBestValue;

    for (const record of allRecords) {
      const value = recordType.getter(record);
      if (value > bestValue) {
        bestValue = value;
        bestUser = record.user_id;
      }
    }

    if (bestUser && bestValue !== currentBestValue) {
      if (recordHolder && recordHolder !== bestUser) {
        try {
          await supabase
            .from("rec_user_badges")
            .delete()
            .eq("user_id", recordHolder)
            .eq("league_id", leagueId)
            .eq("badge_name", `record_breaker_${recordType.metric}`)
            .eq("season_number", seasonNumber);
          removedBadges.push({
            user_id: recordHolder,
            badge_name: `record_breaker_${recordType.metric}`,
            badge_label: `Record Breaker - ${recordType.label}`
          });
        } catch {
          // Badge removal non-fatal
        }
      }

      badgesToAssign.push({
        user_id: bestUser,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: `record_breaker_${recordType.metric}`,
        badge_label: `Record Breaker - ${recordType.label}`,
        earned_value: bestValue,
        earned_at: nowIso()
      });

      recordsToUpdate.push({
        league_id: leagueId,
        season_number: seasonNumber,
        record_name: recordType.label,
        record_value: bestValue,
        record_holder_id: bestUser,
        previous_holder_id: recordHolder,
        previous_value: currentBestValue,
        updated_at: nowIso()
      });
    }
  }

  // Pre-check which badges already exist so we only bonus truly new ones
  const newBadges: typeof badgesToAssign = [];
  if (badgesToAssign.length > 0) {
    const { data: existingBadges } = await supabase
      .from("rec_user_badges")
      .select("user_id,badge_name")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .in("badge_name", badgesToAssign.map((b) => b.badge_name));
    const existingSet = new Set((existingBadges ?? []).map((b: any) => `${b.user_id}:${b.badge_name}`));
    for (const b of badgesToAssign) {
      if (!existingSet.has(`${b.user_id}:${b.badge_name}`)) newBadges.push(b);
    }
    try {
      await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,season_number" });
    } catch {
      // Non-fatal
    }
  }

  if (recordsToUpdate.length > 0) {
    try {
      await supabase.from("rec_league_records").upsert(recordsToUpdate, { onConflict: "league_id,season_number,record_name" });
    } catch {
      // Non-fatal
    }
  }

  await issueBadgeBonuses(newBadges, leagueId, seasonNumber);

  return { assigned: badgesToAssign.length, earned: newBadges, removed: removedBadges };
}

/**
 * Assigns Comeback Artist badge when user wins a game after 3+ consecutive losses
 * Called per advance to detect when users break losing streaks
 *
 * Badge behavior:
 * - Can only be earned once per season
 * - Assigned when threshold is first reached (win after 3+ loss streak)
 * - Removed at season end (cleared during offseason transition)
 * - Does not carry over to next season
 *
 * Threshold: Win a game after losing 3+ consecutive games in same season
 *
 * @param guildId - Guild context to get league
 * @returns Count of badges assigned
 */
async function assignCombackArtistBadges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  // Get all users in league for this season
  const { data: allUsers } = await supabase
    .from("rec_league_user_records")
    .select("user_id")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber);

  if (!allUsers) return { assigned: 0 };

  const badgesToAssign: any[] = [];

  for (const user of allUsers) {
    // Check if user already has Comeback Artist badge this season
    const { data: existingBadge } = await supabase
      .from("rec_user_badges")
      .select("id")
      .eq("user_id", user.user_id)
      .eq("league_id", context.league_id)
      .eq("badge_name", "comeback_artist")
      .eq("season_number", seasonNumber)
      .maybeSingle();

    if (existingBadge) continue; // Skip if already earned

    // Get all game results in chronological order to track losing streaks
    const { data: games } = await supabase
      .from("rec_game_results")
      .select("id,home_user_id,away_user_id,winning_user_id,losing_user_id,played_at")
      .eq("league_id", context.league_id)
      .eq("season_number", seasonNumber)
      .order("played_at", { ascending: true });

    if (!games) continue;

    // Scan game history to detect losing streak followed by win
    let lossStreak = 0;
    let hasComebackArtist = false;

    for (const game of games) {
      const isLoss = game.losing_user_id === user.user_id;
      const isWin = game.winning_user_id === user.user_id;

      if (isLoss) {
        lossStreak++;
      } else if (isWin && lossStreak >= 3) {
        // Found a win after 3+ losses → Comeback Artist earned!
        hasComebackArtist = true;
        break;
      } else if (isWin) {
        // Win but no 3+ streak → reset counter
        lossStreak = 0;
      }
    }

    if (hasComebackArtist) {
      badgesToAssign.push({
        user_id: user.user_id,
        league_id: context.league_id,
        season_number: seasonNumber,
        badge_name: "comeback_artist",
        badge_label: "Comeback Artist",
        earned_at: nowIso()
      });
    }
  }

  if (badgesToAssign.length > 0) {
    try {
      await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,season_number" });
    } catch {
      // Non-fatal
    }
    // All entries in badgesToAssign are newly earned (pre-checked via existingBadge above)
    await issueBadgeBonuses(badgesToAssign, context.league_id, seasonNumber);
  }

  return { assigned: badgesToAssign.length, earned: badgesToAssign };
}

async function assignWeeklyPerformanceBadges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);

  const { data: games } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_team_id,away_team_id,home_score,away_score,winning_user_id")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek);

  if (!games?.length) return { assigned: 0, earned: [] };

  const leagueId = context.league_id;
  const badgesToAssign: Array<{ user_id: string; badge_name: string; badge_label: string }> = [];

  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeamId: game.away_team_id, score: game.home_score, oppScore: game.away_score },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeamId: game.home_team_id, score: game.away_score, oppScore: game.home_score }
    ].filter((s) => s.userId && s.teamId);

    for (const side of sides) {
      const didWin = game.winning_user_id === side.userId;
      if (!didWin) continue;

      const [passR, rushR, defR] = await Promise.all([
        sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["passYds"]),
        sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["rushYds"]),
        Promise.all([
          sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["defSacks"]),
          sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["defInts"]),
          sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["defForcedFum"])
        ])
      ]);
      const [sacksR, intsR, fumR] = defR;
      const passTdR = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["passTDs"]);
      const oppPassR = side.opponentTeamId ? await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.opponentTeamId, ["passYds"]) : { total: 999, hasData: false };

      if (passR.hasData && passR.total >= 400 && passTdR.total >= 4) {
        badgesToAssign.push({ user_id: side.userId, badge_name: "air_raid", badge_label: "Air Raid" });
      }
      if (rushR.hasData && rushR.total >= 200) {
        badgesToAssign.push({ user_id: side.userId, badge_name: "ground_assault", badge_label: "Ground Assault" });
      }
      if (passR.hasData && rushR.hasData && passR.total >= 250 && rushR.total >= 150) {
        badgesToAssign.push({ user_id: side.userId, badge_name: "balanced_offense_week", badge_label: "Balanced Offense" });
      }
      if (intsR.hasData && (intsR.total + fumR.total) >= 3) {
        badgesToAssign.push({ user_id: side.userId, badge_name: "turnover_machine", badge_label: "Turnover Machine" });
      }
      if (sacksR.hasData && sacksR.total >= 5) {
        badgesToAssign.push({ user_id: side.userId, badge_name: "sack_artist", badge_label: "Sack Artist" });
      }
      if (oppPassR.hasData && oppPassR.total <= 150) {
        badgesToAssign.push({ user_id: side.userId, badge_name: "lockdown_week", badge_label: "Lockdown" });
      }
    }
  }

  if (badgesToAssign.length === 0) return { assigned: 0, earned: [] };

  // For weekly performance badges these are ephemeral — we always credit if newly earned this advance.
  // Prestige tracks the lifetime count. Issue bonuses (which also increments prestige).
  await issueBadgeBonuses(badgesToAssign, leagueId, seasonNumber);

  return { assigned: badgesToAssign.length, earned: badgesToAssign };
}

async function assignWeeklyBadges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const [comebackResult, recordResult, perfResult] = await Promise.all([
    assignCombackArtistBadges(guildId),
    assignRecordBreakerBadges(context.league_id, seasonNumber),
    assignWeeklyPerformanceBadges(guildId)
  ]);

  const earned = [
    ...(comebackResult.earned ?? []),
    ...(recordResult.earned ?? []),
    ...(perfResult.earned ?? [])
  ];
  const removed = [...(recordResult.removed ?? [])];

  return { assigned: comebackResult.assigned + recordResult.assigned + perfResult.assigned, earned, removed };
}

/**
 * SEASON-END BADGE ASSIGNMENT - Regular Season Cumulative Badges
 *
 * Called when regular season ends and league transitions to playoffs (Week 18 → 19)
 * Assigns all cumulative badges based on full season statistics
 *
 * BADGE THRESHOLDS:
 * ─────────────────────────────────────────────────────────────────────
 * WINS/RECORDS (per user):
 *   Undefeated        → 18-0 regular season record (perfect)
 *   Dominant          → 80%+ win rate (15+ wins in 18 games)
 *   Winning Season    → More wins than losses (breakeven: 10-8)
 *
 * OFFENSIVE (cumulative season stats):
 *   Scoring Leader    → Most total points scored in season (league-wide)
 *   High Octane       → 40+ points per game average (40*18 = 720 min pts)
 *   Blowout Master    → 50%+ of wins by 21+ point margin (8+ wins required)
 *
 * DEFENSIVE (cumulative season stats):
 *   Defensive Power   → Fewest total points allowed in season (league-wide)
 *   Shutout King      → 3+ games where opponent scored 0 points
 *
 * HEAD-TO-HEAD (global stats, not league-specific):
 *   H2H Dominator     → 0 losses in H2H matchups (8+ H2H games minimum)
 *   H2H Specialist    → 85%+ win rate in H2H matchups (8+ H2H games minimum)
 *
 * CLUTCH:
 *   Closer            → 50%+ of wins by ≤7 points (10+ wins required)
 *
 * @param leagueId - League to assign badges for
 * @param seasonNumber - Season to assign badges for
 * @returns Count of badges assigned
 */
async function assignSeasonEndBadges(leagueId: string, seasonNumber: number) {
  const badgesToAssign: any[] = [];

  // Pre-fetch all season records for this league (single query, used by all badge logic)
  const { data: seasonRecords } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,losses,ties,games_played,point_differential,points_for,points_against")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);

  if (!seasonRecords || seasonRecords.length === 0) return { assigned: 0 };

  // Pre-fetch all regular season games (not playoff) for this league
  const { data: allGames } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,home_score,away_score,winning_user_id,losing_user_id,point_differential")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", false); // Regular season only (not playoff games)

  // Pre-fetch global H2H records (used for H2H Dominator/Specialist badges)
  const { data: h2hRecords } = await supabase
    .from("rec_user_h2h_global_records")
    .select("user_a_id,user_b_id,wins,losses,ties")
    .in("user_a_id", seasonRecords.map((r: any) => r.user_id))
    .or(`user_b_id.in.(${seasonRecords.map((r: any) => r.user_id).join(",")})`);

  // Build index of games by user for efficient O(1) lookups
  const gamesByUser = new Map<string, any[]>();
  for (const game of allGames ?? []) {
    if (game.home_user_id) {
      if (!gamesByUser.has(game.home_user_id)) gamesByUser.set(game.home_user_id, []);
      gamesByUser.get(game.home_user_id)?.push(game);
    }
    if (game.away_user_id) {
      if (!gamesByUser.has(game.away_user_id)) gamesByUser.set(game.away_user_id, []);
      gamesByUser.get(game.away_user_id)?.push(game);
    }
  }

  // === INDIVIDUAL USER BADGES (per-user logic) ===
  for (const record of seasonRecords) {
    const userId = record.user_id;
    const userGames = gamesByUser.get(userId) ?? [];

    // UNDEFEATED: 18-0 regular season
    if (record.wins === 17 && record.losses === 0) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "undefeated",
        badge_label: "Undefeated",
        earned_at: nowIso()
      });
    }

    // DOMINANT: 80%+ win rate (threshold = 14 wins in 17 games minimum)
    const winPct = record.games_played > 0 ? record.wins / record.games_played : 0;
    if (winPct >= 0.80) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "dominant",
        badge_label: "Dominant",
        earned_at: nowIso()
      });
    }

    // WINNING SEASON: More wins than losses (breakeven = 9-8)
    if (record.wins > record.losses) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "winning_season",
        badge_label: "Winning Season",
        earned_at: nowIso()
      });
    }

    // BLOWOUT MASTER: 50%+ of wins by 21+ point margin
    // Requires 8+ wins minimum (50% of 16 = 8 blowout wins needed)
    const blowoutWins = userGames.filter((g: any) => {
      const isHome = g.home_user_id === userId;
      const userScore = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;
      return userScore > oppScore && (userScore - oppScore) >= 21;
    }).length;
    if (record.wins > 0 && (blowoutWins / record.wins) >= 0.5) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "blowout_master",
        badge_label: "Blowout Master",
        earned_at: nowIso()
      });
    }

    // HIGH OCTANE: 40+ points per game average
    const ppg = record.games_played > 0 ? (record.points_for ?? 0) / record.games_played : 0;
    if (ppg >= 40) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "high_octane",
        badge_label: "High Octane",
        earned_value: Number(ppg.toFixed(1)),
        earned_at: nowIso()
      });
    }

    // SHUTOUT KING: 3+ games where opponent scored 0 points
    const shutouts = userGames.filter((g: any) => {
      const oppScore = g.home_user_id === userId ? g.away_score : g.home_score;
      return oppScore === 0;
    }).length;
    if (shutouts >= 3) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "shutout_king",
        badge_label: "Shutout King",
        earned_at: nowIso()
      });
    }

    // CLOSER: 50%+ of wins by ≤7 points
    // Requires 10+ wins minimum to prevent low sample-size bias
    const closeWins = userGames.filter((g: any) => {
      const isHome = g.home_user_id === userId;
      const userScore = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;
      return userScore > oppScore && (userScore - oppScore) <= 7;
    }).length;
    if (record.wins >= 10 && (closeWins / record.wins) >= 0.5) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "closer",
        badge_label: "Closer",
        earned_at: nowIso()
      });
    }

    // ROAD WARRIOR: Undefeated in away games (min 3 games)
    const awayGames = userGames.filter((g: any) => g.away_user_id === userId);
    const awayLosses = awayGames.filter((g: any) => g.winning_user_id && g.winning_user_id !== userId).length;
    if (awayGames.length >= 3 && awayLosses === 0) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "road_warrior",
        badge_label: "Road Warrior",
        earned_at: nowIso()
      });
    }

    // HOME FORTRESS: Undefeated in home games (min 3 games)
    const homeGames = userGames.filter((g: any) => g.home_user_id === userId);
    const homeLosses = homeGames.filter((g: any) => g.winning_user_id && g.winning_user_id !== userId).length;
    if (homeGames.length >= 3 && homeLosses === 0) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "home_fortress",
        badge_label: "Home Fortress",
        earned_at: nowIso()
      });
    }

    // CARDIAC CATS: 6+ one-score wins (margin 1–7 points)
    const oneScoreWins = userGames.filter((g: any) => {
      const isHome = g.home_user_id === userId;
      const margin = (isHome ? g.home_score : g.away_score) - (isHome ? g.away_score : g.home_score);
      return margin >= 1 && margin <= 7;
    }).length;
    if (oneScoreWins >= 6) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "cardiac_cats",
        badge_label: "Cardiac Cats",
        earned_at: nowIso()
      });
    }
  }

  // === LEAGUE-WIDE BADGES (only one winner per league) ===
  if (seasonRecords.length > 0) {
    // SCORING LEADER: Most total points scored in season
    const sortedByPf = [...seasonRecords].sort((a: any, b: any) => (b.points_for ?? 0) - (a.points_for ?? 0));
    if (sortedByPf[0] && (sortedByPf[0].points_for ?? 0) > 0) {
      badgesToAssign.push({
        user_id: sortedByPf[0].user_id,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "scoring_leader",
        badge_label: "Scoring Leader",
        earned_value: sortedByPf[0].points_for,
        earned_at: nowIso()
      });
    }

    // DEFENSIVE POWERHOUSE: Fewest points allowed in season
    const withGames = seasonRecords.filter((r: any) => (r.games_played ?? 0) > 0);
    const sortedByPa = [...withGames].sort((a: any, b: any) => (a.points_against ?? 0) - (b.points_against ?? 0));
    if (sortedByPa[0] && (sortedByPa[0].points_against ?? 0) > 0) {
      badgesToAssign.push({
        user_id: sortedByPa[0].user_id,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "defensive_powerhouse",
        badge_label: "Defensive Powerhouse",
        earned_value: sortedByPa[0].points_against,
        earned_at: nowIso()
      });
    }

    // OFFENSIVE JUGGERNAUT: Top 3 in total points scored
    const sortedByPfAll = [...seasonRecords].sort((a: any, b: any) => (b.points_for ?? 0) - (a.points_for ?? 0));
    for (const r of sortedByPfAll.slice(0, 3)) {
      if ((r.points_for ?? 0) > 0) {
        badgesToAssign.push({
          user_id: r.user_id,
          league_id: leagueId,
          season_number: seasonNumber,
          badge_name: "offensive_juggernaut",
          badge_label: "Offensive Juggernaut",
          earned_value: r.points_for,
          earned_at: nowIso()
        });
      }
    }

    // DEFENSIVE ANCHOR: Top 3 fewest points allowed
    const sortedByPaAll = [...withGames].sort((a: any, b: any) => (a.points_against ?? 0) - (b.points_against ?? 0));
    for (const r of sortedByPaAll.slice(0, 3)) {
      if ((r.points_against ?? 0) > 0) {
        badgesToAssign.push({
          user_id: r.user_id,
          league_id: leagueId,
          season_number: seasonNumber,
          badge_name: "defensive_anchor",
          badge_label: "Defensive Anchor",
          earned_value: r.points_against,
          earned_at: nowIso()
        });
      }
    }
  }

  // === H2H BADGES (global head-to-head records) ===
  // H2H records are stored globally (not league-specific), aggregating all matchups across seasons
  for (const record of seasonRecords) {
    const userId = record.user_id;
    let h2hWins = 0;
    let h2hLosses = 0;
    let h2hTies = 0;

    // Sum up H2H record: handle both user_a and user_b orientations
    for (const h2h of h2hRecords ?? []) {
      if (h2h.user_a_id === userId) {
        h2hWins += h2h.wins ?? 0;
        h2hLosses += h2h.losses ?? 0;
        h2hTies += h2h.ties ?? 0;
      } else if (h2h.user_b_id === userId) {
        // Swap wins/losses when we're user_b (database stores from user_a perspective)
        h2hWins += h2h.losses ?? 0;
        h2hLosses += h2h.wins ?? 0;
        h2hTies += h2h.ties ?? 0;
      }
    }

    const h2hTotal = h2hWins + h2hLosses + h2hTies;

    // H2H DOMINATOR: 0 losses in H2H matchups (8+ games minimum)
    if (h2hTotal >= 8) {
      if (h2hLosses === 0) {
        badgesToAssign.push({
          user_id: userId,
          league_id: leagueId,
          season_number: seasonNumber,
          badge_name: "h2h_dominator",
          badge_label: "H2H Dominator",
          earned_at: nowIso()
        });
      }

      // H2H SPECIALIST: 85%+ win rate in H2H matchups (8+ games minimum)
      const h2hWinPct = h2hWins / h2hTotal;
      if (h2hWinPct >= 0.85) {
        badgesToAssign.push({
          user_id: userId,
          league_id: leagueId,
          season_number: seasonNumber,
          badge_name: "h2h_specialist",
          badge_label: "H2H Specialist",
          earned_at: nowIso()
        });
      }
    }
  }

  // Pre-check which badges are truly new before upsert
  let newBadges: typeof badgesToAssign = [];
  if (badgesToAssign.length > 0) {
    const { data: existingBadges } = await supabase
      .from("rec_user_badges")
      .select("user_id,badge_name")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .in("badge_name", [...new Set(badgesToAssign.map((b) => b.badge_name))]);
    const existingSet = new Set((existingBadges ?? []).map((b: any) => `${b.user_id}:${b.badge_name}`));
    newBadges = badgesToAssign.filter((b) => !existingSet.has(`${b.user_id}:${b.badge_name}`));
    try {
      await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,season_number" });
    } catch {
      // Non-fatal
    }
    await issueBadgeBonuses(newBadges, leagueId, seasonNumber);
  }

  return { assigned: badgesToAssign.length, earned: newBadges };
}

async function assignPlayoffBadges(leagueId: string, seasonNumber: number) {
  // Assign playoff/championship badges at season end (super_bowl → offseason transition)
  // Also converts Record Breaker → Record Holder
  // Called at super_bowl → wildcard transition

  const badgesToAssign: any[] = [];
  const badgesToRemove: any[] = [];

  // Get final standings from season results
  const { data: seasonResults } = await supabase
    .from("rec_league_season_results")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .maybeSingle();

  if (seasonResults) {
    // Super Bowl Champion
    if (seasonResults.sb_winner) {
      badgesToAssign.push({
        user_id: seasonResults.sb_winner,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "sb_champion",
        badge_label: "🏆 Super Bowl Champion",
        earned_at: nowIso()
      });
    }

    // Super Bowl Runner-Up
    if (seasonResults.sb_loser) {
      badgesToAssign.push({
        user_id: seasonResults.sb_loser,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "sb_runner_up",
        badge_label: "🥈 Super Bowl Runner-Up",
        earned_at: nowIso()
      });
    }
  }

  // Playoff Qualifier: top 8 teams (get from standings)
  const { data: standings } = await supabase
    .from("rec_league_user_records")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("wins", { ascending: false })
    .limit(8);

  for (const record of standings ?? []) {
    badgesToAssign.push({
      user_id: record.user_id,
      league_id: leagueId,
      season_number: seasonNumber,
      badge_name: "playoff_qualifier",
      badge_label: "Playoff Qualifier",
      earned_at: nowIso()
    });
  }

  // Per-user playoff win/loss tracking for new badges
  const { data: playoffGames } = await supabase
    .from("rec_game_results")
    .select("home_user_id,away_user_id,winning_user_id,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("is_playoff", true)
    .order("week_number");

  const playoffWinsByUser = new Map<string, number>();
  const playoffLossesByUser = new Map<string, number>();
  const wildCardWinners = new Set<string>();
  const confChampWinners = new Set<string>();

  for (const g of playoffGames ?? []) {
    const winner = g.winning_user_id;
    const loser = [g.home_user_id, g.away_user_id].find((id) => id && id !== winner);
    if (winner) {
      playoffWinsByUser.set(winner, (playoffWinsByUser.get(winner) ?? 0) + 1);
      if (g.week_number === 19) wildCardWinners.add(winner);
      if (g.week_number === 21) confChampWinners.add(winner);
    }
    if (loser) {
      playoffLossesByUser.set(loser, (playoffLossesByUser.get(loser) ?? 0) + 1);
    }
  }

  // WILD CARD SURVIVOR: Won a wild card (week 19) game
  for (const userId of wildCardWinners) {
    badgesToAssign.push({
      user_id: userId,
      league_id: leagueId,
      season_number: seasonNumber,
      badge_name: "wild_card_survivor",
      badge_label: "Wild Card Survivor",
      earned_at: nowIso()
    });
  }

  // CONFERENCE CHAMPION: Won the conference championship (week 21)
  for (const userId of confChampWinners) {
    badgesToAssign.push({
      user_id: userId,
      league_id: leagueId,
      season_number: seasonNumber,
      badge_name: "conference_champion",
      badge_label: "Conference Champion",
      earned_at: nowIso()
    });
  }

  // PLAYOFF WARRIOR: 3+ playoff wins
  for (const [userId, wins] of playoffWinsByUser) {
    if (wins >= 3) {
      badgesToAssign.push({
        user_id: userId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "playoff_warrior",
        badge_label: "Playoff Warrior",
        earned_value: wins,
        earned_at: nowIso()
      });
    }
  }

  // PERFECT RUN: Won all playoff games without a loss (Super Bowl winner only)
  if (seasonResults?.sb_winner) {
    const sbWinnerId = seasonResults.sb_winner as string;
    if ((playoffLossesByUser.get(sbWinnerId) ?? 0) === 0 && (playoffWinsByUser.get(sbWinnerId) ?? 0) >= 2) {
      badgesToAssign.push({
        user_id: sbWinnerId,
        league_id: leagueId,
        season_number: seasonNumber,
        badge_name: "perfect_run",
        badge_label: "Perfect Run",
        earned_at: nowIso()
      });
    }
  }

  // Convert Record Breaker → Record Holder
  const { data: recordBreakers } = await supabase
    .from("rec_user_badges")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .like("badge_name", "record_breaker_%");

  for (const breaker of recordBreakers ?? []) {
    // Add Record Holder badge
    badgesToAssign.push({
      user_id: breaker.user_id,
      league_id: leagueId,
      season_number: seasonNumber,
      badge_name: breaker.badge_name.replace("record_breaker_", "record_holder_"),
      badge_label: breaker.badge_label?.replace("Record Breaker", "Record Holder") ?? "Record Holder",
      earned_value: breaker.earned_value,
      earned_at: nowIso()
    });

    // Remove Record Breaker badge (it was temporary for this season)
    badgesToRemove.push({
      user_id: breaker.user_id,
      league_id: leagueId,
      season_number: seasonNumber,
      badge_name: breaker.badge_name
    });
  }

  // Remove Comeback Artist badges (reset at season end)
  const { data: comebackArtists } = await supabase
    .from("rec_user_badges")
    .select("user_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("badge_name", "comeback_artist");

  for (const user of comebackArtists ?? []) {
    badgesToRemove.push({
      user_id: user.user_id,
      league_id: leagueId,
      season_number: seasonNumber,
      badge_name: "comeback_artist"
    });
  }

  // Pre-check which badges are truly new before upsert
  let newBadges: typeof badgesToAssign = [];
  if (badgesToAssign.length > 0) {
    const { data: existingBadges } = await supabase
      .from("rec_user_badges")
      .select("user_id,badge_name")
      .eq("league_id", leagueId)
      .eq("season_number", seasonNumber)
      .in("badge_name", [...new Set(badgesToAssign.map((b) => b.badge_name))]);
    const existingSet = new Set((existingBadges ?? []).map((b: any) => `${b.user_id}:${b.badge_name}`));
    newBadges = badgesToAssign.filter((b) => !existingSet.has(`${b.user_id}:${b.badge_name}`));
    try {
      await supabase.from("rec_user_badges").upsert(badgesToAssign, { onConflict: "user_id,league_id,badge_name,season_number" });
    } catch {
      // Non-fatal
    }
    await issueBadgeBonuses(newBadges, leagueId, seasonNumber);
  }

  if (badgesToRemove.length > 0) {
    try {
      for (const badge of badgesToRemove) {
        await supabase
          .from("rec_user_badges")
          .delete()
          .eq("user_id", badge.user_id)
          .eq("league_id", badge.league_id)
          .eq("season_number", badge.season_number)
          .eq("badge_name", badge.badge_name);
      }
    } catch {
      // Badge removal is non-fatal
    }
  }

  return { assigned: badgesToAssign.length, earned: newBadges, removed: badgesToRemove };
}

// GOTW Sophisticated Scoring System
// Used for: GOTW selection, strength of schedule, power rankings
async function calculateUserPowerRanking(userId: string, leagueId: string, seasonNumber: number) {
  const { data: record } = await supabase
    .from("rec_league_user_records")
    .select("wins,losses,ties,point_differential,games_played")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!record || record.games_played === 0) return { ranking: 0.5, wins: 0, losses: 0, pd: 0 };

  const winPct = record.wins / record.games_played;
  const avgPd = record.point_differential / record.games_played;

  // Simple power ranking: (win% * 0.7 + normalized PD * 0.3)
  // Normalized PD: +5 per point (so 10 PD per game = +0.5 boost)
  const pdBoost = Math.max(-0.3, Math.min(0.3, avgPd / 30));
  const ranking = (winPct * 0.7) + (0.5 + pdBoost * 0.3);

  return {
    ranking: Math.max(0, Math.min(1, ranking)),
    wins: record.wins,
    losses: record.losses,
    pd: record.point_differential,
    winPct,
    avgPd
  };
}

async function calculateH2hHistory(userId1: string, userId2: string) {
  const ids = [userId1, userId2].sort();
  const { data } = await supabase
    .from("rec_user_h2h_global_records")
    .select("wins,losses,ties,pointDifferential")
    .eq("user_a_id", ids[0])
    .eq("user_b_id", ids[1])
    .maybeSingle();

  if (!data) return { history: null, recency: null };

  const totalGames = (data.wins ?? 0) + (data.losses ?? 0) + (data.ties ?? 0);
  return {
    history: { wins: data.wins ?? 0, losses: data.losses ?? 0, ties: data.ties ?? 0, pd: data.pointDifferential ?? 0 },
    competitiveness: totalGames > 0 ? Math.abs(data.pointDifferential ?? 0) / totalGames : 0
  };
}

async function calculateMatchupStrength(game: any, leagueId: string, seasonNumber: number, weekNumber: number) {
  const homeRanking = await calculateUserPowerRanking(game.home_user_id, leagueId, seasonNumber);
  const awayRanking = await calculateUserPowerRanking(game.away_user_id, leagueId, seasonNumber);
  const h2hHistory = await calculateH2hHistory(game.home_user_id, game.away_user_id);

  // Matchup competitiveness: how close the teams are in power ranking
  const rankingDiff = Math.abs(homeRanking.ranking - awayRanking.ranking);
  const competitiveness = 1 - Math.min(1, rankingDiff * 2); // Closer rankings = more competitive

  // Calculate strength of schedule (quality of wins)
  const sosBoost = ((homeRanking.wins + awayRanking.wins) / Math.max(1, weekNumber + 1)) * 0.1;

  // Recent history (H2H competitiveness boost if they've played close games)
  const h2hBoost = h2hHistory.history ? (1 - h2hHistory.competitiveness / 50) * 0.15 : 0;

  // Division game bonus (if applicable)
  const divisionBonus = game.home_team?.division === game.away_team?.division ? 0.2 : 0;

  // Calculate overall strength rating (0-100 scale)
  const baseScore = 50;
  const powerScore = (homeRanking.ranking + awayRanking.ranking) / 2 * 30;
  const competitiveScore = competitiveness * 20;
  const totalScore = baseScore + powerScore + competitiveScore + (sosBoost * 10) + (h2hBoost * 5) + (divisionBonus * 10);

  return {
    strengthRating: Math.min(100, Math.max(0, totalScore)),
    homeRanking,
    awayRanking,
    competitiveness,
    h2hHistory,
    details: {
      powerScore,
      competitiveScore,
      sosBoost,
      h2hBoost,
      divisionBonus
    }
  };
}

async function creditUserWallet(input: {
  userId: string;
  leagueId: string;
  seasonNumber: number;
  amount: number;
  transactionType: string;
  description: string;
  sourceReference: Record<string, unknown>;
}) {
  if (!input.amount) return { ledger: null, wallet: await getWalletBalance(input.userId), created: false };

  const idempotencyKey = String(input.sourceReference.idempotencyKey ?? "");
  if (idempotencyKey) {
    const existing = await supabase
      .from("rec_dollar_ledger")
      .select("*")
      .eq("user_id", input.userId)
      .eq("transaction_type", input.transactionType)
      .contains("source_reference", { idempotencyKey })
      .maybeSingle();
    if (existing.data) return { ledger: existing.data, wallet: await getWalletBalance(input.userId), created: false };
  }

  const { data: currentWallet, error: walletReadError } = await supabase
    .from("rec_wallets")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (walletReadError) throw walletReadError;

  if (currentWallet) {
    // rec_wallets is keyed by user_id — it has no id column.
    const { error: walletError } = await supabase
      .from("rec_wallets")
      .update({ wallet_balance: asNumber(currentWallet.wallet_balance) + input.amount, updated_at: nowIso() })
      .eq("user_id", input.userId);
    if (walletError) throw walletError;
  } else {
    const { error: walletError } = await supabase
      .from("rec_wallets")
      .insert({ user_id: input.userId, wallet_balance: input.amount, savings_balance: 0 });
    if (walletError) throw walletError;
  }

  const { data: ledger, error: ledgerError } = await supabase.from("rec_dollar_ledger").insert({
    user_id: input.userId,
    league_id: input.leagueId,
    season_id: null,
    amount: input.amount,
    transaction_type: input.transactionType,
    description: input.description,
    source: "internal_import",
    source_reference: input.sourceReference
  }).select("*").single();
  if (ledgerError) throw ledgerError;

  return { ledger, wallet: await getWalletBalance(input.userId), created: true };
}

function statValue(stats: any, keys: string[]) {
  return pickStat(stats ?? {}, keys);
}

function wonGame(game: any, teamId: string) {
  if (String(game.home_team_id) === String(teamId)) return asNumber(game.home_score) > asNumber(game.away_score);
  if (String(game.away_team_id) === String(teamId)) return asNumber(game.away_score) > asNumber(game.home_score);
  return false;
}

function userTeamSide(game: any, userId: string) {
  if (game.home_user_id === userId) return { teamId: game.home_team_id, opponentTeamId: game.away_team_id, score: asNumber(game.home_score), oppScore: asNumber(game.away_score), location: "Home" };
  if (game.away_user_id === userId) return { teamId: game.away_team_id, opponentTeamId: game.home_team_id, score: asNumber(game.away_score), oppScore: asNumber(game.home_score), location: "Away" };
  return null;
}

async function getCompletedResultForChallenge(challenge: any) {
  if (challenge.game_id) {
    const byTeams = await supabase
      .from("rec_game_results")
      .select("*")
      .eq("league_id", challenge.league_id)
      .eq("season_number", challenge.season_number)
      .eq("week_number", challenge.week_number)
      .or(`home_team_id.eq.${challenge.team_id},away_team_id.eq.${challenge.team_id}`)
      .limit(1)
      .maybeSingle();
    if (byTeams.data) return byTeams.data as any;
  }
  const result = await supabase
    .from("rec_game_results")
    .select("*")
    .eq("league_id", challenge.league_id)
    .eq("season_number", challenge.season_number)
    .eq("week_number", challenge.week_number)
    .or(`home_team_id.eq.${challenge.team_id},away_team_id.eq.${challenge.team_id}`)
    .limit(1)
    .maybeSingle();
  return result.data as any;
}

export async function viewLeagueWeek(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { league: context.rec_leagues, server: context.rec_discord_servers };
}

async function getLeagueFeatureSettings(leagueId: string) {
  const { data, error } = await supabase.from("rec_league_feature_settings").select("*").eq("league_id", leagueId).maybeSingle();
  if (error) throw error;
  return data as any;
}

export async function setNextAdvance(input: { guildId: string; nextAdvanceAt: string; timezone?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const when = new Date(input.nextAdvanceAt);
  if (Number.isNaN(when.getTime())) throw new Error("Invalid next advance time.");
  const { data, error } = await supabase
    .from("rec_leagues")
    .update({ next_advance_at: when.toISOString(), next_advance_timezone: input.timezone ?? null, updated_at: new Date().toISOString() })
    .eq("id", context.league_id)
    .select("*")
    .single();
  if (error) throw error;
  return { league: data, nextAdvanceTimes: formatAdvanceTimes(data.next_advance_at) };
}

export async function setLeagueWeek(input: { guildId: string; seasonNumber?: number; weekNumber: number; seasonStage: string }) {
  const context = await getLeagueContext(input.guildId);
  const currentLeague = context.rec_leagues;
  const seasonNumber = input.seasonNumber ?? currentLeague.season_number ?? currentLeague.display_season_number ?? 1;

  const patch: Record<string, unknown> = {
    current_week: input.weekNumber,
    season_stage: input.seasonStage,
    current_phase: (
      input.seasonStage === "regular_season" ? "regular_season"
      : input.seasonStage === "preseason_training_camp" ? "preseason"
      : input.seasonStage === "coach_hiring" ? "coach_hiring_period"
      : input.seasonStage === "final_resigning" ? "offseason"
      : input.seasonStage === "free_agency" ? "free_agency_stage_1"
      : input.seasonStage === "draft" ? "draft"
      : ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(input.seasonStage) ? "playoffs"
      : "offseason"
    ),
    updated_at: new Date().toISOString()
  };
  if (input.seasonNumber) patch.season_number = input.seasonNumber;
  const { data, error } = await supabase.from("rec_leagues").update(patch).eq("id", context.league_id).select("*").single();
  if (error) throw error;

  const previousStage = currentLeague.season_stage;
  let transitionBadgesEarned: Array<{ user_id: string; badge_name: string; badge_label: string }> = [];
  let transitionBadgesRemoved: Array<{ user_id: string; badge_name: string; badge_label: string }> = [];

  if (previousStage === "regular_season" && input.seasonStage !== "regular_season") {
    try {
      const result = await assignSeasonEndBadges(context.league_id, seasonNumber);
      transitionBadgesEarned = result.earned ?? [];
    } catch {
      // Non-fatal
    }
  }

  if (previousStage === "super_bowl" && input.seasonStage === "coach_hiring") {
    try {
      const result = await assignPlayoffBadges(context.league_id, seasonNumber);
      transitionBadgesEarned = [...transitionBadgesEarned, ...(result.earned ?? [])];
      transitionBadgesRemoved = result.removed ?? [];
    } catch {
      // Non-fatal
    }
  }

  const features = await getLeagueFeatureSettings(context.league_id);
  const economyEnabled = Boolean(features?.coin_economy_enabled);
  const warning = economyEnabled
    ? "Economy is active. Setting the week manually does not trigger payouts for previous weeks. To catch up prior weeks, import and advance each week using catch-up mode."
    : null;
  return { league: data, warning, economyEnabled, transitionBadgesEarned, transitionBadgesRemoved };
}

export async function viewEconomyConfig(guildId: string) {
  const context = await getLeagueContext(guildId);
  return { routes: await getRoutes(context.server_id), league: context.rec_leagues };
}

export async function setEconomyConfig(input: { guildId: string; pendingEconomyChannelId?: string; pendingPayoutsChannelId?: string; gameChannelsCategoryId?: string; commissionerOfficeChannelId?: string; streamsChannelId?: string; highlightsChannelId?: string; announcementsChannelId?: string; commissionerRoleId?: string; compCommitteeRoleId?: string }) {
  const context = await getLeagueContext(input.guildId);
  const patch: Record<string, unknown> = { server_id: context.server_id, updated_at: new Date().toISOString() };
  if (input.pendingEconomyChannelId !== undefined) patch.pending_economy_channel_id = input.pendingEconomyChannelId;
  if (input.pendingPayoutsChannelId !== undefined) patch.pending_payouts_channel_id = input.pendingPayoutsChannelId;
  if (input.gameChannelsCategoryId !== undefined) patch.game_channels_category_id = input.gameChannelsCategoryId;
  if (input.commissionerOfficeChannelId !== undefined) patch.commissioner_office_channel_id = input.commissionerOfficeChannelId;
  if (input.streamsChannelId !== undefined) patch.streams_channel_id = input.streamsChannelId;
  if (input.highlightsChannelId !== undefined) patch.highlights_channel_id = input.highlightsChannelId;
  if (input.announcementsChannelId !== undefined) patch.announcements_channel_id = input.announcementsChannelId;
  if (input.commissionerRoleId !== undefined) patch.commissioner_role_id = input.commissionerRoleId;
  if (input.compCommitteeRoleId !== undefined) patch.comp_committee_role_id = input.compCommitteeRoleId;
  const existing = await getRoutes(context.server_id);
  const query = existing
    ? supabase.from("rec_server_routes").update(patch).eq("server_id", context.server_id)
    : supabase.from("rec_server_routes").insert(patch);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return { routes: data };
}

export async function clearPendingEosBatch(input: { guildId: string; clearReason: string }) {
  const context = await getLeagueContext(input.guildId);
  const { data: batch, error } = await supabase
    .from("rec_eos_payout_batches")
    .select("*")
    .eq("league_id", context.league_id)
    .in("status", ["draft", "posted", "partially_approved", "approved", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!batch) return { cleared: false, reason: "No pending EOS batch found." };
  await supabase.from("rec_eos_payout_items").update({ status: "voided", updated_at: new Date().toISOString() }).eq("batch_id", batch.id).eq("status", "pending");
  const { data: updated, error: updateError } = await supabase
    .from("rec_eos_payout_batches")
    .update({ status: "cleared", clear_reason: input.clearReason, cleared_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", batch.id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return { cleared: true, batch: updated };
}

async function getWeekGames(leagueId: string, seasonNumber: number, weekNumber: number) {
  const { data, error } = await supabase
    .from("rec_games")
    .select("*, home_team:rec_teams!rec_games_home_team_id_fkey(*), away_team:rec_teams!rec_games_away_team_id_fkey(*)")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  if (error) throw error;
  return (data ?? []) as any[];
}

interface ChallengeTemplate {
  key: string;
  side: "offense" | "defense";
  eval_type: string;
  stat_columns: string[];
  s_threshold: number;
  a_threshold: number;
  s_threshold2?: number; // secondary threshold (e.g. rush component of balanced_attack)
  a_threshold2?: number;
  s_tier_goal: string;
  a_tier_goal: string;
  b_tier_goal: string;
}

const OFFENSIVE_CHALLENGE_POOL: ChallengeTemplate[] = [
  // Yardage challenges
  { key: "pass_yards_350", side: "offense", eval_type: "team_stat_min", stat_columns: ["passYds"], s_threshold: 350, a_threshold: 250, s_tier_goal: "Throw for 350+ passing yards and win", a_tier_goal: "Throw for 250+ passing yards and win", b_tier_goal: "Win the game" },
  { key: "pass_yards_400", side: "offense", eval_type: "team_stat_min", stat_columns: ["passYds"], s_threshold: 400, a_threshold: 300, s_tier_goal: "Throw for 400+ passing yards and win", a_tier_goal: "Throw for 300+ passing yards and win", b_tier_goal: "Win the game" },
  { key: "rush_yards_150", side: "offense", eval_type: "team_stat_min", stat_columns: ["rushYds"], s_threshold: 150, a_threshold: 100, s_tier_goal: "Rush for 150+ yards and win", a_tier_goal: "Rush for 100+ yards and win", b_tier_goal: "Win the game" },
  { key: "rush_yards_200", side: "offense", eval_type: "team_stat_min", stat_columns: ["rushYds"], s_threshold: 200, a_threshold: 130, s_tier_goal: "Rush for 200+ yards and win", a_tier_goal: "Rush for 130+ yards and win", b_tier_goal: "Win the game" },
  { key: "total_yards_450", side: "offense", eval_type: "total_yards", stat_columns: ["passYds", "rushYds"], s_threshold: 450, a_threshold: 350, s_tier_goal: "Gain 450+ total yards and win", a_tier_goal: "Gain 350+ total yards and win", b_tier_goal: "Win the game" },
  { key: "total_yards_500", side: "offense", eval_type: "total_yards", stat_columns: ["passYds", "rushYds"], s_threshold: 500, a_threshold: 400, s_tier_goal: "Gain 500+ total yards and win", a_tier_goal: "Gain 400+ total yards and win", b_tier_goal: "Win the game" },
  // TD challenges
  { key: "pass_tds_3", side: "offense", eval_type: "team_stat_min", stat_columns: ["passTDs"], s_threshold: 3, a_threshold: 2, s_tier_goal: "Throw 3+ passing TDs and win", a_tier_goal: "Throw 2+ passing TDs and win", b_tier_goal: "Win the game" },
  { key: "pass_tds_4", side: "offense", eval_type: "team_stat_min", stat_columns: ["passTDs"], s_threshold: 4, a_threshold: 3, s_tier_goal: "Throw 4+ passing TDs and win", a_tier_goal: "Throw 3+ passing TDs and win", b_tier_goal: "Win the game" },
  // Win margin challenges
  { key: "blowout_win_21", side: "offense", eval_type: "score_margin", stat_columns: [], s_threshold: 21, a_threshold: 14, s_tier_goal: "Win by 21+ points", a_tier_goal: "Win by 14+ points", b_tier_goal: "Win the game" },
  { key: "blowout_win_28", side: "offense", eval_type: "score_margin", stat_columns: [], s_threshold: 28, a_threshold: 21, s_tier_goal: "Win by 28+ points", a_tier_goal: "Win by 21+ points", b_tier_goal: "Win the game" },
  // Protection challenge
  { key: "no_int_win", side: "offense", eval_type: "team_stat_max", stat_columns: ["passInts"], s_threshold: 0, a_threshold: 1, s_tier_goal: "Win with 0 passing interceptions", a_tier_goal: "Win with 1 or fewer interceptions", b_tier_goal: "Win the game" },
  // Efficiency challenges
  { key: "efficient_passer_75", side: "offense", eval_type: "completion_pct", stat_columns: ["passComp", "passAtt"], s_threshold: 0.75, a_threshold: 0.65, s_tier_goal: "Complete 75%+ of pass attempts and win", a_tier_goal: "Complete 65%+ of pass attempts and win", b_tier_goal: "Win the game" },
  { key: "balanced_attack", side: "offense", eval_type: "balanced_attack", stat_columns: ["passYds", "rushYds"], s_threshold: 250, a_threshold: 200, s_threshold2: 150, a_threshold2: 100, s_tier_goal: "Throw for 250+ yards AND rush for 150+ yards and win", a_tier_goal: "Throw for 200+ yards AND rush for 100+ yards and win", b_tier_goal: "Win the game" },
  { key: "first_downs_25", side: "offense", eval_type: "team_stat_min", stat_columns: ["firstDowns"], s_threshold: 25, a_threshold: 15, s_tier_goal: "Pick up 25+ first downs and win", a_tier_goal: "Pick up 15+ first downs and win", b_tier_goal: "Win the game" },
  { key: "high_scoring_35", side: "offense", eval_type: "user_score_min", stat_columns: [], s_threshold: 35, a_threshold: 28, s_tier_goal: "Score 35+ points and win", a_tier_goal: "Score 28+ points and win", b_tier_goal: "Win the game" }
];

const DEFENSIVE_CHALLENGE_POOL: ChallengeTemplate[] = [
  // Pass coverage challenges
  { key: "hold_qb_225", side: "defense", eval_type: "opp_stat_max", stat_columns: ["passYds"], s_threshold: 225, a_threshold: 275, s_tier_goal: "Hold opponent under 225 passing yards and win", a_tier_goal: "Hold opponent under 275 passing yards and win", b_tier_goal: "Win the game" },
  { key: "hold_qb_200", side: "defense", eval_type: "opp_stat_max", stat_columns: ["passYds"], s_threshold: 200, a_threshold: 250, s_tier_goal: "Hold opponent under 200 passing yards and win", a_tier_goal: "Hold opponent under 250 passing yards and win", b_tier_goal: "Win the game" },
  // Run defense challenges
  { key: "hold_rush_75", side: "defense", eval_type: "opp_stat_max", stat_columns: ["rushYds"], s_threshold: 75, a_threshold: 125, s_tier_goal: "Hold opponent rushing attack under 75 yards and win", a_tier_goal: "Hold opponent rushing attack under 125 yards and win", b_tier_goal: "Win the game" },
  { key: "hold_rush_100", side: "defense", eval_type: "opp_stat_max", stat_columns: ["rushYds"], s_threshold: 100, a_threshold: 150, s_tier_goal: "Hold opponent rushing attack under 100 yards and win", a_tier_goal: "Hold opponent rushing attack under 150 yards and win", b_tier_goal: "Win the game" },
  // Score suppression
  { key: "opp_score_10", side: "defense", eval_type: "opp_score_max", stat_columns: [], s_threshold: 10, a_threshold: 20, s_tier_goal: "Hold opponent to 10 points or fewer and win", a_tier_goal: "Hold opponent to 20 points or fewer and win", b_tier_goal: "Win the game" },
  { key: "opp_score_14", side: "defense", eval_type: "opp_score_max", stat_columns: [], s_threshold: 14, a_threshold: 24, s_tier_goal: "Hold opponent to 14 points or fewer and win", a_tier_goal: "Hold opponent to 24 points or fewer and win", b_tier_goal: "Win the game" },
  { key: "shutout", side: "defense", eval_type: "opp_score_max", stat_columns: [], s_threshold: 0, a_threshold: 7, s_tier_goal: "Shut out the opponent and win", a_tier_goal: "Hold opponent to 7 or fewer points and win", b_tier_goal: "Win the game" },
  // Pass rush / sack challenges
  { key: "force_sacks_2", side: "defense", eval_type: "own_def_stat", stat_columns: ["defSacks"], s_threshold: 2, a_threshold: 1, s_tier_goal: "Record 2+ sacks and win", a_tier_goal: "Record 1+ sack and win", b_tier_goal: "Win the game" },
  { key: "force_sacks_3", side: "defense", eval_type: "own_def_stat", stat_columns: ["defSacks"], s_threshold: 3, a_threshold: 2, s_tier_goal: "Record 3+ sacks and win", a_tier_goal: "Record 2+ sacks and win", b_tier_goal: "Win the game" },
  { key: "sack_party_5", side: "defense", eval_type: "own_def_stat", stat_columns: ["defSacks"], s_threshold: 5, a_threshold: 3, s_tier_goal: "Record 5+ sacks and win", a_tier_goal: "Record 3+ sacks and win", b_tier_goal: "Win the game" },
  // Turnover challenges
  { key: "force_turnovers_2", side: "defense", eval_type: "turnovers", stat_columns: ["defInts", "defForcedFum"], s_threshold: 2, a_threshold: 1, s_tier_goal: "Force 2+ turnovers and win", a_tier_goal: "Force 1+ turnover and win", b_tier_goal: "Win the game" },
  { key: "force_turnovers_3", side: "defense", eval_type: "turnovers", stat_columns: ["defInts", "defForcedFum"], s_threshold: 3, a_threshold: 2, s_tier_goal: "Force 3+ turnovers and win", a_tier_goal: "Force 2+ turnovers and win", b_tier_goal: "Win the game" },
  { key: "ball_hawk_3", side: "defense", eval_type: "own_def_stat", stat_columns: ["defInts"], s_threshold: 3, a_threshold: 2, s_tier_goal: "Intercept 3+ passes and win", a_tier_goal: "Intercept 2+ passes and win", b_tier_goal: "Win the game" },
  // Situational / advanced challenges
  { key: "lockdown_secondary", side: "defense", eval_type: "opp_completion_pct", stat_columns: ["passComp", "passAtt"], s_threshold: 0.50, a_threshold: 0.60, s_tier_goal: "Hold opponent QB completion rate under 50% and win", a_tier_goal: "Hold opponent QB completion rate under 60% and win", b_tier_goal: "Win the game" },
  { key: "redzone_lockdown", side: "defense", eval_type: "opp_stat_max", stat_columns: ["redZoneTDs"], s_threshold: 0, a_threshold: 1, s_tier_goal: "Allow 0 red zone TDs and win", a_tier_goal: "Allow 1 or fewer red zone TDs and win", b_tier_goal: "Win the game" },
  { key: "bend_not_break", side: "defense", eval_type: "bend_not_break", stat_columns: [], s_threshold: 17, a_threshold: 24, s_tier_goal: "Allow 350+ yards but hold opponent under 17 points and win", a_tier_goal: "Allow 350+ yards but hold opponent under 24 points and win", b_tier_goal: "Win the game" }
];

const CHALLENGE_TEMPLATE_MAP = new Map<string, ChallengeTemplate>([
  ...(OFFENSIVE_CHALLENGE_POOL.map((t) => [t.key, t] as [string, ChallengeTemplate])),
  ...(DEFENSIVE_CHALLENGE_POOL.map((t) => [t.key, t] as [string, ChallengeTemplate])),
  // Legacy fallback keys
  ["fallback_pass_yards", OFFENSIVE_CHALLENGE_POOL[0]],
  ["fallback_hold_qb", DEFENSIVE_CHALLENGE_POOL[0]]
]);

function pickFromPool(pool: ChallengeTemplate[], excludedKeys?: Set<string> | null): ChallengeTemplate {
  const filtered = excludedKeys?.size ? pool.filter((t) => !excludedKeys.has(t.key)) : pool;
  const source = filtered.length > 0 ? filtered : pool;
  return source[Math.floor(Math.random() * source.length)];
}

// Sums a single JSONB field across all player rows for a team in a given week.
// The stats column uses Madden-style keys (e.g. "passYds", "rushYds", "defSacks").
async function sumTeamStatFromCommitted(leagueId: string, seasonNumber: number, weekNumber: number, teamId: string, jsonbKeys: string[]): Promise<{ total: number; hasData: boolean }> {
  const { data, error } = await supabase
    .from("rec_player_weekly_stats")
    .select("stats")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("team_id", teamId);
  if (error || !data?.length) return { total: 0, hasData: false };
  const total = (data as any[]).reduce((sum, row) => {
    const s = (row.stats ?? {}) as Record<string, unknown>;
    return sum + jsonbKeys.reduce((ks, key) => ks + asNumber(s[key]), 0);
  }, 0);
  return { total, hasData: true };
}

// Calculates completion percentage for a team by summing passComp/passAtt from passing stats.
async function getTeamCompletionPct(leagueId: string, seasonNumber: number, weekNumber: number, teamId: string): Promise<{ pct: number; hasData: boolean }> {
  const { data } = await supabase
    .from("rec_player_weekly_stats")
    .select("stats")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .eq("team_id", teamId)
    .eq("stat_category", "passing");
  if (!data?.length) return { pct: 0, hasData: false };
  let totalComp = 0, totalAtt = 0;
  for (const row of data as any[]) {
    const s = (row.stats ?? {}) as Record<string, unknown>;
    totalComp += pickStat(s, ["passComp", "completions", "cmp"]);
    totalAtt += pickStat(s, ["passAtt", "attempts", "att"]);
  }
  if (totalAtt === 0) return { pct: 0, hasData: false };
  return { pct: totalComp / totalAtt, hasData: true };
}

interface TeamSeasonProfile {
  teamId: string;
  avgPassYdsPerGame: number;
  avgRushYdsPerGame: number;
  avgPointsPerGame: number;
  avgPointsAllowedPerGame: number;
  avgTurnoversPerGame: number;
  avgDefSacksPerGame: number;
  topPasserName: string | null;
  topRusherName: string | null;
  weeksPlayed: number;
}

async function buildTeamSeasonProfile(leagueId: string, seasonNumber: number, throughWeek: number, teamId: string): Promise<TeamSeasonProfile> {
  const [{ data: passingRows }, { data: rushingRows }, { data: defenseRows }, gameResults] = await Promise.all([
    supabase.from("rec_player_weekly_stats").select("stats,player_name,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", teamId).eq("stat_category", "passing").lt("week_number", throughWeek).order("week_number", { ascending: false }),
    supabase.from("rec_player_weekly_stats").select("stats,player_name,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", teamId).eq("stat_category", "rushing").lt("week_number", throughWeek).order("week_number", { ascending: false }),
    supabase.from("rec_player_weekly_stats").select("stats,week_number").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("team_id", teamId).eq("stat_category", "defense").lt("week_number", throughWeek),
    supabase.from("rec_game_results").select("home_team_id,away_team_id,home_score,away_score").eq("league_id", leagueId).eq("season_number", seasonNumber).lt("week_number", throughWeek).or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
  ]);
  const latestPassWeek = (passingRows ?? [])[0]?.week_number ?? 0;
  const latestRushWeek = (rushingRows ?? [])[0]?.week_number ?? 0;
  const latestPassRows = (passingRows ?? []).filter((r: any) => r.week_number === latestPassWeek);
  const latestRushRows = (rushingRows ?? []).filter((r: any) => r.week_number === latestRushWeek);

  let topPasserName: string | null = null;
  let topPassYds = 0;
  let avgPassYdsPerGame = 0;
  for (const row of latestPassRows) {
    const s = (row.stats ?? {}) as Record<string, any>;
    const yds = asNumber(s.passYds);
    if (yds > topPassYds) { topPassYds = yds; topPasserName = (s.fullName as string) ?? row.player_name ?? null; }
    const ypg = asNumber(s.passYdsPerGame);
    if (ypg > avgPassYdsPerGame) avgPassYdsPerGame = ypg;
  }
  let topRusherName: string | null = null;
  let topRushYds = 0;
  let avgRushYdsPerGame = 0;
  for (const row of latestRushRows) {
    const s = (row.stats ?? {}) as Record<string, any>;
    const yds = asNumber(s.rushYds);
    if (yds > topRushYds) { topRushYds = yds; topRusherName = (s.fullName as string) ?? row.player_name ?? null; }
    const ypg = asNumber(s.rushYdsPerGame);
    if (ypg > avgRushYdsPerGame) avgRushYdsPerGame = ypg;
  }

  // Calculate scoring and defensive averages from game results
  let totalPoints = 0, totalAllowed = 0, gamesPlayed = 0;
  for (const g of gameResults.data ?? []) {
    const isHome = g.home_team_id === teamId;
    totalPoints += isHome ? asNumber(g.home_score) : asNumber(g.away_score);
    totalAllowed += isHome ? asNumber(g.away_score) : asNumber(g.home_score);
    gamesPlayed++;
  }
  const avgPointsPerGame = gamesPlayed > 0 ? totalPoints / gamesPlayed : 0;
  const avgPointsAllowedPerGame = gamesPlayed > 0 ? totalAllowed / gamesPlayed : 0;

  // Defensive stats averages
  let totalSacks = 0, totalInts = 0, totalFumbles = 0;
  const defWeeks = new Set<number>();
  for (const row of defenseRows ?? []) {
    const s = (row.stats ?? {}) as Record<string, any>;
    totalSacks += asNumber(s.defSacks ?? s.sacks);
    totalInts += asNumber(s.defInts ?? s.interceptions);
    totalFumbles += asNumber(s.defForcedFum ?? s.forcedFumbles);
    defWeeks.add(row.week_number);
  }
  const defGames = defWeeks.size || 1;
  const avgDefSacksPerGame = totalSacks / defGames;
  const avgTurnoversPerGame = (totalInts + totalFumbles) / defGames;

  return { teamId, avgPassYdsPerGame, avgRushYdsPerGame, avgPointsPerGame, avgPointsAllowedPerGame, avgTurnoversPerGame, avgDefSacksPerGame, topPasserName, topRusherName, weeksPlayed: Math.max(latestPassWeek, latestRushWeek) };
}

function pickStylePool(pool: ChallengeTemplate[], keys: string[], excludedKeys?: Set<string> | null): ChallengeTemplate | null {
  const stylePool = pool.filter((t) => keys.some((k) => t.key.startsWith(k)));
  const available = excludedKeys?.size ? stylePool.filter((t) => !excludedKeys.has(t.key)) : stylePool;
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function selectDefensiveChallenge(opp: TeamSeasonProfile, excludedKeys?: Set<string> | null): { template: ChallengeTemplate; targetPlayerName: string | null } {
  if (opp.weeksPlayed > 0) {
    // Pass-heavy opponent → coverage / QB pressure challenges
    if (opp.avgPassYdsPerGame > 250) {
      const keys = ["hold_qb_", "lockdown_secondary", "force_sacks_", "sack_party_"];
      const t = pickStylePool(DEFENSIVE_CHALLENGE_POOL, keys, excludedKeys);
      if (t) return { template: t, targetPlayerName: opp.topPasserName };
    }
    // Run-heavy opponent → front seven / rush defense challenges
    if (opp.avgRushYdsPerGame > 130) {
      const keys = ["hold_rush_"];
      const t = pickStylePool(DEFENSIVE_CHALLENGE_POOL, keys, excludedKeys);
      if (t) return { template: t, targetPlayerName: opp.topRusherName };
    }
    // High-scoring opponent → score suppression / takeaway challenges
    if (opp.avgPointsPerGame > 28) {
      const keys = ["opp_score_", "shutout", "force_turnovers_", "ball_hawk_", "redzone_lockdown"];
      const t = pickStylePool(DEFENSIVE_CHALLENGE_POOL, keys, excludedKeys);
      if (t) return { template: t, targetPlayerName: null };
    }
    // Low-scoring opponent → bend-don't-break situational challenge
    if (opp.avgPointsPerGame < 18 && opp.weeksPlayed >= 3) {
      const t = pickStylePool(DEFENSIVE_CHALLENGE_POOL, ["bend_not_break"], excludedKeys);
      if (t) return { template: t, targetPlayerName: null };
    }
  }
  return { template: pickFromPool(DEFENSIVE_CHALLENGE_POOL, excludedKeys), targetPlayerName: null };
}

function selectOffensiveChallenge(user: TeamSeasonProfile, excludedKeys?: Set<string> | null): { template: ChallengeTemplate; targetPlayerName: string | null } {
  if (user.weeksPlayed > 0 && (user.avgPassYdsPerGame > 0 || user.avgRushYdsPerGame > 0)) {
    const passHeavy = user.avgRushYdsPerGame > 0 && user.avgPassYdsPerGame > user.avgRushYdsPerGame * 2;
    const runHeavy = user.avgPassYdsPerGame > 0 && user.avgRushYdsPerGame > user.avgPassYdsPerGame * 1.5;
    const balanced = !passHeavy && !runHeavy && user.avgPassYdsPerGame > 150 && user.avgRushYdsPerGame > 80;

    if (passHeavy) {
      const keys = ["pass_yards_", "pass_tds_", "efficient_passer_", "high_scoring_"];
      const t = pickStylePool(OFFENSIVE_CHALLENGE_POOL, keys, excludedKeys);
      if (t) return { template: t, targetPlayerName: user.topPasserName };
    }
    if (runHeavy) {
      const keys = ["rush_yards_", "total_yards_", "high_scoring_"];
      const t = pickStylePool(OFFENSIVE_CHALLENGE_POOL, keys, excludedKeys);
      if (t) return { template: t, targetPlayerName: user.topRusherName };
    }
    if (balanced) {
      const keys = ["balanced_attack", "total_yards_", "first_downs_"];
      const t = pickStylePool(OFFENSIVE_CHALLENGE_POOL, keys, excludedKeys);
      if (t) return { template: t, targetPlayerName: null };
    }
    // High-scoring offense → push for bigger wins
    if (user.avgPointsPerGame > 28) {
      const keys = ["blowout_win_", "high_scoring_", "pass_tds_"];
      const t = pickStylePool(OFFENSIVE_CHALLENGE_POOL, keys, excludedKeys);
      if (t) return { template: t, targetPlayerName: null };
    }
  }
  return { template: pickFromPool(OFFENSIVE_CHALLENGE_POOL, excludedKeys), targetPlayerName: null };
}

export async function generateWeeklyChallenges(input: { guildId: string; regenerate?: boolean }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  if (input.regenerate) {
    await supabase.from("rec_weekly_challenges").update({ status: "voided", updated_at: new Date().toISOString() }).eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  }
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);

  // Fetch the last 3 weeks of challenge keys per user to exclude from pool for variety
  const lookbackWeeks = 3;
  const firstLookback = Math.max(1, weekNumber - lookbackWeeks);
  const prevKeyMap = new Map<string, Set<string>>();
  if (firstLookback < weekNumber) {
    const { data: prevChallenges } = await supabase
      .from("rec_weekly_challenges")
      .select("user_id,challenge_side,challenge_key")
      .eq("league_id", context.league_id)
      .eq("season_number", seasonNumber)
      .gte("week_number", firstLookback)
      .lt("week_number", weekNumber);
    for (const c of prevChallenges ?? []) {
      const mapKey = `${c.user_id}|${c.challenge_side}`;
      if (!prevKeyMap.has(mapKey)) prevKeyMap.set(mapKey, new Set());
      prevKeyMap.get(mapKey)!.add(c.challenge_key);
    }
  }

  // Build season-to-date profiles for all teams so we can tailor challenges to matchups
  const allTeamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id].filter(Boolean) as string[]))];
  const emptyProfile = (teamId: string): TeamSeasonProfile => ({ teamId, avgPassYdsPerGame: 0, avgRushYdsPerGame: 0, avgPointsPerGame: 0, avgPointsAllowedPerGame: 0, avgTurnoversPerGame: 0, avgDefSacksPerGame: 0, topPasserName: null, topRusherName: null, weeksPlayed: 0 });
  const profileEntries = await Promise.all(allTeamIds.map(async (teamId) => [teamId, await buildTeamSeasonProfile(context.league_id, seasonNumber, weekNumber, teamId).catch(() => emptyProfile(teamId))] as const));
  const profileMap = new Map<string, TeamSeasonProfile>(profileEntries);

  const rows: any[] = [];
  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeamId: game.away_team_id, opponentUserId: game.away_user_id },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeamId: game.home_team_id, opponentUserId: game.home_user_id }
    ].filter((side) => side.userId && side.teamId);
    for (const side of sides) {
      const userProfile = profileMap.get(side.teamId) ?? emptyProfile(side.teamId);
      const oppProfile = side.opponentTeamId ? (profileMap.get(side.opponentTeamId) ?? emptyProfile(side.opponentTeamId)) : emptyProfile("");
      const { template: offTemplate, targetPlayerName: offPlayer } = selectOffensiveChallenge(userProfile, prevKeyMap.get(`${side.userId}|offense`));
      const { template: defTemplate, targetPlayerName: defPlayer } = selectDefensiveChallenge(oppProfile, prevKeyMap.get(`${side.userId}|defense`));
      const base = { league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, game_id: game.id, user_id: side.userId, team_id: side.teamId, opponent_team_id: side.opponentTeamId, opponent_user_id: side.opponentUserId, is_cpu_game: !side.opponentUserId, target_type: "team" };
      const isPlayerDefChallenge = defPlayer && (defTemplate.key.includes("hold_qb") || defTemplate.key.includes("hold_rush"));
      rows.push({ ...base, challenge_side: "offense", challenge_key: offTemplate.key, s_tier_goal: offTemplate.s_tier_goal, a_tier_goal: offTemplate.a_tier_goal, b_tier_goal: offTemplate.b_tier_goal, target_player_name: offPlayer ?? null });
      rows.push({ ...base, challenge_side: "defense", challenge_key: defTemplate.key, s_tier_goal: isPlayerDefChallenge ? `${defTemplate.s_tier_goal} (key threat: ${defPlayer})` : defTemplate.s_tier_goal, a_tier_goal: isPlayerDefChallenge ? `${defTemplate.a_tier_goal} (key threat: ${defPlayer})` : defTemplate.a_tier_goal, b_tier_goal: defTemplate.b_tier_goal, target_player_name: defPlayer ?? null });
    }
  }
  let generated = 0;
  if (rows.length) {
    // rec_weekly_challenges has no unique key for ON CONFLICT; dedup against this week's
    // active challenges instead (regenerate voids them first, so re-generation still inserts).
    const existing = await supabase
      .from("rec_weekly_challenges")
      .select("user_id,challenge_side")
      .eq("league_id", context.league_id)
      .eq("season_number", seasonNumber)
      .eq("week_number", weekNumber)
      .eq("status", "active");
    if (existing.error) throw existing.error;
    const existingKeys = new Set((existing.data ?? []).map((c: any) => `${c.user_id}|${c.challenge_side}`));
    const toInsert = rows.filter((row) => !existingKeys.has(`${row.user_id}|${row.challenge_side}`));
    if (toInsert.length) {
      const { error } = await supabase.from("rec_weekly_challenges").insert(toInsert);
      if (error) throw error;
    }
    generated = toInsert.length;
  }
  return { generated, weekNumber, seasonNumber };
}

export async function getChallengeAudit(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const weekNumber = league.current_week ?? 1;
  const { data, error } = await supabase
    .from("rec_weekly_challenges")
    .select("*, rec_users(display_name), rec_teams(name,abbreviation)")
    .eq("league_id", context.league_id)
    .gte("week_number", Math.max(1, weekNumber - 2))
    .order("week_number", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return { challenges: data ?? [] };
}

export async function getGameChannelPlans(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const advanceTimes = formatAdvanceTimes(league.next_advance_at);
  const h2hGames = games.filter((g) => g.home_user_id && g.away_user_id);

  // Resolve real Discord IDs so channel messages tag users (the raw user_id is an internal UUID).
  const discordByUser = await resolveDiscordIdsByUser(h2hGames.flatMap((g) => [g.home_user_id, g.away_user_id]));

  // Pull the league's configured game rules (fourth-down / streaming) from rec_league_configuration.
  const config = await getLeagueConfiguration(context.league_id);
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const isPlayoffStage = ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(stage);
  const streamingRequirement = stage === "regular_season"
    ? config?.regular_season_streaming_requirement ?? config?.streaming_requirement
    : config?.postseason_streaming_requirement ?? config?.streaming_requirement;
  const fourthDownRules = humanizeFourthDownRule(config?.fourth_down_rule_type, config?.custom_fourth_down_rule);

  // Determine which game is GOTW: in playoffs every H2H game is GOTW; in regular season look up selected candidate
  let gotwGameId: string | null = null;
  if (!isPlayoffStage) {
    const { data: gotwSelected } = await supabase
      .from("rec_game_of_week_candidates")
      .select("game_id")
      .eq("league_id", context.league_id)
      .eq("season_number", seasonNumber)
      .eq("week_number", weekNumber)
      .eq("is_selected", true)
      .maybeSingle();
    gotwGameId = gotwSelected?.game_id ?? null;
  }

  const plans = h2hGames.map((game) => ({
    leagueId: context.league_id,
    seasonNumber,
    weekNumber,
    gameId: game.id,
    channelName: slug(`${teamNickname(game.away_team?.name, "away")}-vs-${teamNickname(game.home_team?.name, "home")}`),
    awayTeamId: game.away_team_id,
    homeTeamId: game.home_team_id,
    awayTeamName: teamNickname(game.away_team?.name, "Away Team"),
    homeTeamName: teamNickname(game.home_team?.name, "Home Team"),
    awayUserId: game.away_user_id,
    homeUserId: game.home_user_id,
    awayDiscordId: game.away_user_id ? discordByUser.get(String(game.away_user_id)) ?? null : null,
    homeDiscordId: game.home_user_id ? discordByUser.get(String(game.home_user_id)) ?? null : null,
    categoryId: routes?.game_channels_category_id ?? null,
    nextAdvanceTimes: advanceTimes,
    streamingRequired: streamingRequirement === "required",
    streamingRequirement: streamingRequirementText(streamingRequirement),
    fourthDownRules,
    fairSimRequirements: (config?.fair_sim_requirements as string | null | undefined) ?? null,
    forceWinRequirements: (config?.force_win_requirements as string | null | undefined) ?? null,
    isGotw: isPlayoffStage || (gotwGameId ? String(game.id) === String(gotwGameId) : false),
    isPlayoff: isPlayoffStage,
    seasonStage: stage
  }));
  return { plans, routes, league, server: context.rec_discord_servers };
}

export async function getActiveGameChannels(guildId: string) {
  const context = await getLeagueContext(guildId);
  const { data, error } = await supabase.from("rec_game_channels").select("*").eq("league_id", context.league_id).eq("status", "active");
  if (error) throw error;
  return { channels: data ?? [] };
}

export async function recordGameChannel(input: any) {
  const { data, error } = await supabase.from("rec_game_channels").upsert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    game_id: input.gameId,
    discord_channel_id: input.discordChannelId,
    away_team_id: input.awayTeamId,
    home_team_id: input.homeTeamId,
    away_user_id: input.awayUserId,
    home_user_id: input.homeUserId,
    status: "active",
    updated_at: new Date().toISOString()
  }, { onConflict: "discord_channel_id" }).select("*").single();
  if (error) throw error;
  return { channel: data };
}

export async function markGameChannelDeleted(input: { discordChannelId: string }) {
  const { data, error } = await supabase.from("rec_game_channels").update({ status: "deleted", deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("discord_channel_id", input.discordChannelId).select("*");
  if (error) throw error;
  return { channels: data ?? [] };
}

export async function recordGameChannelCheckin(input: { discordChannelId: string; discordUserId: string }) {
  const { data: channel, error } = await supabase.from("rec_game_channels").select("*").eq("discord_channel_id", input.discordChannelId).eq("status", "active").maybeSingle();
  if (error) throw error;
  if (!channel) return { recorded: false };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordUserId).maybeSingle();
  const existing = await supabase.from("rec_game_channel_checkins").select("*").eq("game_channel_id", channel.id).eq("discord_user_id", input.discordUserId).maybeSingle();
  if (existing.data) {
    await supabase.from("rec_game_channel_checkins").update({ last_message_at: new Date().toISOString(), message_count: (existing.data.message_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", existing.data.id);
  } else {
    await supabase.from("rec_game_channel_checkins").insert({ game_channel_id: channel.id, league_id: channel.league_id, season_number: channel.season_number, week_number: channel.week_number, discord_channel_id: input.discordChannelId, discord_user_id: input.discordUserId, user_id: discord?.user_id ?? null });
  }
  return { recorded: true };
}

export async function getReminderState(guildId: string) {
  const active = await getActiveGameChannels(guildId);
  const ids = active.channels.map((c: any) => c.id);
  if (!ids.length) return { channels: [] };
  const { data: checkins } = await supabase.from("rec_game_channel_checkins").select("*").in("game_channel_id", ids);
  const { data: reminders } = await supabase.from("rec_game_channel_reminders").select("*").in("game_channel_id", ids);
  return { channels: active.channels, checkins: checkins ?? [], reminders: reminders ?? [] };
}

export async function recordReminder(input: { gameChannelId: string; reminderType: string; targetUserId?: string | null; status?: string; details?: any }) {
  const { data, error } = await supabase.from("rec_game_channel_reminders").upsert({ game_channel_id: input.gameChannelId, reminder_type: input.reminderType, target_user_id: input.targetUserId ?? null, status: input.status ?? "sent", details: input.details ?? {} }, { onConflict: "game_channel_id,reminder_type,target_user_id" }).select("*").single();
  if (error) throw error;

  if (input.reminderType === "twelve_hour" && input.details?.missingUserIds?.length) {
    const { data: channel } = await supabase.from("rec_game_channels").select("*").eq("id", input.gameChannelId).maybeSingle();
    if (channel) {
      const rows = input.details.missingUserIds.map((userId: string) => ({
        league_id: channel.league_id,
        season_number: channel.season_number,
        week_number: channel.week_number,
        game_channel_id: input.gameChannelId,
        game_id: channel.game_id,
        user_id: userId,
        penalty_type: "no_12_hour_checkin",
        details: input.details ?? {},
        created_at: nowIso()
      }));
      if (rows.length) await supabase.from("rec_game_channel_activity_penalties").insert(rows);
    }
  }

  return { reminder: data };
}


function getScorePair(game: any) {
  const home = asNumber(game.home_score);
  const away = asNumber(game.away_score);
  return { home, away };
}

function isCompletedGame(game: any) {
  const { home, away } = getScorePair(game);
  return game.status === "final" || game.status === "completed" || home > 0 || away > 0 || game.is_tie || game.winning_user_id || game.losing_user_id;
}

function gameApplyKey(game: any) {
  return [game.league_id, game.season_number, game.week_number, game.external_game_id ?? game.id].join(":");
}

async function incrementRecord(table: string, match: Record<string, any>, patch: Record<string, any>) {
  const { data: existing, error: readError } = await supabase.from(table).select("*").match(match).maybeSingle();
  if (readError) throw readError;
  if (existing) {
    const gamesPlayed = asNumber(existing.games_played) + asNumber(patch.games_played);
    const pointDifferential = asNumber(existing.point_differential) + asNumber(patch.point_differential);
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(patch)) update[key] = asNumber(existing[key]) + asNumber(value);
    if ("games_played" in patch) update.avg_point_differential = gamesPlayed ? pointDifferential / gamesPlayed : 0;
    await supabase.from(table).update(update).match(match);
  } else {
    const gamesPlayed = asNumber(patch.games_played);
    const pointDifferential = asNumber(patch.point_differential);
    await supabase.from(table).insert({ ...match, ...patch, avg_point_differential: gamesPlayed ? pointDifferential / gamesPlayed : 0 });
  }
}

async function incrementH2h(table: string, match: Record<string, any>, userAResult: { wins: number; losses: number; ties: number; pointDifferential: number }) {
  const { data: existing, error: readError } = await supabase.from(table).select("*").match(match).maybeSingle();
  if (readError) throw readError;
  const gamesPlayed = asNumber(existing?.games_played) + 1;
  const pointDifferential = asNumber(existing?.user_a_point_differential) + userAResult.pointDifferential;
  const row = {
    ...match,
    user_a_wins: asNumber(existing?.user_a_wins) + userAResult.wins,
    user_a_losses: asNumber(existing?.user_a_losses) + userAResult.losses,
    user_a_ties: asNumber(existing?.user_a_ties) + userAResult.ties,
    user_a_point_differential: pointDifferential,
    games_played: gamesPlayed,
    avg_user_a_point_differential: gamesPlayed ? pointDifferential / gamesPlayed : 0,
    last_played_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (existing) await supabase.from(table).update(row).match(match);
  else await supabase.from(table).insert(row);
}

export async function applyAdvanceRecords(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const { data: games, error } = await supabase
    .from("rec_game_results")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .is("records_applied_at", null);
  if (error) throw error;
  let applied = 0;
  for (const game of games ?? []) {
    if (!isCompletedGame(game)) continue;
    const applyKey = gameApplyKey(game);
    const { home, away } = getScorePair(game);
    const participants = [
      { userId: game.home_user_id, teamId: game.home_team_id, score: home, oppScore: away },
      { userId: game.away_user_id, teamId: game.away_team_id, score: away, oppScore: home }
    ].filter((p) => p.userId);
    const isH2H = Boolean(game.home_user_id && game.away_user_id);
    for (const p of participants) {
      const win = p.score > p.oppScore ? 1 : 0;
      const loss = p.score < p.oppScore ? 1 : 0;
      const tie = p.score === p.oppScore ? 1 : 0;
      const delta = p.score - p.oppScore;
      const closeGame = win && Math.abs(delta) <= 7 ? 1 : 0;
      const blowoutWin = delta >= 22 ? 1 : 0;
      const blowoutLoss = delta <= -22 ? 1 : 0;
      const patch = {
        wins: win, losses: loss, ties: tie, games_played: 1,
        point_differential: delta,
        points_for: p.score, points_against: p.oppScore,
        close_games_within_7: closeGame,
        blowout_wins_by_22_plus: blowoutWin,
        blowout_losses_by_22_plus: blowoutLoss
      };
      // Global record tracks H2H only; season/league records count all games including CPU
      if (isH2H) {
        await incrementRecord("rec_global_user_records", { user_id: p.userId }, patch).catch(() => undefined);
      }
      await incrementRecord("rec_league_user_records", { league_id: context.league_id, user_id: p.userId }, patch).catch(() => undefined);
      await incrementRecord("rec_season_user_records", { league_id: context.league_id, season_number: seasonNumber, user_id: p.userId }, patch).catch(() => undefined);
    }
    if (isH2H) {
      const ids = [game.home_user_id, game.away_user_id].sort();
      const userAIsHome = ids[0] === game.home_user_id;
      const userAPd = userAIsHome ? home - away : away - home;
      const userAResult = { wins: userAPd > 0 ? 1 : 0, losses: userAPd < 0 ? 1 : 0, ties: userAPd === 0 ? 1 : 0, pointDifferential: userAPd };
      await incrementH2h("rec_user_h2h_global_records", { user_a_id: ids[0], user_b_id: ids[1] }, userAResult);
      await incrementH2h("rec_user_h2h_league_records", { league_id: context.league_id, user_a_id: ids[0], user_b_id: ids[1] }, userAResult);
    }
    await supabase.from("rec_game_results").update({ records_applied_at: new Date().toISOString(), records_apply_key: applyKey, updated_at: new Date().toISOString() }).eq("id", game.id);
    applied += 1;
  }
  return { applied };
}

export async function auditAndRepairRecords(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  // Fetch every completed game for the current season (and all seasons for league-wide repair)
  const { data: seasonGames } = await supabase
    .from("rec_game_results")
    .select("id,home_user_id,away_user_id,home_score,away_score,winning_user_id,losing_user_id,is_tie,status,season_number,records_applied_at,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber);

  const { data: allLeagueGames } = await supabase
    .from("rec_game_results")
    .select("id,home_user_id,away_user_id,home_score,away_score,winning_user_id,losing_user_id,is_tie,status,season_number,week_number")
    .eq("league_id", leagueId);

  const completed = (games: any[]) => games.filter(isCompletedGame);

  // ── Rebuild season records ───────────────────────────────────────────────────
  type UserStats = {
    wins: number; losses: number; ties: number; games_played: number;
    point_differential: number; points_for: number; points_against: number;
    close_games_within_7: number; blowout_wins_by_22_plus: number; blowout_losses_by_22_plus: number;
  };

  function freshStats(): UserStats {
    return { wins: 0, losses: 0, ties: 0, games_played: 0, point_differential: 0, points_for: 0, points_against: 0, close_games_within_7: 0, blowout_wins_by_22_plus: 0, blowout_losses_by_22_plus: 0 };
  }

  function accumulate(acc: UserStats, score: number, oppScore: number) {
    const delta = score - oppScore;
    acc.games_played += 1;
    acc.points_for += score;
    acc.points_against += oppScore;
    acc.point_differential += delta;
    if (delta > 0) { acc.wins += 1; if (delta >= 22) acc.blowout_wins_by_22_plus += 1; if (delta <= 7) acc.close_games_within_7 += 1; }
    else if (delta < 0) { acc.losses += 1; if (delta <= -22) acc.blowout_losses_by_22_plus += 1; }
    else acc.ties += 1;
  }

  // Season totals
  const seasonTotals = new Map<string, UserStats>();
  for (const g of completed(seasonGames ?? [])) {
    const { home, away } = getScorePair(g);
    if (g.home_user_id) {
      if (!seasonTotals.has(g.home_user_id)) seasonTotals.set(g.home_user_id, freshStats());
      accumulate(seasonTotals.get(g.home_user_id)!, home, away);
    }
    if (g.away_user_id) {
      if (!seasonTotals.has(g.away_user_id)) seasonTotals.set(g.away_user_id, freshStats());
      accumulate(seasonTotals.get(g.away_user_id)!, away, home);
    }
  }

  // League-wide totals (all seasons combined)
  const leagueTotals = new Map<string, UserStats>();
  for (const g of completed(allLeagueGames ?? [])) {
    const { home, away } = getScorePair(g);
    if (g.home_user_id) {
      if (!leagueTotals.has(g.home_user_id)) leagueTotals.set(g.home_user_id, freshStats());
      accumulate(leagueTotals.get(g.home_user_id)!, home, away);
    }
    if (g.away_user_id) {
      if (!leagueTotals.has(g.away_user_id)) leagueTotals.set(g.away_user_id, freshStats());
      accumulate(leagueTotals.get(g.away_user_id)!, away, home);
    }
  }

  // Upsert season records (full overwrite)
  for (const [userId, stats] of seasonTotals) {
    try {
      await supabase.from("rec_season_user_records").upsert(
        { ...stats, user_id: userId, league_id: leagueId, season_number: seasonNumber, updated_at: new Date().toISOString() },
        { onConflict: "user_id,league_id,season_number" }
      );
    } catch { /* non-fatal */ }
  }

  // Upsert league-wide records (full overwrite)
  for (const [userId, stats] of leagueTotals) {
    try {
      await supabase.from("rec_league_user_records").upsert(
        { ...stats, user_id: userId, league_id: leagueId, updated_at: new Date().toISOString() },
        { onConflict: "user_id,league_id" }
      );
    } catch { /* non-fatal */ }
  }

  // ── Rebuild H2H league records ───────────────────────────────────────────────
  type H2HStats = { wins: number; losses: number; ties: number; games_played: number; point_differential: number };
  const h2hTotals = new Map<string, H2HStats>();
  const h2hKey = (a: string, b: string) => [a, b].sort().join(":::");

  for (const g of completed(allLeagueGames ?? [])) {
    if (!g.home_user_id || !g.away_user_id) continue;
    const { home, away } = getScorePair(g);
    const ids = [g.home_user_id, g.away_user_id].sort() as [string, string];
    const key = h2hKey(ids[0], ids[1]);
    if (!h2hTotals.has(key)) h2hTotals.set(key, { wins: 0, losses: 0, ties: 0, games_played: 0, point_differential: 0 });
    const rec = h2hTotals.get(key)!;
    const userAIsHome = ids[0] === g.home_user_id;
    const userAPd = userAIsHome ? home - away : away - home;
    rec.games_played += 1;
    rec.point_differential += userAPd;
    if (userAPd > 0) rec.wins += 1;
    else if (userAPd < 0) rec.losses += 1;
    else rec.ties += 1;
  }

  for (const [key, stats] of h2hTotals) {
    const [userAId, userBId] = key.split(":::");
    try {
      await supabase.from("rec_user_h2h_league_records").upsert(
        { ...stats, user_a_id: userAId, user_b_id: userBId, league_id: leagueId, updated_at: new Date().toISOString() },
        { onConflict: "user_a_id,user_b_id,league_id" }
      );
    } catch { /* non-fatal */ }
  }

  // ── Mark untracked games so future applyAdvanceRecords won't double-count ───
  const unapplied = (seasonGames ?? []).filter((g) => isCompletedGame(g) && !g.records_applied_at);
  for (const g of unapplied) {
    try {
      await supabase.from("rec_game_results").update({ records_applied_at: new Date().toISOString(), records_apply_key: gameApplyKey(g), updated_at: new Date().toISOString() }).eq("id", g.id);
    } catch { /* non-fatal */ }
  }

  return {
    seasonRecordsRepaired: seasonTotals.size,
    leagueRecordsRepaired: leagueTotals.size,
    h2hPairsRepaired: h2hTotals.size,
    gamesMarkedApplied: unapplied.length
  };
}

export async function calculateRecPotw(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = Math.max(1, (league.current_week ?? 1) - 1);
  const { data: assignments, error: assignmentError } = await supabase.from("rec_team_assignments").select("team_id,user_id,rec_teams(conference)").eq("league_id", context.league_id).eq("assignment_status", "active").is("ended_at", null);
  if (assignmentError) throw assignmentError;
  const eligible = new Map((assignments ?? []).map((a: any) => [a.team_id, a]));
  // Use committed player weekly stats instead of staging data
  const { data: statsRows, error } = await supabase
    .from("rec_player_weekly_stats")
    .select("*, rec_players(id,madden_player_id,position,full_name,league_id), rec_teams(id,name,abbreviation)")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (error) throw error;
  const candidates: any[] = [];
  for (const row of statsRows ?? []) {
    const assignment = [...eligible.values()].find((a: any) => String(a.team_id) === String(row.team_id));
    if (!assignment) continue;
    const conference = assignment.rec_teams?.conference ?? "Unknown";
    const position = row.rec_players?.position ?? row.position ?? null;
    const playerName = row.rec_players?.full_name ?? row.player_name ?? "Unknown Player";
    const stats = (row.stats ?? row.raw_payload ?? {}) as Record<string, any>;
    const offensiveScore = calculateOffensivePotwScore({ position, passYds: asNumber(stats.passYds), passTDs: asNumber(stats.passTDs), passInts: asNumber(stats.passInts), rushYds: asNumber(stats.rushYds), rushTDs: asNumber(stats.rushTDs), recYds: asNumber(stats.recYds), recTDs: asNumber(stats.recTDs), receptions: asNumber(stats.recCatches ?? stats.receptions) });
    const defensiveScore = calculateDefensivePotwScore({ sacks: asNumber(stats.defSacks), ints: asNumber(stats.defInts), defensiveTDs: asNumber(stats.defTDs), forcedFumbles: asNumber(stats.defForcedFum), tackles: asNumber(stats.defTackles ?? stats.tackles), tacklesForLoss: asNumber(stats.defTFL ?? stats.tacklesForLoss) });
    candidates.push({ row, assignment, conference, position, playerName, offensiveScore, defensiveScore });
  }
  const awards: any[] = [];
  for (const conference of [...new Set(candidates.map((c) => c.conference))]) {
    const group = candidates.filter((c) => c.conference === conference);
    const offense = group.sort((a, b) => b.offensiveScore - a.offensiveScore)[0];
    const defense = group.sort((a, b) => b.defensiveScore - a.defensiveScore)[0];
    for (const [side, winner, score] of [["offense", offense, offense?.offensiveScore], ["defense", defense, defense?.defensiveScore]] as const) {
      if (!winner || !score || score <= 0) continue;
      awards.push({ league_id: context.league_id, season_number: seasonNumber, week_number: weekNumber, conference, award_side: side, award_source: "rec_calculated", player_external_id: String(winner.row.rec_players?.madden_player_id ?? winner.row.madden_player_id ?? ""), player_name: winner.playerName, position: winner.position, team_id: winner.assignment.team_id, user_id: winner.assignment.user_id, score, payout_amount: REC_POTW_PAYOUT_AMOUNT, weeklyStats: winner.row.stats ?? {}, raw_payload: winner.row.raw_payload ?? {} });
    }
  }
  // Persist to DB without the in-memory weeklyStats field
  if (awards.length) {
    const dbAwards = awards.map(({ weeklyStats: _ws, ...rest }: any) => rest);
    await supabase.from("rec_weekly_player_awards").upsert(dbAwards, { onConflict: "league_id,season_number,week_number,conference,award_side,award_source" });
  }
  return { awards };
}


export async function evaluateWeeklyChallenges(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);
  const { data: challenges, error } = await supabase
    .from("rec_weekly_challenges")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek)
    .eq("status", "active");
  if (error) throw error;

  let evaluated = 0;
  let paid = 0;

  for (const challenge of challenges ?? []) {
    const game = await getCompletedResultForChallenge(challenge);
    if (!game || typeof game.home_score !== "number" || typeof game.away_score !== "number") continue;
    const side = userTeamSide(game, challenge.user_id);
    if (!side) continue;
    const didWin = side.score > side.oppScore;
    let earnedTier: "S" | "A" | "B" | null = didWin ? "B" : null;
    const details: Record<string, unknown> = { didWin, score: side.score, opponentScore: side.oppScore };

    if (didWin) {
      const template = CHALLENGE_TEMPLATE_MAP.get(challenge.challenge_key);
      if (template) {
        const leagueId = context.league_id;
        const evalType = template.eval_type;
        if (evalType === "score_margin") {
          const margin = side.score - side.oppScore;
          details.margin = margin;
          if (margin >= template.s_threshold) earnedTier = "S";
          else if (margin >= template.a_threshold) earnedTier = "A";
        } else if (evalType === "opp_score_max") {
          details.opponentScore = side.oppScore;
          if (side.oppScore <= template.s_threshold) earnedTier = "S";
          else if (side.oppScore <= template.a_threshold) earnedTier = "A";
        } else if (evalType === "team_stat_min") {
          const { total, hasData } = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, template.stat_columns);
          details[template.stat_columns[0]] = total;
          details.hasData = hasData;
          if (hasData) {
            if (total >= template.s_threshold) earnedTier = "S";
            else if (total >= template.a_threshold) earnedTier = "A";
          }
        } else if (evalType === "team_stat_max") {
          const { total, hasData } = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, template.stat_columns);
          details[template.stat_columns[0]] = total;
          details.hasData = hasData;
          if (hasData) {
            if (total <= template.s_threshold) earnedTier = "S";
            else if (total <= template.a_threshold) earnedTier = "A";
          }
        } else if (evalType === "total_yards") {
          const [passResult, rushResult] = await Promise.all([
            sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["passYds"]),
            sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["rushYds"])
          ]);
          const totalYards = passResult.total + rushResult.total;
          details.passYards = passResult.total;
          details.rushYards = rushResult.total;
          details.totalYards = totalYards;
          details.hasData = passResult.hasData || rushResult.hasData;
          if (details.hasData) {
            if (totalYards >= template.s_threshold) earnedTier = "S";
            else if (totalYards >= template.a_threshold) earnedTier = "A";
          }
        } else if (evalType === "opp_stat_max") {
          const { total, hasData } = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.opponentTeamId, template.stat_columns);
          details[`opp_${template.stat_columns[0]}`] = total;
          details.hasData = hasData;
          if (hasData) {
            if (total <= template.s_threshold) earnedTier = "S";
            else if (total <= template.a_threshold) earnedTier = "A";
          }
        } else if (evalType === "own_def_stat") {
          const { total, hasData } = await sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, template.stat_columns);
          details[template.stat_columns[0]] = total;
          details.hasData = hasData;
          if (hasData) {
            if (total >= template.s_threshold) earnedTier = "S";
            else if (total >= template.a_threshold) earnedTier = "A";
          }
        } else if (evalType === "turnovers") {
          const [intResult, fumResult] = await Promise.all([
            sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["defInts"]),
            sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["defForcedFum"])
          ]);
          const turnovers = intResult.total + fumResult.total;
          details.defInterceptions = intResult.total;
          details.forcedFumbles = fumResult.total;
          details.turnovers = turnovers;
          details.hasData = intResult.hasData || fumResult.hasData;
          if (details.hasData) {
            if (turnovers >= template.s_threshold) earnedTier = "S";
            else if (turnovers >= template.a_threshold) earnedTier = "A";
          }
        } else if (evalType === "completion_pct") {
          const { pct, hasData } = await getTeamCompletionPct(leagueId, seasonNumber, completedWeek, side.teamId);
          details.completionPct = pct;
          details.hasData = hasData;
          if (hasData) {
            if (pct >= template.s_threshold) earnedTier = "S";
            else if (pct >= template.a_threshold) earnedTier = "A";
          }
        } else if (evalType === "opp_completion_pct") {
          const { pct, hasData } = await getTeamCompletionPct(leagueId, seasonNumber, completedWeek, side.opponentTeamId);
          details.oppCompletionPct = pct;
          details.hasData = hasData;
          if (hasData) {
            // s_threshold / a_threshold are MAX values (lower = better for defense)
            if (pct < template.s_threshold) earnedTier = "S";
            else if (pct < template.a_threshold) earnedTier = "A";
          }
        } else if (evalType === "balanced_attack") {
          const [passResult, rushResult] = await Promise.all([
            sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["passYds"]),
            sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.teamId, ["rushYds"])
          ]);
          details.passYards = passResult.total;
          details.rushYards = rushResult.total;
          details.hasData = passResult.hasData || rushResult.hasData;
          if (details.hasData) {
            if (passResult.total >= template.s_threshold && rushResult.total >= (template.s_threshold2 ?? 0)) earnedTier = "S";
            else if (passResult.total >= template.a_threshold && rushResult.total >= (template.a_threshold2 ?? 0)) earnedTier = "A";
          }
        } else if (evalType === "user_score_min") {
          details.userScore = side.score;
          details.hasData = true;
          if (side.score >= template.s_threshold) earnedTier = "S";
          else if (side.score >= template.a_threshold) earnedTier = "A";
        } else if (evalType === "bend_not_break") {
          const [oppPassResult, oppRushResult] = await Promise.all([
            sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.opponentTeamId, ["passYds"]),
            sumTeamStatFromCommitted(leagueId, seasonNumber, completedWeek, side.opponentTeamId, ["rushYds"])
          ]);
          const oppTotalYards = oppPassResult.total + oppRushResult.total;
          details.oppTotalYards = oppTotalYards;
          details.oppScore = side.oppScore;
          details.hasData = oppPassResult.hasData || oppRushResult.hasData;
          if (details.hasData && oppTotalYards >= 350) {
            if (side.oppScore <= template.s_threshold) earnedTier = "S";
            else if (side.oppScore <= template.a_threshold) earnedTier = "A";
          }
        }
      }
    }

    const amount = earnedTier ? REC_WEEKLY_CHALLENGE_PAYOUTS[earnedTier] : 0;
    let ledgerId: string | null = null;
    if (amount > 0) {
      const credit = await creditUserWallet({
        userId: challenge.user_id,
        leagueId: context.league_id,
        seasonNumber,
        amount,
        transactionType: "weekly_challenge",
        description: `${challenge.challenge_side === "offense" ? "Offensive" : "Defensive"} Weekly Challenge - ${earnedTier} Tier`,
        sourceReference: {
          idempotencyKey: `weekly_challenge:${challenge.id}:${earnedTier}`,
          type: "weekly_challenge",
          challengeId: challenge.id,
          tier: earnedTier,
          weekNumber: completedWeek
        }
      });
      ledgerId = credit.ledger?.id ?? null;
      if (credit.created) paid += amount;
    }

    const { error: updateError } = await supabase
      .from("rec_weekly_challenges")
      .update({
        status: "evaluated",
        earned_tier: earnedTier,
        earned_amount: amount,
        evaluation_details: details,
        evaluated_at: nowIso(),
        paid_ledger_id: ledgerId,
        updated_at: nowIso()
      })
      .eq("id", challenge.id);
    if (updateError) throw updateError;
    evaluated += 1;
  }

  return { evaluated, paid, weekNumber: completedWeek, seasonNumber };
}

export async function issueRecPotwPayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);
  const { data: awards, error } = await supabase
    .from("rec_weekly_player_awards")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek)
    .is("paid_ledger_id", null)
    .not("user_id", "is", null);
  if (error) throw error;
  let issued = 0;
  for (const award of awards ?? []) {
    const amount = asNumber(award.payout_amount || REC_POTW_PAYOUT_AMOUNT);
    const credit = await creditUserWallet({
      userId: award.user_id,
      leagueId: context.league_id,
      seasonNumber,
      amount,
      transactionType: "potw",
      description: `${award.conference} ${award.award_side === "offense" ? "Offensive" : "Defensive"} REC POTW - ${award.player_name}`,
      sourceReference: {
        idempotencyKey: `potw:${award.id}`,
        type: "rec_potw",
        awardId: award.id,
        weekNumber: completedWeek
      }
    });
    if (credit.ledger?.id) {
      await supabase.from("rec_weekly_player_awards").update({ paid_ledger_id: credit.ledger.id, updated_at: nowIso() }).eq("id", award.id);
    }
    if (credit.created) issued += amount;
  }
  return { issued, awards: awards?.length ?? 0, weekNumber: completedWeek };
}

export async function evaluateStreamCompliance(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const completedWeek = Math.max(1, (league.current_week ?? 1) - 1);
  const features = await getLeagueFeatureSettings(context.league_id).catch(() => null);
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const requirement = stage === "regular_season" ? features?.regular_season_streaming_requirement ?? features?.streaming_requirement : features?.postseason_streaming_requirement ?? features?.streaming_requirement;
  const streamingRequired = requirement === "required";
  if (!streamingRequired) return { checked: 0, missed: 0, required: false };

  const sidePolicy = features?.streaming_side ?? "either";
  const { data: games, error } = await supabase
    .from("rec_game_results")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek);
  if (error) throw error;

  let checked = 0;
  let missed = 0;
  for (const game of games ?? []) {
    const sides = [
      { key: "home", userId: game.home_user_id, teamId: game.home_team_id },
      { key: "away", userId: game.away_user_id, teamId: game.away_team_id }
    ].filter((side) => side.userId);
    if (!sides.length) continue;

    const requiredSides = sidePolicy === "home" ? sides.filter((s) => s.key === "home")
      : sidePolicy === "away" ? sides.filter((s) => s.key === "away")
      : sidePolicy === "both" ? sides
      : sides;

    const { data: streamLogs } = await supabase
      .from("rec_stream_compliance_logs")
      .select("*")
      .eq("league_id", context.league_id)
      .eq("season_number", seasonNumber)
      .eq("week_number", completedWeek)
      .in("status", ["posted", "required_complied"]);

    for (const side of requiredSides) {
      const hasStream = (streamLogs ?? []).some((log: any) => log.user_id === side.userId);
      checked += 1;
      if (hasStream) {
        await supabase.from("rec_stream_compliance_logs").insert({
          league_id: context.league_id,
          season_number: seasonNumber,
          week_number: completedWeek,
          user_id: side.userId,
          team_id: side.teamId,
          required: true,
          complied: true,
          status: "required_complied",
          details: { gameId: game.id, streamingSide: sidePolicy, source: "advance_evaluation" }
        });
      } else {
        missed += 1;
        await supabase.from("rec_stream_compliance_logs").insert({
          league_id: context.league_id,
          season_number: seasonNumber,
          week_number: completedWeek,
          user_id: side.userId,
          team_id: side.teamId,
          required: true,
          complied: false,
          status: "required_missed",
          details: { gameId: game.id, streamingSide: sidePolicy, source: "advance_evaluation" }
        });
      }
    }
  }
  return { checked, missed, required: true };
}

export async function buildAdvanceDmPayloads(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const { data: challenges } = await supabase.from("rec_weekly_challenges").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  const { data: channels } = await supabase.from("rec_game_channels").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).eq("status", "active");
  const completedWeek = Math.max(1, weekNumber - 1);
  const { data: awards } = await supabase.from("rec_weekly_player_awards").select("*").eq("league_id", context.league_id).eq("season_number", seasonNumber).eq("week_number", completedWeek);
  // Note: .eq("season_id", null) never matched (SQL = NULL is never true), and the type list
  // omitted weekly_game_payout — so game win/loss payouts never appeared in advance DMs. Filter
  // by league only and include every payout transaction type written during advance.
  const { data: payouts } = await supabase
    .from("rec_dollar_ledger")
    .select("user_id,amount,transaction_type,description,source_reference,created_at")
    .eq("league_id", context.league_id)
    .in("transaction_type", ["weekly_game_payout", "weekly_challenge", "potw", "gotw_correct_guess", "stream_payout", "credit"]);
  const { data: wallets } = await supabase.from("rec_wallets").select("user_id,wallet_balance,savings_balance");
  const walletByUser = new Map((wallets ?? []).map((wallet: any) => [wallet.user_id, wallet]));
  const { data: discordAccounts } = await supabase.from("rec_discord_accounts").select("user_id,discord_id");
  const discordByUser = new Map((discordAccounts ?? []).map((d: any) => [d.user_id, d.discord_id]));
  const payloads: any[] = [];
  for (const game of games) {
    const sides = [
      { userId: game.home_user_id, teamId: game.home_team_id, opponentTeam: teamNickname(game.away_team?.name, "Opponent"), location: "Home", opponentUserId: game.away_user_id },
      { userId: game.away_user_id, teamId: game.away_team_id, opponentTeam: teamNickname(game.home_team?.name, "Opponent"), location: "Away", opponentUserId: game.home_user_id }
    ].filter((s) => s.userId);
    for (const side of sides) {
      const gameChannel = (channels ?? []).find((c: any) => c.game_id === game.id);
      payloads.push({
        userId: side.userId,
        discordId: discordByUser.get(side.userId),
        leagueName: league.name,
        serverName: context.rec_discord_servers?.name ?? "",
        seasonNumber,
        weekNumber,
        seasonStage: league.season_stage,
        nextAdvanceTimes: formatAdvanceTimes(league.next_advance_at),
        matchup: { opponent: side.opponentTeam, location: side.location, gameType: side.opponentUserId ? "User H2H" : "CPU", gameChannelId: gameChannel?.discord_channel_id ?? null },
        streaming: { required: false, requirement: "Based on league settings" },
        challenges: (challenges ?? []).filter((c: any) => c.user_id === side.userId),
        payouts: (payouts ?? [])
          .filter((payout: any) => payout.user_id === side.userId && asNumber(payout.source_reference?.weekNumber) === completedWeek)
          .map((payout: any) => ({ label: payout.description ?? payout.transaction_type, amount: payout.amount ?? 0, type: payout.transaction_type })),
        walletBalance: walletByUser.get(side.userId)?.wallet_balance ?? 0,
        potwAwards: (awards ?? []).filter((a: any) => a.user_id === side.userId).map((a: any) => ({ label: `${a.conference} ${a.award_side === "offense" ? "Offensive" : "Defensive"} REC POTW`, playerName: a.player_name, amount: a.payout_amount ?? REC_POTW_PAYOUT_AMOUNT })),
        gotw: { isParticipant: false, message: "Go to /menu to vote for the H2H GOTW winner. Correct guesses may earn a payout." },
        deadlines: []
      });
    }
  }
  const routes = await getRoutes(context.server_id);
  const announcementsChannelId = routes?.announcements_channel_id ?? null;
  const allMatchups = games.map((game) => ({
    awayTeamName: teamNickname(game.away_team?.name, "Away"),
    homeTeamName: teamNickname(game.home_team?.name, "Home"),
    awayUserId: game.away_user_id,
    homeUserId: game.home_user_id,
    awayDiscordId: game.away_user_id ? (discordByUser.get(game.away_user_id) ?? null) : null,
    homeDiscordId: game.home_user_id ? (discordByUser.get(game.home_user_id) ?? null) : null,
    isCpu: !game.away_user_id || !game.home_user_id
  }));
  return { payloads, announcementsChannelId, weekNumber, seasonNumber, leagueName: league.name, seasonStage: league.season_stage, nextAdvanceTimes: formatAdvanceTimes(league.next_advance_at), allMatchups };
}

export async function issueWeeklyGamePayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  // The league week is advanced before payout steps run, so the just-played week is current - 1.
  const weekNumber = Math.max(1, asNumber(league.current_week ?? 1) - 1);

  const { data: results, error } = await supabase
    .from("rec_game_results")
    .select("id,home_user_id,away_user_id,home_score,away_score,is_tie,is_cpu_game,is_user_h2h,week_number,home_team_id,away_team_id")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber);
  if (error) throw error;

  const assignments = await getLinkedActiveTeamUsers(leagueId);
  const teamIdToDiscordId = new Map<string, string>();
  for (const a of assignments) {
    if (a.team_id && a.user_id) {
      const { data: discord } = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", a.user_id).maybeSingle();
      if (discord?.discord_id) teamIdToDiscordId.set(String(a.team_id), discord.discord_id);
    }
  }

  const issued: Array<{ userId: string; amount: number; reason: string; created: boolean }> = [];
  const skipped: Array<{ resultId: string; reason: string }> = [];

  for (const result of results ?? []) {
    if (result.is_tie) { skipped.push({ resultId: result.id, reason: "tie" }); continue; }

    const homeUserId = result.home_user_id;
    const awayUserId = result.away_user_id;
    const homeScore = asNumber(result.home_score);
    const awayScore = asNumber(result.away_score);
    const homeWon = homeScore > awayScore;

    const candidates: Array<{ userId: string | null; won: boolean; isCpu: boolean }> = [
      { userId: homeUserId, won: homeWon, isCpu: !homeUserId },
      { userId: awayUserId, won: !homeWon, isCpu: !awayUserId }
    ];

    for (const side of candidates) {
      if (!side.userId) continue;
      const isH2H = Boolean(homeUserId && awayUserId);
      let amount = 0;
      let reason = "";
      if (isH2H) {
        amount = side.won ? 50 : 20;
        reason = side.won ? "H2H win" : "H2H loss";
      } else if (side.won) {
        amount = 20;
        reason = "CPU win";
      }
      if (!amount) { skipped.push({ resultId: result.id, reason: "cpu_loss_no_payout" }); continue; }

      const idempotencyKey = `game_payout:${result.id}:${side.userId}`;
      const credit = await creditUserWallet({
        userId: side.userId,
        leagueId,
        seasonNumber,
        amount,
        transactionType: "weekly_game_payout",
        description: `Week ${weekNumber} ${reason}`,
        sourceReference: { idempotencyKey, resultId: result.id, weekNumber, seasonNumber }
      });
      issued.push({ userId: side.userId, amount, reason, created: credit.created });
    }
  }

  return { issued, skipped, weekNumber, seasonNumber };
}

const SAVINGS_INTEREST_RATE = 0.035;
const INTEREST_RATE_LIMIT = 21; // advances per 24h before interest disables
const INTEREST_DISABLE_HOURS = 24;
const MIN_LINKED_USERS_FOR_INTEREST = 12;

export async function applyAdvanceSavingsInterest(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;

  // Economy must be enabled
  const features = await getLeagueFeatureSettings(leagueId);
  if (!features?.coin_economy_enabled) return { skipped: "economy_disabled", credited: 0 };

  // Minimum 12 linked users required
  const linkedUsers = await getLinkedActiveTeamUsers(leagueId);
  if (linkedUsers.length < MIN_LINKED_USERS_FOR_INTEREST) {
    return { skipped: "insufficient_linked_users", linked: linkedUsers.length, credited: 0 };
  }

  // Rate-limit check — update the rolling 24h advance window atomically
  const now = new Date();
  const windowStart = league.advance_rate_window_start ? new Date(league.advance_rate_window_start) : null;
  const windowExpired = !windowStart || (now.getTime() - windowStart.getTime()) > 24 * 60 * 60 * 1000;

  const newCount = windowExpired ? 1 : (asNumber(league.advance_rate_count) + 1);
  const newWindowStart = windowExpired ? now.toISOString() : league.advance_rate_window_start;

  // Check if interest is already disabled from a prior rate-limit hit
  const disabledUntil = league.interest_disabled_until ? new Date(league.interest_disabled_until) : null;
  if (disabledUntil && disabledUntil > now) {
    // Still within disable window — update rate counter but skip interest
    await supabase.from("rec_leagues").update({
      advance_rate_window_start: newWindowStart,
      advance_rate_count: newCount
    }).eq("id", leagueId);
    return { skipped: "interest_disabled_until", disabledUntil: disabledUntil.toISOString(), credited: 0 };
  }

  if (newCount > INTEREST_RATE_LIMIT) {
    const disableUntil = new Date(now.getTime() + INTEREST_DISABLE_HOURS * 60 * 60 * 1000);
    await supabase.from("rec_leagues").update({
      advance_rate_window_start: newWindowStart,
      advance_rate_count: newCount,
      interest_disabled_until: disableUntil.toISOString()
    }).eq("id", leagueId);
    return { skipped: "rate_limit_exceeded", advancesInWindow: newCount, disabledUntil: disableUntil.toISOString(), credited: 0 };
  }

  // Update the rate window counter
  await supabase.from("rec_leagues").update({
    advance_rate_window_start: newWindowStart,
    advance_rate_count: newCount
  }).eq("id", leagueId);

  // Apply 3.5% interest to each linked user's savings balance
  const userIds = linkedUsers.map((a: any) => a.user_id).filter(Boolean);
  const { data: wallets } = await supabase
    .from("rec_wallets")
    .select("user_id,savings_balance")
    .in("user_id", userIds);

  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  let credited = 0;

  for (const wallet of wallets ?? []) {
    const savings = asNumber(wallet.savings_balance);
    if (savings <= 0) continue;
    const interest = Math.floor(savings * SAVINGS_INTEREST_RATE);
    if (interest <= 0) continue;

    const idempotencyKey = `savings_interest:${leagueId}:${league.current_week}:${wallet.user_id}`;

    // Check idempotency — skip if already credited this advance
    const { data: existing } = await supabase
      .from("rec_dollar_ledger")
      .select("id")
      .eq("user_id", wallet.user_id)
      .eq("transaction_type", "savings_interest")
      .contains("source_reference", { idempotencyKey })
      .maybeSingle();
    if (existing) continue;

    // Credit directly to savings_balance
    const { error: walletErr } = await supabase
      .from("rec_wallets")
      .update({ savings_balance: savings + interest, updated_at: nowIso() })
      .eq("user_id", wallet.user_id);
    if (walletErr) continue;

    // Record the ledger entry
    await supabase.from("rec_dollar_ledger").insert({
      user_id: wallet.user_id,
      league_id: leagueId,
      season_id: null,
      amount: interest,
      transaction_type: "savings_interest",
      description: `Savings interest (3.5%) — Week ${league.current_week}`,
      source: "internal_import",
      source_reference: { idempotencyKey, leagueId, week: league.current_week, seasonNumber }
    });

    credited++;
  }

  return { credited, linkedUsers: linkedUsers.length, advancesInWindow: newCount };
}

export async function assignSeasonEndBadgesForSeason(leagueId: string, seasonNumber: number) {
  return assignSeasonEndBadges(leagueId, seasonNumber);
}

export async function assignPlayoffBadgesForSeason(leagueId: string, seasonNumber: number) {
  return assignPlayoffBadges(leagueId, seasonNumber);
}

export async function advanceLeagueWeek(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const previousWeek = asNumber(league.current_week ?? 1);
  const previousStage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const weekNumber = previousWeek + 1;
  // REC season: weeks 1-18 regular season, week 19 = wild_card, 20 = divisional,
  // 21 = conference_championship, 22 = super_bowl.
  // Offseason chain: super_bowl → coach_hiring → final_resigning → free_agency → draft → preseason_training_camp → regular_season (season 2+).
  // EOS badges and payouts fire in setLeagueWeek when transitioning out of regular_season.
  const seasonStage =
    previousStage === "regular_season" && weekNumber >= 19 ? "wild_card"
    : previousStage === "wild_card" ? "divisional"
    : previousStage === "divisional" ? "conference_championship"
    : previousStage === "conference_championship" ? "super_bowl"
    : previousStage === "super_bowl" ? "coach_hiring"
    : previousStage === "coach_hiring" ? "final_resigning"
    : previousStage === "final_resigning" ? "free_agency"
    : previousStage === "free_agency" ? "draft"
    : previousStage === "draft" ? "preseason_training_camp"
    : previousStage === "preseason_training_camp" ? "regular_season"
    : previousStage;
  const weekResult = await setLeagueWeek({ guildId, weekNumber, seasonStage });
  return {
    previousWeek,
    weekNumber,
    previousStage,
    seasonStage,
    transitionBadgesEarned: weekResult.transitionBadgesEarned ?? [],
    transitionBadgesRemoved: weekResult.transitionBadgesRemoved ?? []
  };
}

export async function runPostAdvanceAutomation(input: string | { guildId: string; mode?: "normal" | "catch_up" }) {
  const guildId = typeof input === "string" ? input : input.guildId;
  const mode = typeof input === "string" ? "normal" : input.mode ?? "normal";

  // Run each step independently so one failing step (e.g. POTW with no player stats imported)
  // does not abort records/payouts or the rest of the advance. Failures surface as warnings.
  const warnings: string[] = [];
  const completed: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      completed.push(name);
    } catch (error) {
      console.error(`[ADVANCE] step "${name}" failed:`, error);
      warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Advance the league week first: every subsequent step treats current_week - 1 as the
  // just-completed week, and current_week as the upcoming week (challenges, GOTW, channels).
  let week: { previousWeek: number; weekNumber: number; previousStage: string; seasonStage: string } | null = null;
  if (mode === "normal") {
    await step("advance_week", async () => { week = await advanceLeagueWeek(guildId); });
  }

  await step("apply_records", () => applyAdvanceRecords(guildId));
  await step("game_payouts", () => issueWeeklyGamePayouts(guildId));
  await step("savings_interest", () => applyAdvanceSavingsInterest(guildId));
  await step("settle_gotw", () => settleGotwVotes(guildId));
  await step("evaluate_challenges", () => evaluateWeeklyChallenges(guildId));
  await step("calculate_potw", () => calculateRecPotw(guildId));
  await step("potw_payouts", () => issueRecPotwPayouts(guildId));
  await step("stream_compliance", () => evaluateStreamCompliance(guildId));
  await step("generate_challenges", () => generateWeeklyChallenges({ guildId, regenerate: false }));
  await step("assign_badges", () => assignWeeklyBadges(guildId));

  if (mode === "catch_up") {
    return {
      ok: warnings.length === 0,
      mode,
      week,
      completed,
      warnings,
      gameChannels: { plans: [] },
      dmPayloads: { payloads: [] },
      gotw: { pendingApproval: false, candidates: [] },
      skipped: ["advance_dms", "gotw_scheduling", "game_channel_recreation"]
    };
  }

  const gotwResult = await getGotwCandidates(guildId);
  const gameChannels = await getGameChannelPlans(guildId);
  const dmPayloads = await buildAdvanceDmPayloads(guildId);
  return {
    ok: warnings.length === 0,
    mode,
    week,
    completed,
    warnings,
    gameChannels,
    dmPayloads,
    gotw: {
      candidates: gotwResult.candidates,
      recommendedCandidate: gotwResult.candidates?.[0] ?? null,
      pendingApproval: gotwResult.candidates?.length > 0 && gotwResult.stage === "regular_season"
    }
  };
}

export async function getGotwCandidates(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const stage = league.season_stage ?? league.current_phase ?? "regular_season";
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const h2hGames = games.filter((game) => game.home_user_id && game.away_user_id);

  // Pre-fetch all user records for this league to avoid N+1 queries
  const { data: allRecords } = await supabase
    .from("rec_league_user_records")
    .select("user_id,wins,losses,ties,point_differential,games_played")
    .eq("league_id", context.league_id);
  const recordsByUser = new Map((allRecords ?? []).map((r: any) => [r.user_id, r]));

  // Calculate power rankings for all users in this league
  const powerRankings = new Map<string, any>();
  for (const record of allRecords ?? []) {
    const user_id = record.user_id;
    const winPct = record.games_played > 0 ? record.wins / record.games_played : 0;
    const avgPd = record.games_played > 0 ? record.point_differential / record.games_played : 0;
    const pdBoost = Math.max(-0.3, Math.min(0.3, avgPd / 30));
    const ranking = (winPct * 0.7) + (0.5 + pdBoost * 0.3);
    powerRankings.set(user_id, {
      ranking: Math.max(0, Math.min(1, ranking)),
      wins: record.wins,
      losses: record.losses,
      pd: record.point_differential,
      winPct,
      avgPd
    });
  }

  // Fetch all H2H records to check history
  const { data: h2hRecords } = await supabase.from("rec_user_h2h_global_records").select("user_a_id,user_b_id,wins,losses,ties,pointDifferential");
  const h2hMap = new Map<string, any>();
  for (const record of h2hRecords ?? []) {
    const key = [record.user_a_id, record.user_b_id].sort().join(":");
    h2hMap.set(key, record);
  }

  const previousWeek = Math.max(1, weekNumber - 1);
  const { data: previousGotw } = await supabase
    .from("rec_game_of_week_candidates")
    .select("away_user_id,home_user_id")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", previousWeek)
    .eq("is_selected", true);
  const previousUsers = new Set((previousGotw ?? []).flatMap((row: any) => [row.away_user_id, row.home_user_id]).filter(Boolean));

  const rows = h2hGames.map((game) => {
    const homeRanking = powerRankings.get(game.home_user_id) ?? { ranking: 0.5, wins: 0, losses: 0 };
    const awayRanking = powerRankings.get(game.away_user_id) ?? { ranking: 0.5, wins: 0, losses: 0 };

    // Matchup competitiveness: how close the teams are in power ranking
    const rankingDiff = Math.abs(homeRanking.ranking - awayRanking.ranking);
    const competitiveness = 1 - Math.min(1, rankingDiff * 2);

    // Strength of schedule boost
    const sosBoost = ((homeRanking.wins + awayRanking.wins) / Math.max(1, weekNumber)) * 0.1;

    // H2H history boost (close historical matches are more interesting)
    const h2hKey = [game.home_user_id, game.away_user_id].sort().join(":");
    const h2h = h2hMap.get(h2hKey);
    const h2hBoost = h2h ? (1 - Math.abs(h2h.pointDifferential ?? 0) / Math.max(1, (h2h.wins + h2h.losses + h2h.ties) * 30)) * 0.15 : 0;

    // Division game bonus
    const isDivisionGame = game.away_team?.division === game.home_team?.division;
    const divisionBonus = isDivisionGame ? 0.2 : 0;

    // Previous GOTW penalty (give others a chance)
    const previousGotwUserFlag = previousUsers.has(game.away_user_id) || previousUsers.has(game.home_user_id);
    const previousGotwPenalty = previousGotwUserFlag ? -0.1 : 0;

    // Calculate overall strength rating (0-100 scale)
    const baseScore = 50;
    const powerScore = (homeRanking.ranking + awayRanking.ranking) / 2 * 30;
    const competitiveScore = competitiveness * 20;
    const totalScore = baseScore + powerScore + competitiveScore + (sosBoost * 10) + (h2hBoost * 5) + (divisionBonus * 10) + (previousGotwPenalty * 10);

    const strengthRating = Math.min(100, Math.max(0, totalScore));

    return {
      league_id: context.league_id,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_id: game.id,
      stage,
      away_team_id: game.away_team_id,
      home_team_id: game.home_team_id,
      away_user_id: game.away_user_id,
      home_user_id: game.home_user_id,
      away_team_name: game.away_team?.name ?? "Away Team",
      home_team_name: game.home_team?.name ?? "Home Team",
      matchup_title: `${game.away_team?.name ?? "Away Team"} vs ${game.home_team?.name ?? "Home Team"}`,
      strength_rating: strengthRating,
      rating_breakdown: {
        powerScore: Number(powerScore.toFixed(1)),
        competitiveness: Number(competitiveness.toFixed(2)),
        divisionGame: isDivisionGame,
        h2hHistory: h2h ? { wins: h2h.wins, losses: h2h.losses, ties: h2h.ties } : null,
        previousGotwUser: previousGotwUserFlag
      },
      previous_gotw_user_flag: previousGotwUserFlag,
      is_selected: false,
      selection_source: "admin_select"
    };
  });

  if (rows.length) {
    const { error } = await supabase.from("rec_game_of_week_candidates").upsert(rows, { onConflict: "league_id,season_number,week_number,game_id" });
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from("rec_game_of_week_candidates")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .order("strength_rating", { ascending: false });

  if (error) throw error;
  return { candidates: data ?? [], league, stage, seasonNumber, weekNumber };
}

function gotwQuestion(stage: string, weekNumber: number) {
  if (stage === "wild_card") return "Who will win their Wild Card matchup?";
  if (stage === "divisional") return "Who will win their Divisional matchup?";
  if (stage === "conference_championship") return "Who will win their Conference Championship matchup?";
  if (stage === "super_bowl") return "Who will win this year's Super Bowl?";
  return `Who will win Week ${weekNumber}'s GOTW?`;
}

export async function selectGotwCandidate(input: { guildId: string; candidateId: string; selectedByDiscordId: string }) {
  const context = await getLeagueContext(input.guildId);
  const { data: candidate, error } = await supabase.from("rec_game_of_week_candidates").select("*").eq("id", input.candidateId).single();
  if (error) throw error;
  await supabase
    .from("rec_game_of_week_candidates")
    .update({ is_selected: false, updated_at: new Date().toISOString() })
    .eq("league_id", candidate.league_id)
    .eq("season_number", candidate.season_number)
    .eq("week_number", candidate.week_number);
  const { data: selected, error: updateError } = await supabase
    .from("rec_game_of_week_candidates")
    .update({ is_selected: true, selected_by_discord_id: input.selectedByDiscordId, selected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", input.candidateId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  const question = gotwQuestion(selected.stage, selected.week_number);
  const { data: poll, error: pollError } = await supabase.from("rec_game_of_week_polls").upsert({
    league_id: selected.league_id,
    season_number: selected.season_number,
    week_number: selected.week_number,
    stage: selected.stage,
    game_id: selected.game_id,
    candidate_id: selected.id,
    question,
    away_team_id: selected.away_team_id,
    home_team_id: selected.home_team_id,
    away_team_name: selected.away_team_name,
    home_team_name: selected.home_team_name,
    status: "open",
    poll_expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    away_user_id: selected.away_user_id,
    home_user_id: selected.home_user_id,
    vote_deadline_display: Object.fromEntries(formatAdvanceTimes(new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()).map((t) => [t.label, t.value])),
    updated_at: new Date().toISOString()
  }, { onConflict: "league_id,season_number,week_number,game_id" }).select("*").single();
  if (pollError) throw pollError;
  const routes = await getRoutes(context.server_id);
  const discordIds = await resolveDiscordIdsByUser([selected.away_user_id, selected.home_user_id]);
  const awayDiscordId = selected.away_user_id ? (discordIds.get(String(selected.away_user_id)) ?? null) : null;
  const homeDiscordId = selected.home_user_id ? (discordIds.get(String(selected.home_user_id)) ?? null) : null;
  return { candidate: selected, poll, routes, channelId: routes?.announcements_channel_id ?? null, awayDiscordId, homeDiscordId };
}

export async function recordGotwPollMessage(input: { pollId: string; discordChannelId: string; discordMessageId?: string | null; discordThreadId?: string | null }) {
  const { data, error } = await supabase.from("rec_game_of_week_polls").update({ discord_channel_id: input.discordChannelId, discord_message_id: input.discordMessageId ?? null, discord_thread_id: input.discordThreadId ?? null, updated_at: new Date().toISOString() }).eq("id", input.pollId).select("*").single();
  if (error) throw error;
  return { poll: data };
}

export async function recordGotwVote(input: { pollId: string; discordId: string; selectedTeamId: string }) {
  const { data: poll, error } = await supabase.from("rec_game_of_week_polls").select("*").eq("id", input.pollId).single();
  if (error) throw error;
  if (poll.status !== "open") return { recorded: false, reason: "Poll is closed.", poll };
  if (poll.poll_expires_at && new Date(poll.poll_expires_at).getTime() < Date.now()) return { recorded: false, reason: "Poll has expired.", poll };
  const selectedTeamName = String(input.selectedTeamId) === String(poll.away_team_id) ? poll.away_team_name : poll.home_team_name;
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const { data: vote, error: voteError } = await supabase.from("rec_game_of_week_votes").upsert({
    poll_id: input.pollId,
    league_id: poll.league_id,
    season_number: poll.season_number,
    week_number: poll.week_number,
    user_id: discord?.user_id ?? null,
    discord_id: input.discordId,
    selected_team_id: input.selectedTeamId,
    selected_team_name: selectedTeamName,
    voted_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: "poll_id,discord_id" }).select("*").single();
  if (voteError) throw voteError;
  const votes = await getGotwVotes(input.pollId);
  return { recorded: true, poll, vote, votes };
}

export async function getGotwVotes(pollId: string) {
  const { data: votes, error } = await supabase.from("rec_game_of_week_votes").select("*").eq("poll_id", pollId).order("voted_at", { ascending: true });
  if (error) throw error;
  return { votes: votes ?? [] };
}


export async function createActiveCheck(input: { guildId: string; createdByDiscordId: string }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const closesAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("rec_active_check_events").insert({
    league_id: context.league_id,
    season_number: seasonNumber,
    week_number: weekNumber,
    status: "open",
    discord_channel_id: routes?.announcements_channel_id ?? null,
    created_by_discord_id: input.createdByDiscordId,
    closes_at: closesAt,
    created_at: nowIso(),
    updated_at: nowIso()
  }).select("*").single();
  if (error) throw error;
  return { event: data, channelId: routes?.announcements_channel_id ?? null, deadlineDisplay: deadlineDisplay(new Date(closesAt)) };
}

export async function recordActiveCheckMessage(input: { eventId: string; discordChannelId: string; discordMessageId: string }) {
  const { data, error } = await supabase.from("rec_active_check_events").update({ discord_channel_id: input.discordChannelId, discord_message_id: input.discordMessageId, updated_at: nowIso() }).eq("id", input.eventId).select("*").single();
  if (error) throw error;
  return { event: data };
}

export async function recordActiveCheckResponse(input: { eventId: string; discordId: string }) {
  const { data: event, error: eventError } = await supabase.from("rec_active_check_events").select("*").eq("id", input.eventId).single();
  if (eventError) throw eventError;
  if (event.status !== "open") return { recorded: false, reason: "Active Check is closed.", event };
  if (event.closes_at && new Date(event.closes_at).getTime() < Date.now()) return { recorded: false, reason: "Active Check has expired.", event };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "Your Discord account is not linked to a REC user profile.", event };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", event.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "You are not linked to an active team in this league.", event };
  const { data: response, error } = await supabase.from("rec_active_check_responses").upsert({
    event_id: input.eventId,
    league_id: event.league_id,
    user_id: discord.user_id,
    discord_id: input.discordId,
    team_id: assignment.team_id,
    responded_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso()
  }, { onConflict: "event_id,user_id" }).select("*").single();
  if (error) throw error;
  return { recorded: true, event, response };
}

export async function getActiveCheckStatus(eventId: string) {
  const { data: event, error } = await supabase.from("rec_active_check_events").select("*").eq("id", eventId).single();
  if (error) throw error;
  const { data: responses, error: responseError } = await supabase.from("rec_active_check_responses").select("*").eq("event_id", eventId).order("responded_at", { ascending: true });
  if (responseError) throw responseError;
  return { event, responses: responses ?? [] };
}

export async function closeActiveCheck(input: { eventId: string }) {
  const { data: event, error } = await supabase.from("rec_active_check_events").select("*").eq("id", input.eventId).single();
  if (error) throw error;
  if (event.status !== "open") return { closed: false, event, missing: [] };
  const { data: linkedUsers, error: linkedError } = await supabase
    .from("rec_team_assignments")
    .select("user_id,team_id,rec_users(display_name),rec_discord_accounts(discord_id)")
    .eq("league_id", event.league_id)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  if (linkedError) throw linkedError;
  const { data: responses, error: responseError } = await supabase.from("rec_active_check_responses").select("user_id").eq("event_id", input.eventId);
  if (responseError) throw responseError;
  const responded = new Set((responses ?? []).map((row: any) => row.user_id));
  const missing = (linkedUsers ?? []).filter((row: any) => !responded.has(row.user_id));
  if (missing.length) {
    await supabase.from("rec_active_check_misses").insert(missing.map((row: any) => ({
      event_id: input.eventId,
      league_id: event.league_id,
      user_id: row.user_id,
      team_id: row.team_id,
      missed_at: nowIso(),
      created_at: nowIso()
    })));
  }
  const { data: updated, error: updateError } = await supabase.from("rec_active_check_events").update({ status: "closed", closed_at: nowIso(), updated_at: nowIso() }).eq("id", input.eventId).select("*").single();
  if (updateError) throw updateError;
  const context = await supabase.from("rec_server_league_links").select("server_id").eq("league_id", event.league_id).maybeSingle();
  const routes = context.data?.server_id ? await getRoutes(context.data.server_id) : null;
  const discordRows = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", missing.map((m: any) => m.user_id));
  const discordByUser = new Map((discordRows.data ?? []).map((row: any) => [row.user_id, row.discord_id]));
  return { closed: true, event: updated, missing: missing.map((row: any) => ({ ...row, discord_id: discordByUser.get(row.user_id) ?? null })), commissionerOfficeChannelId: routes?.commissioner_office_channel_id ?? routes?.admin_import_log_channel_id ?? null };
}

export async function getOpenActiveChecks(guildId: string) {
  const context = await getLeagueContext(guildId);
  const { data, error } = await supabase.from("rec_active_check_events").select("*").eq("league_id", context.league_id).eq("status", "open");
  if (error) throw error;
  return { events: data ?? [] };
}

export async function recordStreamPost(input: { guildId: string; discordId: string; discordChannelId: string; discordMessageId: string; messageUrl?: string | null; content?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  if (!routes?.streams_channel_id || routes.streams_channel_id !== input.discordChannelId) return { recorded: false, reason: "not_streams_channel" };
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "unlinked_user" };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "no_active_team" };
  const content = input.content ?? "";
  const linkMatch = content.match(/https?:\/\/[^\s<>]+/i);
  const hasLegitStreamLink = Boolean(linkMatch && /(twitch\.tv|youtube\.com|youtu\.be|kick\.com|facebook\.com\/gaming|discord\.gg|discord\.com\/channels)/i.test(linkMatch[0]));
  const mentionsDiscordStream = !hasLegitStreamLink && /\bdiscord\b/i.test(content);
  const status = hasLegitStreamLink ? "posted" : mentionsDiscordStream ? "pending_review" : "invalid";
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const row = {
    league_id: context.league_id,
    season_number: seasonNumber,
    week_number: weekNumber,
    user_id: discord.user_id,
    team_id: assignment.team_id,
    discord_channel_id: input.discordChannelId,
    discord_message_id: input.discordMessageId,
    message_url: input.messageUrl ?? linkMatch?.[0] ?? null,
    posted_at: nowIso(),
    status,
    details: { hasLegitStreamLink, mentionsDiscordStream, contentPreview: content.slice(0, 300), detectedUrl: linkMatch?.[0] ?? null },
    created_at: nowIso(),
    updated_at: nowIso()
  };
  const { data, error } = await supabase.from("rec_stream_compliance_logs").insert(row).select("*").single();
  if (error) throw error;
  // Only generate a payout review if: valid Discord stream mention, not offseason, AND first stream this advance week.
  let review = null;
  const payoutBlocked = OFFSEASON_STAGES.has(stage);
  if (mentionsDiscordStream && !payoutBlocked) {
    const { data: existingReview } = await supabase.from("rec_stream_payout_reviews").select("id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).maybeSingle();
    if (!existingReview) {
      const { data: reviewRow, error: reviewError } = await supabase.from("rec_stream_payout_reviews").upsert({
        stream_log_id: data.id,
        league_id: context.league_id,
        user_id: discord.user_id,
        team_id: assignment.team_id,
        season_number: seasonNumber,
        week_number: weekNumber,
        status: "pending",
        amount: 5,
        created_at: nowIso(),
        updated_at: nowIso()
      }, { onConflict: "stream_log_id" }).select("*").single();
      if (reviewError) throw reviewError;
      review = reviewRow;
    }
  }
  return { recorded: true, log: data, review, needsReview: review !== null, invalidStreamPost: status === "invalid", shouldDelete: status === "invalid", pendingEconomyChannelId: routes?.pending_economy_channel_id ?? null };
}

export async function reviewStreamPayout(input: { reviewId: string; action: "approve" | "deny"; reviewedByDiscordId: string; deniedReason?: string | null }) {
  const { data: review, error } = await supabase.from("rec_stream_payout_reviews").select("*").eq("id", input.reviewId).single();
  if (error) throw error;
  if (review.status !== "pending") return { updated: false, reason: "Review is not pending.", review };
  if (input.action === "deny") {
    const { data, error: updateError } = await supabase.from("rec_stream_payout_reviews").update({ status: "denied", reviewed_by_discord_id: input.reviewedByDiscordId, denied_reason: input.deniedReason ?? null, reviewed_at: nowIso(), updated_at: nowIso() }).eq("id", input.reviewId).select("*").single();
    if (updateError) throw updateError;
    return { updated: true, review: data };
  }
  const { data: ledger, error: ledgerError } = await supabase.from("rec_dollar_ledger").insert({
    user_id: review.user_id,
    league_id: review.league_id,
    amount: review.amount,
    transaction_type: "credit",
    description: `Approved stream payout - Week ${review.week_number}`,
    source: "system_award",
    source_reference: { type: "stream_payout_review", reviewId: review.id, streamLogId: review.stream_log_id },
    created_at: nowIso()
  }).select("id").single();
  if (ledgerError) throw ledgerError;
  const { data, error: updateError } = await supabase.from("rec_stream_payout_reviews").update({ status: "issued", reviewed_by_discord_id: input.reviewedByDiscordId, reviewed_at: nowIso(), issued_at: nowIso(), issued_ledger_id: ledger?.id ?? null, updated_at: nowIso() }).eq("id", input.reviewId).select("*").single();
  if (updateError) throw updateError;
  const { data: streamLog } = await supabase
    .from("rec_stream_compliance_logs")
    .select("discord_channel_id, discord_message_id")
    .eq("id", review.stream_log_id)
    .maybeSingle();
  return { updated: true, review: data, ledger, streamLog };
}

export async function settleGotwVotes(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const currentWeek = league.current_week ?? 1;
  const { data: polls, error } = await supabase
    .from("rec_game_of_week_polls")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .lt("week_number", currentWeek)
    .in("status", ["open", "closed"]);
  if (error) throw error;
  const settled: any[] = [];
  for (const poll of polls ?? []) {
    const { data: game } = await supabase.from("rec_game_results").select("*").eq("league_id", poll.league_id).eq("season_number", poll.season_number).eq("week_number", poll.week_number).or(`external_game_id.eq.${poll.game_id},id.eq.${poll.game_id}`).maybeSingle();
    const winningTeamId = game?.winning_team_id ?? (asNumber(game?.home_score) > asNumber(game?.away_score) ? game?.home_team_id : asNumber(game?.away_score) > asNumber(game?.home_score) ? game?.away_team_id : null);
    if (!winningTeamId) continue;
    const { data: votes } = await supabase.from("rec_game_of_week_votes").select("*").eq("poll_id", poll.id);
    for (const vote of votes ?? []) {
      const isCorrect = String(vote.selected_team_id) === String(winningTeamId);
      let ledgerId = vote.paid_ledger_id;
      if (isCorrect && vote.user_id && !vote.paid_ledger_id) {
        const { data: ledger } = await supabase.from("rec_dollar_ledger").insert({
          user_id: vote.user_id,
          league_id: poll.league_id,
          amount: 10,
          transaction_type: "credit",
          description: `Correct GOTW pick - Week ${poll.week_number}`,
          source: "system_award",
          source_reference: { type: "gotw_correct_guess", pollId: poll.id, voteId: vote.id },
          created_at: nowIso()
        }).select("id").single();
        ledgerId = ledger?.id ?? null;
      }
      await supabase.from("rec_game_of_week_votes").update({ is_correct: isCorrect, payout_amount: isCorrect ? 10 : 0, paid_ledger_id: ledgerId ?? null, settled_at: nowIso(), updated_at: nowIso() }).eq("id", vote.id);
      if (vote.user_id) {
        const { data: existing } = await supabase.from("rec_global_gotw_guessing_records").select("*").eq("user_id", vote.user_id).maybeSingle();
        const patch = {
          user_id: vote.user_id,
          correct_guesses: asNumber(existing?.correct_guesses) + (isCorrect ? 1 : 0),
          wrong_guesses: asNumber(existing?.wrong_guesses) + (isCorrect ? 0 : 1),
          last_result_at: nowIso(),
          updated_at: nowIso()
        };
        if (existing) await supabase.from("rec_global_gotw_guessing_records").update(patch).eq("user_id", vote.user_id);
        else await supabase.from("rec_global_gotw_guessing_records").insert({ ...patch, created_at: nowIso() });
      }
    }
    await supabase.from("rec_game_of_week_polls").update({ status: "settled", winning_team_id: winningTeamId, settled_at: nowIso(), updated_at: nowIso() }).eq("id", poll.id);
    settled.push({ pollId: poll.id, winningTeamId, votes: votes?.length ?? 0 });
  }
  return { settled };
}

// ── Wizard-friendly split advance steps ─────────────────────────────────────

function makeStepRunner() {
  const warnings: string[] = [];
  const completed: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); completed.push(name); }
    catch (error) {
      console.error(`[ADVANCE] step "${name}" failed:`, error);
      warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return { step, warnings, completed };
}

export async function processAdvanceResults(guildId: string) {
  const { step, warnings, completed } = makeStepRunner();
  let week: { previousWeek: number; weekNumber: number; previousStage: string; seasonStage: string; transitionBadgesEarned?: any[]; transitionBadgesRemoved?: any[] } | null = null;
  await step("advance_week", async () => { week = await advanceLeagueWeek(guildId); });
  await step("apply_records", () => applyAdvanceRecords(guildId));
  await step("game_payouts", () => issueWeeklyGamePayouts(guildId));
  await step("savings_interest", () => applyAdvanceSavingsInterest(guildId));
  await step("settle_gotw", () => settleGotwVotes(guildId));
  await step("evaluate_challenges", () => evaluateWeeklyChallenges(guildId));
  await step("stream_compliance", () => evaluateStreamCompliance(guildId));

  // Resolve discord IDs for any transition badges (season-end or playoff badges)
  const weekAny = week as any;
  const allTransitionEarned: any[] = weekAny?.transitionBadgesEarned ?? [];
  const allTransitionRemoved: any[] = weekAny?.transitionBadgesRemoved ?? [];
  const transitionUserIds = [...allTransitionEarned, ...allTransitionRemoved].map((b) => b.user_id);
  const transitionDiscordMap = transitionUserIds.length > 0 ? await resolveDiscordIdsByUser(transitionUserIds) : new Map<string, string>();

  const context = await getLeagueContext(guildId).catch(() => null);
  const routes = context ? await getRoutes(context.server_id).catch(() => null) : null;

  const transitionBadgeAnnouncements = {
    earned: allTransitionEarned.map((b) => ({
      userId: b.user_id,
      discordId: transitionDiscordMap.get(String(b.user_id)) ?? null,
      badgeName: b.badge_name,
      badgeLabel: b.badge_label,
      qualifier: BADGE_QUALIFIERS[b.badge_name] ?? "earning this badge"
    })),
    lost: allTransitionRemoved.map((b) => ({
      userId: b.user_id,
      discordId: transitionDiscordMap.get(String(b.user_id)) ?? null,
      badgeName: b.badge_name,
      badgeLabel: b.badge_label,
      reason: "their record was broken"
    })),
    announcementsChannelId: routes?.announcements_channel_id ?? null
  };

  // EOS award polls: create when regular season ends, lock when playoffs advance
  let eosPollsData: any = null;
  const prevStage = weekAny?.previousStage ?? "";
  const newStage = weekAny?.seasonStage ?? "";

  if (prevStage === "regular_season" && newStage === "wild_card" && context) {
    try {
      const { createEosAwardPolls } = await import("../eos-awards/eos-awards.service.js");
      const seasonNumber = context.rec_leagues?.season_number ?? context.rec_leagues?.display_season_number ?? 1;
      eosPollsData = await createEosAwardPolls(context.league_id, seasonNumber);
      eosPollsData.announcementsChannelId = routes?.announcements_channel_id ?? null;
    } catch (err) {
      console.error("[processAdvanceResults] EOS poll creation failed:", err);
    }
  }

  let eosLockData: any = null;
  if (prevStage === "wild_card" && newStage === "divisional" && context) {
    try {
      const { lockEosAwardPolls } = await import("../eos-awards/eos-awards.service.js");
      const seasonNumber = context.rec_leagues?.season_number ?? context.rec_leagues?.display_season_number ?? 1;
      eosLockData = await lockEosAwardPolls(context.league_id, seasonNumber);
      if (eosLockData?.commissionerTiebreakers?.length) {
        eosLockData.pendingPayoutsChannelId = routes?.pending_payouts_channel_id ?? null;
      }
    } catch (err) {
      console.error("[processAdvanceResults] EOS poll lock failed:", err);
    }
  }

  // Nomination DMs: send after regular-season advances only. NOT on the week 18→wild_card transition.
  let nominationData: any = null;
  const isRegularSeasonAdvance = prevStage === "regular_season" && newStage === "regular_season";
  if (isRegularSeasonAdvance && context) {
    try {
      nominationData = await getNominationData(guildId);
      nominationData.sendNominationDms = true;
    } catch (err) {
      console.error("[processAdvanceResults] getNominationData failed:", err);
    }
  }

  return { week, completed, warnings, transitionBadgeAnnouncements, eosPollsData, eosLockData, nominationData };
}

export async function processPotwAward(guildId: string) {
  const { step, warnings, completed } = makeStepRunner();
  let awards: any[] = [];
  let weeklyBadgesEarned: any[] = [];
  let weeklyBadgesRemoved: any[] = [];
  await step("calculate_potw", async () => { const r = await calculateRecPotw(guildId); awards = r.awards ?? []; });
  await step("potw_payouts", () => issueRecPotwPayouts(guildId));
  await step("assign_badges", async () => {
    const r = await assignWeeklyBadges(guildId);
    weeklyBadgesEarned = r.earned ?? [];
    weeklyBadgesRemoved = r.removed ?? [];
  });
  const context = await getLeagueContext(guildId).catch(() => null);
  const routes = context ? await getRoutes(context.server_id).catch(() => null) : null;

  const allBadgeUserIds = [...weeklyBadgesEarned, ...weeklyBadgesRemoved].map((b) => b.user_id);
  const badgeDiscordMap = allBadgeUserIds.length > 0 ? await resolveDiscordIdsByUser(allBadgeUserIds) : new Map<string, string>();

  const discordIds = await resolveDiscordIdsByUser(awards.map((a: any) => a.user_id));
  const announcementAwards = awards.map((award: any) => ({
    ...award,
    discordId: award.user_id ? discordIds.get(String(award.user_id)) ?? null : null
  }));

  const weeklyBadgeAnnouncements = {
    earned: weeklyBadgesEarned.map((b) => ({
      userId: b.user_id,
      discordId: badgeDiscordMap.get(String(b.user_id)) ?? null,
      badgeName: b.badge_name,
      badgeLabel: b.badge_label,
      qualifier: BADGE_QUALIFIERS[b.badge_name] ?? "earning this badge"
    })),
    lost: weeklyBadgesRemoved.map((b) => ({
      userId: b.user_id,
      discordId: badgeDiscordMap.get(String(b.user_id)) ?? null,
      badgeName: b.badge_name,
      badgeLabel: b.badge_label,
      reason: "their record was broken"
    }))
  };

  return { awards: announcementAwards, announcementsChannelId: routes?.announcements_channel_id ?? null, completed, warnings, weeklyBadgeAnnouncements };
}

export async function finalizeAdvanceStep(guildId: string) {
  const { step, warnings, completed } = makeStepRunner();
  await step("generate_challenges", () => generateWeeklyChallenges({ guildId, regenerate: false }));
  let devUpgradePrizes: any = null;
  await step("dev_upgrade_prizes", async () => { devUpgradePrizes = await processDevUpgradePrizes(guildId); });
  return { completed, warnings, devUpgradePrizes };
}

// Creates GOTW polls for every H2H game in the current playoff week (wildcard/divisional/etc).
// In playoffs every matchup is a GOTW — this auto-creates candidates + polls for all of them.
export async function processPlayoffGotw(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const stage = String(league.season_stage ?? "wild_card");
  const routes = await getRoutes(context.server_id);
  const games = await getWeekGames(context.league_id, seasonNumber, weekNumber);
  const h2hGames = games.filter((g) => g.home_user_id && g.away_user_id);
  const question = gotwQuestion(stage, weekNumber);
  const discordIds = await resolveDiscordIdsByUser(h2hGames.flatMap((g) => [g.home_user_id, g.away_user_id]));

  const polls: any[] = [];
  for (const game of h2hGames) {
    // Upsert candidate as selected
    const candidateRow = {
      league_id: context.league_id,
      season_number: seasonNumber,
      week_number: weekNumber,
      game_id: game.id,
      stage,
      away_team_id: game.away_team_id,
      home_team_id: game.home_team_id,
      away_user_id: game.away_user_id,
      home_user_id: game.home_user_id,
      away_team_name: game.away_team?.name ?? "Away Team",
      home_team_name: game.home_team?.name ?? "Home Team",
      matchup_title: `${game.away_team?.name ?? "Away"} vs ${game.home_team?.name ?? "Home"}`,
      strength_rating: 100,
      is_selected: true,
      selection_source: "playoff_auto",
      updated_at: new Date().toISOString()
    };
    await supabase.from("rec_game_of_week_candidates").upsert(candidateRow, { onConflict: "league_id,season_number,week_number,game_id" });

    const { data: poll } = await supabase.from("rec_game_of_week_polls").upsert({
      league_id: context.league_id,
      season_number: seasonNumber,
      week_number: weekNumber,
      stage,
      game_id: game.id,
      question,
      away_team_id: game.away_team_id,
      home_team_id: game.home_team_id,
      away_team_name: game.away_team?.name ?? "Away Team",
      home_team_name: game.home_team?.name ?? "Home Team",
      away_user_id: game.away_user_id,
      home_user_id: game.home_user_id,
      status: "open",
      poll_expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      vote_deadline_display: Object.fromEntries(formatAdvanceTimes(new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()).map((t) => [t.label, t.value])),
      updated_at: new Date().toISOString()
    }, { onConflict: "league_id,season_number,week_number,game_id" }).select("*").single();

    if (poll) {
      polls.push({
        ...poll,
        awayDiscordId: game.away_user_id ? discordIds.get(String(game.away_user_id)) ?? null : null,
        homeDiscordId: game.home_user_id ? discordIds.get(String(game.home_user_id)) ?? null : null
      });
    }
  }

  return { polls, channelId: routes?.announcements_channel_id ?? null };
}

// EOS payout preview: calculates projected end-of-season payouts from season standings without issuing.
// Triggers at regular_season → wildcard transition. Top finishers by record get tiered bonuses.
export async function previewEosPayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const { data: records, error } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,losses,ties,point_differential,games_played")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .order("wins", { ascending: false });
  if (error) throw error;

  const sorted = [...(records ?? [])].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (b.point_differential ?? 0) - (a.point_differential ?? 0);
  });

  const discordIds = await resolveDiscordIdsByUser(sorted.map((r) => r.user_id));

  // EOS payout tiers (configurable defaults)
  const EOS_TIERS = [
    { rank: 1, label: "Regular Season Champion", amount: 250 },
    { rank: 2, label: "2nd Place", amount: 175 },
    { rank: 3, label: "3rd Place", amount: 125 },
    { rank: 4, label: "4th Place", amount: 100 },
    { rank: 5, label: "5th Place", amount: 75 },
    { rank: 6, label: "6th Place", amount: 75 },
    { rank: 7, label: "7th Place", amount: 50 },
    { rank: 8, label: "8th Place", amount: 50 }
  ];

  const items = sorted.map((record, idx) => {
    const rank = idx + 1;
    const tier = EOS_TIERS.find((t) => t.rank === rank);
    return {
      rank,
      userId: record.user_id,
      discordId: discordIds.get(String(record.user_id)) ?? null,
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0,
      pointDifferential: record.point_differential ?? 0,
      projectedPayout: tier?.amount ?? 0,
      payoutLabel: tier?.label ?? `Rank ${rank}`
    };
  });

  return { seasonNumber, weekNumber: league.current_week, items, totalPayout: items.reduce((sum, i) => sum + i.projectedPayout, 0) };
}

const EOS_PAYOUT_TIERS = [
  { rank: 1, label: "Regular Season Champion", amount: 250 },
  { rank: 2, label: "2nd Place", amount: 175 },
  { rank: 3, label: "3rd Place", amount: 125 },
  { rank: 4, label: "4th Place", amount: 100 },
  { rank: 5, label: "5th Place", amount: 75 },
  { rank: 6, label: "6th Place", amount: 75 },
  { rank: 7, label: "7th Place", amount: 50 },
  { rank: 8, label: "8th Place", amount: 50 }
];

export async function issueEosPayouts(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  // Clear any existing non-cleared batch first
  await clearPendingEosBatch({ guildId, clearReason: "Superseded by new issuance" }).catch(() => undefined);

  // Build standings
  const { data: records } = await supabase
    .from("rec_season_user_records")
    .select("user_id,wins,losses,ties,point_differential,games_played")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .order("wins", { ascending: false });

  const sorted = [...(records ?? [])].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return (b.point_differential ?? 0) - (a.point_differential ?? 0);
  });

  const { data: batch, error: batchError } = await supabase
    .from("rec_eos_payout_batches")
    .insert({ league_id: leagueId, season_number: seasonNumber, batch_type: "eos_regular_season", status: "posted", posted_at: nowIso() })
    .select("*")
    .single();
  if (batchError) throw batchError;

  const discordIds = await resolveDiscordIdsByUser(sorted.map((r) => r.user_id));
  const { data: routes } = await supabase.from("rec_server_routes").select("*").eq("server_id", context.server_id).maybeSingle() as any;
  const serverName = league.name ?? "REC League";

  const items: any[] = [];
  for (let idx = 0; idx < sorted.length; idx++) {
    const record = sorted[idx];
    const rank = idx + 1;
    const tier = EOS_PAYOUT_TIERS.find((t) => t.rank === rank);
    if (!tier || !record.user_id) continue;

    const payoutKey = `eos_${seasonNumber}_rank_${rank}_${record.user_id}`;
    const { data: item } = await supabase
      .from("rec_eos_payout_items")
      .insert({
        batch_id: batch.id,
        league_id: leagueId,
        user_id: record.user_id,
        season_number: seasonNumber,
        payout_category: "eos_regular_season",
        payout_key: payoutKey,
        payout_label: tier.label,
        amount: tier.amount,
        status: "pending",
        metadata: { rank, wins: record.wins, losses: record.losses, ties: record.ties }
      })
      .select("*")
      .single();

    if (item) {
      items.push({
        ...item,
        rank,
        discordId: discordIds.get(String(record.user_id)) ?? null,
        wins: record.wins ?? 0,
        losses: record.losses ?? 0,
        ties: record.ties ?? 0
      });
    }
  }

  return {
    batchId: batch.id,
    items,
    seasonNumber,
    serverName,
    announcementsChannelId: routes?.announcements_channel_id ?? null
  };
}

export async function approveEosPayoutItem(input: { itemId: string; discordId: string; role: "user" | "commissioner" }) {
  const { data: item, error } = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("id", input.itemId)
    .maybeSingle();
  if (error || !item) throw new Error("Payout item not found.");
  if (item.status === "issued") return { credited: false, reason: "already_issued", newBalance: null };
  if (item.status === "denied") return { credited: false, reason: "already_denied", newBalance: null };

  const { data: discordRow } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const actorUserId = discordRow?.user_id ?? null;

  const patch: Record<string, any> = { updated_at: nowIso() };

  if (input.role === "user") {
    // Recipient must match the item's user
    if (actorUserId && String(actorUserId) !== String(item.user_id)) {
      return { credited: false, reason: "not_recipient", newBalance: null };
    }
    patch.user_approved_at = nowIso();
  } else {
    // Commissioner approval
    patch.approved_by_user_id = actorUserId ?? null;
    patch.approved_at = nowIso();
    patch.commissioner_user_id = actorUserId ?? null;
    patch.status = "approved";
  }

  await supabase.from("rec_eos_payout_items").update(patch).eq("id", input.itemId);

  // Re-fetch to check if both approvals are present
  const { data: updated } = await supabase.from("rec_eos_payout_items").select("*").eq("id", input.itemId).maybeSingle();
  if (!updated) throw new Error("Failed to fetch updated item.");

  const userApproved = Boolean(updated.user_approved_at);
  const commApproved = Boolean(updated.approved_at);

  if (userApproved && commApproved && updated.status !== "issued") {
    // Both approved — credit wallet
    const { data: batch } = await supabase.from("rec_eos_payout_batches").select("*").eq("id", updated.batch_id).maybeSingle();
    const credit = await creditUserWallet({
      userId: String(updated.user_id),
      leagueId: String(updated.league_id),
      seasonNumber: asNumber(updated.season_number),
      amount: asNumber(updated.amount),
      transactionType: "eos_payout",
      description: `${updated.payout_label} — Season ${updated.season_number} EOS Payout`,
      sourceReference: { itemId: updated.id, batchId: updated.batch_id, idempotencyKey: `eos_payout_${updated.id}` }
    });
    await supabase.from("rec_eos_payout_items").update({
      status: "issued",
      issued_ledger_id: credit.ledger?.id ?? null,
      issued_at: nowIso(),
      updated_at: nowIso()
    }).eq("id", input.itemId);

    // Update batch status if all items issued
    const { data: batchItems } = await supabase.from("rec_eos_payout_items").select("status").eq("batch_id", updated.batch_id);
    const allIssued = (batchItems ?? []).every((i: any) => ["issued", "denied", "voided"].includes(i.status));
    if (allIssued && batch) {
      await supabase.from("rec_eos_payout_batches").update({ status: "issued", issued_at: nowIso(), updated_at: nowIso() }).eq("id", batch.id);
    }

    return { credited: true, amount: asNumber(updated.amount), newBalance: credit.wallet, payoutLabel: updated.payout_label };
  }

  return { credited: false, reason: input.role === "user" ? "awaiting_commissioner" : "awaiting_user", newBalance: null };
}

export async function rejectEosPayoutItem(input: { itemId: string; discordId: string }) {
  const { data: discordRow } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  const actorUserId = discordRow?.user_id ?? null;

  const { data: item } = await supabase.from("rec_eos_payout_items").select("*").eq("id", input.itemId).maybeSingle();
  if (!item) throw new Error("Payout item not found.");
  if (["issued", "denied", "voided"].includes(item.status)) return { rejected: false, reason: "already_resolved" };

  await supabase.from("rec_eos_payout_items").update({
    status: "denied",
    denied_by_user_id: actorUserId ?? null,
    denied_at: nowIso(),
    updated_at: nowIso()
  }).eq("id", input.itemId);

  return { rejected: true, payoutLabel: item.payout_label, amount: asNumber(item.amount) };
}

export async function getEosBatchItems(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;

  const { data: batch } = await supabase
    .from("rec_eos_payout_batches")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .in("status", ["posted", "partially_approved", "approved", "issued"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!batch) return { batch: null, items: [] };

  const { data: items } = await supabase
    .from("rec_eos_payout_items")
    .select("*")
    .eq("batch_id", batch.id)
    .order("created_at");

  const userIds = (items ?? []).map((i: any) => i.user_id).filter(Boolean);
  const discordMap = userIds.length > 0 ? await resolveDiscordIdsByUser(userIds) : new Map<string, string>();

  return {
    batch,
    items: (items ?? []).map((i: any) => ({
      ...i,
      discordId: discordMap.get(String(i.user_id)) ?? null
    }))
  };
}

// ─── Power Rankings ────────────────────────────────────────────────────────────

const OFFENSE_POSITIONS = new Set(["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"]);
const DEFENSE_POSITIONS = new Set(["LE", "RE", "DT", "NT", "MLB", "LOLB", "ROLB", "CB", "FS", "SS"]);

function recentFormScore(userGames: Array<{ score: number; oppScore: number }>): number {
  // Last 3 games, most-recent weighted 3×, middle 2×, oldest 1×
  const last3 = userGames.slice(0, 3);
  const weights = [3, 2, 1];
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < last3.length; i++) {
    const { score, oppScore } = last3[i];
    const margin = score - oppScore;
    const gameScore = margin >= 14 ? 1.0 : margin >= 7 ? 0.85 : margin > 0 ? 0.70
      : margin === 0 ? 0.50 : margin >= -6 ? 0.30 : margin >= -13 ? 0.15 : 0.0;
    weightedSum += gameScore * weights[i];
    totalWeight += weights[i];
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
}

interface OvrAccum { sum: number; count: number }
function ovrAvg(a: OvrAccum) { return a.count > 0 ? a.sum / a.count : 0; }

export async function calculateAndStorePowerRankings(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = asNumber(league.season_number ?? league.display_season_number ?? 1);
  // Rankings are "as of" the week just completed (after advance, current_week is the NEW week)
  const completedWeek = Math.max(1, asNumber(league.current_week ?? 1) - 1);
  const newWeek = asNumber(league.current_week ?? 1);

  // ── 1. All teams in this league ─────────────────────────────────────────────
  const { data: teams, error: teamErr } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,conference,division")
    .eq("league_id", leagueId);
  if (teamErr) throw teamErr;
  if (!teams?.length) return { rankings: [], leagueName: league.name ?? "League", completedWeek, newWeek };

  // ── 2. All completed regular-season game results up through completed week ───
  const { data: allGames } = await supabase
    .from("rec_game_results")
    .select("id,home_team_id,away_team_id,home_user_id,away_user_id,home_score,away_score,week_number")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", completedWeek)
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .order("week_number", { ascending: false });

  const games = allGames ?? [];

  // Build per-team game list { score, oppScore, oppTeamId, weekNumber }
  const teamGames = new Map<string, Array<{ score: number; oppScore: number; oppTeamId: string; weekNumber: number }>>();
  for (const g of games) {
    const homeId = String(g.home_team_id ?? "");
    const awayId = String(g.away_team_id ?? "");
    const home = asNumber(g.home_score);
    const away = asNumber(g.away_score);
    if (homeId) {
      if (!teamGames.has(homeId)) teamGames.set(homeId, []);
      teamGames.get(homeId)!.push({ score: home, oppScore: away, oppTeamId: awayId, weekNumber: asNumber(g.week_number) });
    }
    if (awayId) {
      if (!teamGames.has(awayId)) teamGames.set(awayId, []);
      teamGames.get(awayId)!.push({ score: away, oppScore: home, oppTeamId: homeId, weekNumber: asNumber(g.week_number) });
    }
  }

  // ── 3. Player OVR aggregated by team ─────────────────────────────────────────
  // Join rec_player_weekly_stats → rec_players to get overallRating per player/team
  const { data: playerStatRows } = await supabase
    .from("rec_player_weekly_stats")
    .select("team_id, player_id, position, rec_players(raw_payload)")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .not("player_id", "is", null)
    .not("team_id", "is", null);

  // Dedupe by (team_id, player_id) — a player contributes one OVR reading per team
  const seenPlayerTeam = new Set<string>();
  const teamOvrMap = new Map<string, { all: OvrAccum; offense: OvrAccum; defense: OvrAccum }>();
  for (const row of playerStatRows ?? []) {
    const tid = String(row.team_id);
    const pid = String(row.player_id);
    const key = `${tid}:${pid}`;
    if (seenPlayerTeam.has(key)) continue;
    seenPlayerTeam.add(key);
    const ovr = asNumber((row as any).rec_players?.raw_payload?.overallRating);
    if (!ovr) continue;
    if (!teamOvrMap.has(tid)) teamOvrMap.set(tid, { all: { sum: 0, count: 0 }, offense: { sum: 0, count: 0 }, defense: { sum: 0, count: 0 } });
    const entry = teamOvrMap.get(tid)!;
    entry.all.sum += ovr; entry.all.count++;
    const pos = String(row.position ?? "").toUpperCase();
    if (OFFENSE_POSITIONS.has(pos)) { entry.offense.sum += ovr; entry.offense.count++; }
    if (DEFENSE_POSITIONS.has(pos)) { entry.defense.sum += ovr; entry.defense.count++; }
  }

  // ── 4. Stat leaders per team (best player by season composite score) ─────────
  // Accumulate season stats per (team_id, player_id)
  interface PlayerAccum {
    playerName: string; position: string;
    passYds: number; passTDs: number; passInts: number;
    rushYds: number; rushTDs: number;
    recYds: number; recTDs: number;
    defSacks: number; defInts: number; defTackles: number;
    weeks: number;
  }
  const playerAccumMap = new Map<string, PlayerAccum>();

  const { data: allPlayerStats } = await supabase
    .from("rec_player_weekly_stats")
    .select("team_id, player_id, position, stats, rec_players(full_name)")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .lte("week_number", completedWeek)
    .not("player_id", "is", null)
    .not("team_id", "is", null);

  for (const row of allPlayerStats ?? []) {
    const tid = String(row.team_id);
    const pid = String(row.player_id);
    const mapKey = `${tid}:${pid}`;
    const s = (row.stats ?? {}) as Record<string, any>;
    if (!playerAccumMap.has(mapKey)) {
      playerAccumMap.set(mapKey, {
        playerName: (row as any).rec_players?.full_name ?? "Unknown",
        position: String(row.position ?? "?").toUpperCase(),
        passYds: 0, passTDs: 0, passInts: 0,
        rushYds: 0, rushTDs: 0,
        recYds: 0, recTDs: 0,
        defSacks: 0, defInts: 0, defTackles: 0,
        weeks: 0
      });
    }
    const acc = playerAccumMap.get(mapKey)!;
    acc.passYds += asNumber(s.passYds); acc.passTDs += asNumber(s.passTDs); acc.passInts += asNumber(s.passInts);
    acc.rushYds += asNumber(s.rushYds); acc.rushTDs += asNumber(s.rushTDs);
    acc.recYds += asNumber(s.recYds); acc.recTDs += asNumber(s.recTDs);
    acc.defSacks += asNumber(s.defSacks); acc.defInts += asNumber(s.defInts);
    acc.defTackles += asNumber(s.defTackles ?? s.tackles);
    acc.weeks++;
  }

  // Score each player; find best per team
  function playerCompositeScore(acc: PlayerAccum): number {
    return acc.passYds * 0.04 + acc.passTDs * 4 - acc.passInts * 2
      + acc.rushYds * 0.06 + acc.rushTDs * 4
      + acc.recYds * 0.05 + acc.recTDs * 4
      + acc.defSacks * 7 + acc.defInts * 8 + acc.defTackles * 0.3;
  }
  function statLine(acc: PlayerAccum): string {
    const pos = acc.position;
    if (["QB"].includes(pos)) return `${acc.passYds.toLocaleString()} pass yds, ${acc.passTDs} TDs`;
    if (["HB", "FB"].includes(pos)) return `${acc.rushYds.toLocaleString()} rush yds, ${acc.rushTDs} TDs`;
    if (["WR", "TE"].includes(pos)) return `${acc.recYds.toLocaleString()} rec yds, ${acc.recTDs} TDs`;
    if (DEFENSE_POSITIONS.has(pos)) {
      const parts = [];
      if (acc.defSacks > 0) parts.push(`${acc.defSacks} sacks`);
      if (acc.defInts > 0) parts.push(`${acc.defInts} INTs`);
      if (acc.defTackles > 0) parts.push(`${acc.defTackles} tackles`);
      return parts.join(", ") || "—";
    }
    return `${acc.rushYds > acc.passYds ? acc.rushYds.toLocaleString() + " rush yds" : acc.passYds.toLocaleString() + " pass yds"}`;
  }

  // Best player per team_id
  const teamStatLeader = new Map<string, { name: string; pos: string; line: string; score: number }>();
  for (const [mapKey, acc] of playerAccumMap) {
    const tid = mapKey.split(":")[0];
    const score = playerCompositeScore(acc);
    const existing = teamStatLeader.get(tid);
    if (!existing || score > existing.score) {
      teamStatLeader.set(tid, { name: acc.playerName, pos: acc.position, line: statLine(acc), score });
    }
  }

  // ── 5. Previous rankings (for movement arrows) ───────────────────────────────
  const { data: prevRanks } = await supabase
    .from("rec_power_rankings")
    .select("team_id,rank")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek - 1);
  const prevRankByTeam = new Map((prevRanks ?? []).map((r: any) => [String(r.team_id), asNumber(r.rank)]));

  // ── 6. Compute score for each team ───────────────────────────────────────────
  // First pass: per-team stats for SOS (needs all win rates pre-computed)
  interface TeamStats {
    teamId: string; wins: number; losses: number; ties: number;
    played: number; pd: number; winPct: number;
  }
  const teamStats = new Map<string, TeamStats>();
  for (const team of teams) {
    const tid = String(team.id);
    const tGames = teamGames.get(tid) ?? [];
    let wins = 0, losses = 0, ties = 0, pd = 0;
    for (const g of tGames) {
      if (g.score > g.oppScore) wins++;
      else if (g.score < g.oppScore) losses++;
      else ties++;
      pd += g.score - g.oppScore;
    }
    const played = wins + losses + ties;
    teamStats.set(tid, { teamId: tid, wins, losses, ties, played, pd, winPct: played > 0 ? wins / played : 0 });
  }

  // League avg OVR for normalizing matchup advantage
  let leagueOffenseOvrSum = 0, leagueOffenseOvrCount = 0;
  let leagueDefenseOvrSum = 0, leagueDefenseOvrCount = 0;
  for (const [, entry] of teamOvrMap) {
    const offOvr = ovrAvg(entry.offense);
    const defOvr = ovrAvg(entry.defense);
    if (offOvr > 0) { leagueOffenseOvrSum += offOvr; leagueOffenseOvrCount++; }
    if (defOvr > 0) { leagueDefenseOvrSum += defOvr; leagueDefenseOvrCount++; }
  }
  const leagueAvgOffenseOvr = leagueOffenseOvrCount > 0 ? leagueOffenseOvrSum / leagueOffenseOvrCount : 75;
  const leagueAvgDefenseOvr = leagueDefenseOvrCount > 0 ? leagueDefenseOvrSum / leagueDefenseOvrCount : 75;

  // Second pass: compute full score
  interface RankEntry {
    teamId: string; teamName: string; abbreviation: string;
    wins: number; losses: number; ties: number; played: number; pd: number;
    winPct: number; avgPd: number; sosScore: number; recentForm: number;
    teamOvrScore: number; offenseOvr: number | null; defenseOvr: number | null;
    score: number;
    statLeaderName: string | null; statLeaderPos: string | null; statLeaderLine: string | null;
  }
  const rankEntries: RankEntry[] = [];

  for (const team of teams) {
    const tid = String(team.id);
    const ts = teamStats.get(tid) ?? { teamId: tid, wins: 0, losses: 0, ties: 0, played: 0, pd: 0, winPct: 0 };
    const tGames = teamGames.get(tid) ?? [];

    // Win %
    const winPct = ts.winPct;

    // Avg PD (normalized to 0-1 range with ±40 spread)
    const avgPd = ts.played > 0 ? ts.pd / ts.played : 0;
    const normPd = (Math.max(-40, Math.min(40, avgPd)) / 40 + 1) / 2;

    // Recent form: last 3 completed games (already sorted desc by week_number)
    const recentForm = recentFormScore(tGames.slice(0, 3));

    // SOS: average win% of opponents faced (only teams with played > 0)
    const opponentWinPcts: number[] = [];
    for (const g of tGames) {
      const oppStats = teamStats.get(g.oppTeamId);
      if (oppStats && oppStats.played > 0) opponentWinPcts.push(oppStats.winPct);
    }
    const sosScore = opponentWinPcts.length > 0
      ? opponentWinPcts.reduce((a, b) => a + b, 0) / opponentWinPcts.length
      : 0.5;

    // OVR component: normalize from typical Madden range (60-99)
    const ovrEntry = teamOvrMap.get(tid);
    const allOvr = ovrEntry ? ovrAvg(ovrEntry.all) : 0;
    const offOvr = ovrEntry ? ovrAvg(ovrEntry.offense) : 0;
    const defOvr = ovrEntry ? ovrAvg(ovrEntry.defense) : 0;

    let teamOvrScore = 0;
    if (allOvr > 0) {
      // Normalize: league avg Madden OVR is ~79; normalize so 99=1.0 and 60=0.0
      const normOvr = (allOvr - 60) / 39;
      // Matchup advantage: (offense OVR advantage over avg defense) + (defense advantage over avg offense)
      const offAdv = offOvr > 0 ? (offOvr - leagueAvgDefenseOvr) / 20 : 0;
      const defAdv = defOvr > 0 ? (defOvr - leagueAvgOffenseOvr) / 20 : 0;
      teamOvrScore = Math.max(0, Math.min(1, normOvr * 0.5 + (offAdv + defAdv) * 0.25 + 0.5));
    }

    // Final score (weights sum to 1.0)
    const score = winPct * 0.35 + normPd * 0.25 + recentForm * 0.15 + sosScore * 0.10 + teamOvrScore * 0.15;

    const leader = teamStatLeader.get(tid);
    rankEntries.push({
      teamId: tid,
      teamName: team.name ?? "Unknown",
      abbreviation: team.abbreviation ?? "???",
      wins: ts.wins, losses: ts.losses, ties: ts.ties, played: ts.played, pd: ts.pd,
      winPct, avgPd, sosScore, recentForm, teamOvrScore,
      offenseOvr: offOvr > 0 ? offOvr : null,
      defenseOvr: defOvr > 0 ? defOvr : null,
      score,
      statLeaderName: leader?.name ?? null,
      statLeaderPos: leader?.pos ?? null,
      statLeaderLine: leader?.line ?? null
    });
  }

  // Sort by score desc
  rankEntries.sort((a, b) => b.score - a.score || b.winPct - a.winPct || b.pd - a.pd);

  // ── 7. Upsert to rec_power_rankings ──────────────────────────────────────────
  const rows = rankEntries.map((entry, idx) => {
    const rank = idx + 1;
    const prevRank = prevRankByTeam.get(entry.teamId) ?? null;
    const rankChange = prevRank != null ? prevRank - rank : null;
    return {
      league_id: leagueId,
      season_number: seasonNumber,
      week_number: newWeek,
      team_id: entry.teamId,
      rank,
      previous_rank: prevRank,
      rank_change: rankChange,
      score: entry.score,
      wins: entry.wins,
      losses: entry.losses,
      ties: entry.ties,
      games_played: entry.played,
      point_differential: entry.pd,
      win_pct: entry.winPct,
      avg_pd_per_game: entry.avgPd,
      sos_score: entry.sosScore,
      recent_form_score: entry.recentForm,
      team_ovr_score: entry.teamOvrScore,
      offense_ovr: entry.offenseOvr,
      defense_ovr: entry.defenseOvr,
      stat_leader_player_name: entry.statLeaderName,
      stat_leader_position: entry.statLeaderPos,
      stat_leader_stat_line: entry.statLeaderLine,
      updated_at: new Date().toISOString()
    };
  });

  if (rows.length) {
    const { error } = await supabase
      .from("rec_power_rankings")
      .upsert(rows, { onConflict: "league_id,season_number,week_number,team_id" });
    if (error) throw error;
  }

  const routes = await getRoutes(context.server_id).catch(() => null);

  return {
    rankings: rankEntries.map((entry, idx) => ({
      ...entry,
      rank: idx + 1,
      previousRank: prevRankByTeam.get(entry.teamId) ?? null,
      rankChange: prevRankByTeam.has(entry.teamId) ? (prevRankByTeam.get(entry.teamId)! - (idx + 1)) : null
    })),
    leagueName: league.name ?? "League",
    completedWeek,
    newWeek,
    announcementsChannelId: routes?.announcements_channel_id ?? null
  };
}

const OFFSEASON_STAGES = new Set(["coach_hiring", "final_resigning", "free_agency", "draft", "preseason_training_camp"]);

export async function recordHighlightPost(input: { guildId: string; discordId: string; discordChannelId: string; discordMessageId: string; messageUrl?: string | null; content?: string | null }) {
  const context = await getLeagueContext(input.guildId);
  const league = context.rec_leagues;
  const routes = await getRoutes(context.server_id);
  if (!routes?.highlights_channel_id || routes.highlights_channel_id !== input.discordChannelId) return { recorded: false, reason: "not_highlights_channel" };
  const { data: discord } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.discordId).maybeSingle();
  if (!discord?.user_id) return { recorded: false, reason: "unlinked_user" };
  const { data: assignment } = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("assignment_status", "active").is("ended_at", null).maybeSingle();
  if (!assignment) return { recorded: false, reason: "no_active_team" };
  const stage = String(league.season_stage ?? league.current_phase ?? "regular_season");
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const { data: existing } = await supabase.from("rec_highlight_posts").select("id").eq("league_id", context.league_id).eq("user_id", discord.user_id).eq("season_number", seasonNumber).eq("week_number", weekNumber).maybeSingle();
  const isFirstThisWeek = !existing;
  const payoutEligible = isFirstThisWeek && !OFFSEASON_STAGES.has(stage);
  const { data: post, error } = await supabase.from("rec_highlight_posts").insert({
    league_id: context.league_id,
    user_id: discord.user_id,
    team_id: assignment.team_id,
    season_number: seasonNumber,
    week_number: weekNumber,
    season_stage: stage,
    discord_channel_id: input.discordChannelId,
    discord_message_id: input.discordMessageId,
    message_url: input.messageUrl ?? null,
    content: (input.content ?? "").slice(0, 500),
    is_first_this_week: isFirstThisWeek,
    created_at: nowIso(),
    updated_at: nowIso()
  }).select("*").single();
  if (error) throw error;
  return { recorded: true, post, isFirstThisWeek, payoutEligible, pendingPayoutsChannelId: routes?.pending_payouts_channel_id ?? null };
}

export async function approveHighlightPayout(input: { postId: string; discordId: string }) {
  const { data: post, error } = await supabase.from("rec_highlight_posts").select("*").eq("id", input.postId).single();
  if (error) throw error;
  if (post.payout_review_id) return { approved: false, reason: "Payout already issued for this post." };
  const credit = await creditUserWallet({
    userId: post.user_id,
    leagueId: post.league_id,
    seasonNumber: post.season_number,
    amount: 5,
    transactionType: "credit",
    description: `Highlight payout — Week ${post.week_number}`,
    sourceReference: { type: "highlight_payout", postId: post.id, idempotencyKey: `highlight_payout_${post.id}` }
  });
  await supabase.from("rec_highlight_posts").update({ payout_review_id: credit.ledger?.id ?? null, payout_issued: true, updated_at: nowIso() }).eq("id", input.postId);
  return { approved: true, ledger: credit.ledger };
}

export async function submitPotyNomination(input: { guildId: string; nominatorDiscordId: string; nomineeDiscordId: string }) {
  const context = await getLeagueContext(input.guildId);
  const seasonNumber = context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1;
  const { data: nominator } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.nominatorDiscordId).maybeSingle();
  if (!nominator?.user_id) return { recorded: false, reason: "nominator_unlinked" };
  const { data: nominee } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.nomineeDiscordId).maybeSingle();
  if (!nominee?.user_id) return { recorded: false, reason: "nominee_unlinked" };
  const { error } = await supabase.from("rec_poty_nominations").upsert({
    league_id: context.league_id,
    season_number: seasonNumber,
    nominator_user_id: nominator.user_id,
    nominee_user_id: nominee.user_id,
    updated_at: nowIso()
  }, { onConflict: "league_id,season_number,nominator_user_id" });
  if (error) throw error;
  return { recorded: true };
}

export async function submitGotyNomination(input: { guildId: string; nominatorDiscordId: string; nominatedGameId: string }) {
  const context = await getLeagueContext(input.guildId);
  const seasonNumber = context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1;
  const { data: nominator } = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", input.nominatorDiscordId).maybeSingle();
  if (!nominator?.user_id) return { recorded: false, reason: "nominator_unlinked" };
  const { data: game } = await supabase.from("rec_game_results").select("id,home_team_id,away_team_id,rec_teams!rec_game_results_home_team_id_fkey(name),rec_teams!rec_game_results_away_team_id_fkey(name)").eq("id", input.nominatedGameId).maybeSingle();
  if (!game) return { recorded: false, reason: "game_not_found" };
  const { error } = await supabase.from("rec_goty_nominations").upsert({
    league_id: context.league_id,
    season_number: seasonNumber,
    nominator_user_id: nominator.user_id,
    nominated_game_id: input.nominatedGameId,
    home_team_label: (game as any)?.["rec_teams!rec_game_results_home_team_id_fkey"]?.name ?? null,
    away_team_label: (game as any)?.["rec_teams!rec_game_results_away_team_id_fkey"]?.name ?? null,
    updated_at: nowIso()
  }, { onConflict: "league_id,season_number,nominator_user_id" });
  if (error) throw error;
  return { recorded: true };
}

export async function getNominationData(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const currentWeek = league.current_week ?? 1;
  const completedWeek = Math.max(1, currentWeek - 1);
  const { data: assignments } = await supabase
    .from("rec_team_assignments")
    .select("user_id, rec_teams(name, abbreviation)")
    .eq("league_id", context.league_id)
    .eq("assignment_status", "active")
    .is("ended_at", null);
  const userIds = (assignments ?? []).map((a: any) => a.user_id).filter(Boolean);
  const { data: discordAccounts } = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds);
  const discordMap = new Map<string, string>();
  for (const d of discordAccounts ?? []) { if (d.user_id && d.discord_id) discordMap.set(String(d.user_id), String(d.discord_id)); }
  const nominees = (assignments ?? []).map((a: any) => ({
    userId: String(a.user_id),
    discordId: discordMap.get(String(a.user_id)) ?? null,
    displayName: (a.rec_teams as any)?.name ?? (a.rec_teams as any)?.abbreviation ?? "Unknown"
  }));
  const { data: games } = await supabase
    .from("rec_game_results")
    .select("id,home_team_id,away_team_id,home_score,away_score,rec_teams!rec_game_results_home_team_id_fkey(name),rec_teams!rec_game_results_away_team_id_fkey(name)")
    .eq("league_id", context.league_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", completedWeek)
    .eq("season_stage", "regular_season");
  const recentGames = (games ?? []).map((g: any) => ({
    gameId: String(g.id),
    homeTeam: g["rec_teams!rec_game_results_home_team_id_fkey"]?.name ?? "Home",
    awayTeam: g["rec_teams!rec_game_results_away_team_id_fkey"]?.name ?? "Away",
    homeScore: asNumber(g.home_score),
    awayScore: asNumber(g.away_score),
    label: `${g["rec_teams!rec_game_results_away_team_id_fkey"]?.name ?? "Away"} @ ${g["rec_teams!rec_game_results_home_team_id_fkey"]?.name ?? "Home"} (${asNumber(g.away_score)}-${asNumber(g.home_score)})`
  }));
  return { nominees, recentGames, seasonNumber, weekNumber: completedWeek };
}

const DEV_TRAIT_TIER: Record<string, number> = { Normal: 0, Star: 1, Superstar: 2, XFactor: 3 };
const DEV_UPGRADE_PRIZE = 50;

export async function processDevUpgradePrizes(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const seasonNumber = league.season_number ?? league.display_season_number ?? 1;
  const weekNumber = league.current_week ?? 1;
  const { data: pending, error } = await supabase
    .from("rec_dev_upgrade_prizes")
    .select("*")
    .eq("league_id", context.league_id)
    .eq("issued", false);
  if (error) throw error;
  if (!pending?.length) return { issued: 0, prizes: [] };
  const issued: any[] = [];
  for (const prize of pending) {
    if (!prize.user_id) continue;
    try {
      const credit = await creditUserWallet({
        userId: prize.user_id,
        leagueId: context.league_id,
        seasonNumber,
        amount: prize.prize_amount,
        transactionType: "credit",
        description: `Dev upgrade prize — ${prize.player_name ?? "Player"} upgraded from ${prize.old_dev_trait} to ${prize.new_dev_trait}`,
        sourceReference: { type: "dev_upgrade_prize", prizeId: prize.id, idempotencyKey: `dev_upgrade_${prize.id}` }
      });
      await supabase.from("rec_dev_upgrade_prizes").update({ issued: true, ledger_id: credit.ledger?.id ?? null }).eq("id", prize.id);
      issued.push({ ...prize, ledger: credit.ledger });
    } catch { /* non-fatal — log but continue */ }
  }
  return { issued: issued.length, prizes: issued };
}

export async function getLatestPowerRankings(guildId: string) {
  const context = await getLeagueContext(guildId);
  const league = context.rec_leagues;
  const leagueId = context.league_id;
  const seasonNumber = asNumber(league.season_number ?? 1);
  const currentWeek = asNumber(league.current_week ?? 1);

  const { data, error } = await supabase
    .from("rec_power_rankings")
    .select("*")
    .eq("league_id", leagueId)
    .eq("season_number", seasonNumber)
    .eq("week_number", currentWeek)
    .order("rank", { ascending: true });
  if (error) throw error;
  return { rankings: data ?? [], leagueName: league.name ?? "League", currentWeek };
}
