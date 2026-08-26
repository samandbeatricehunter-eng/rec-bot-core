// Game Day Audit (commissioner tool, /commishtools): reviews every active game channel and
// reports per-coach message activity, first-message-today timestamp, and submitted-times count,
// plus a plain heuristic recommendation (Fair Sim / Force Win) for clearly stalled matchups.
// Message data comes from a live Discord fetch at run time -- no message content is stored.
import { supabase } from "../../lib/supabase.js";
import { listDiscordChannelMessages } from "../../lib/discord-guild.js";
import { resolveTeamNick } from "../users/user-profile-stats.service.js";

export type GameDayAuditCoach = {
  userId: string | null;
  discordId: string | null;
  teamName: string;
  messageCount: number;
  firstMessageTodayAt: string | null;
  submittedTimesCount: number;
};

export type GameDayAuditEntry = {
  gameId: string;
  discordChannelId: string;
  home: GameDayAuditCoach;
  away: GameDayAuditCoach;
  recommendation: "fair_sim" | "force_win_home" | "force_win_away" | null;
};

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

async function coachActivity(discordId: string | null, messages: Array<{ author?: { id?: string; bot?: boolean }; timestamp?: string }>, todayIso: string) {
  if (!discordId) return { messageCount: 0, firstMessageTodayAt: null as string | null };
  const authored = messages.filter((m) => !m.author?.bot && m.author?.id === discordId);
  const todayMessages = authored.filter((m) => m.timestamp && m.timestamp >= todayIso).map((m) => m.timestamp as string);
  return {
    messageCount: authored.length,
    firstMessageTodayAt: todayMessages.length ? todayMessages.sort()[0]! : null,
  };
}

export async function runGameDayAudit(leagueId: string): Promise<GameDayAuditEntry[]> {
  const channels = await supabase.from("rec_game_channels")
    .select("game_id,discord_channel_id,home_user_id,away_user_id,home_team_id,away_team_id")
    .eq("league_id", leagueId).eq("status", "active");
  if (channels.error || !channels.data?.length) return [];

  const userIds = [...new Set(channels.data.flatMap((c: any) => [c.home_user_id, c.away_user_id]).filter(Boolean))] as string[];
  const teamIds = [...new Set(channels.data.flatMap((c: any) => [c.home_team_id, c.away_team_id]).filter(Boolean))] as string[];
  const gameIds = channels.data.map((c: any) => String(c.game_id));

  const [accounts, teams, proposals] = await Promise.all([
    userIds.length ? supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds) : Promise.resolve({ data: [], error: null }),
    teamIds.length ? supabase.from("rec_teams").select("id,name,display_nick,is_relocated").in("id", teamIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("rec_game_time_proposals").select("game_id,proposed_by_user_id").in("game_id", gameIds),
  ]);
  const discordByUser = new Map<string, string>((accounts.data ?? []).map((r: any) => [String(r.user_id), String(r.discord_id)]));
  const teamById = new Map<string, string>((teams.data ?? []).map((t: any) => [String(t.id), resolveTeamNick(t)]));
  const proposalCounts = new Map<string, number>();
  for (const row of (proposals.data ?? []) as any[]) {
    const key = `${row.game_id}:${row.proposed_by_user_id}`;
    proposalCounts.set(key, (proposalCounts.get(key) ?? 0) + 1);
  }

  const todayIso = startOfTodayIso();
  const entries: GameDayAuditEntry[] = [];

  for (const channel of channels.data as any[]) {
    const messages = await listDiscordChannelMessages(channel.discord_channel_id, 100).catch(() => []);
    const homeDiscordId = channel.home_user_id ? discordByUser.get(channel.home_user_id) ?? null : null;
    const awayDiscordId = channel.away_user_id ? discordByUser.get(channel.away_user_id) ?? null : null;
    const [homeActivity, awayActivity] = await Promise.all([
      coachActivity(homeDiscordId, messages, todayIso),
      coachActivity(awayDiscordId, messages, todayIso),
    ]);
    const home: GameDayAuditCoach = {
      userId: channel.home_user_id ?? null,
      discordId: homeDiscordId,
      teamName: teamById.get(String(channel.home_team_id)) ?? "Home",
      ...homeActivity,
      submittedTimesCount: channel.home_user_id ? proposalCounts.get(`${channel.game_id}:${channel.home_user_id}`) ?? 0 : 0,
    };
    const away: GameDayAuditCoach = {
      userId: channel.away_user_id ?? null,
      discordId: awayDiscordId,
      teamName: teamById.get(String(channel.away_team_id)) ?? "Away",
      ...awayActivity,
      submittedTimesCount: channel.away_user_id ? proposalCounts.get(`${channel.game_id}:${channel.away_user_id}`) ?? 0 : 0,
    };

    const homeActive = home.messageCount > 0 || home.submittedTimesCount > 0;
    const awayActive = away.messageCount > 0 || away.submittedTimesCount > 0;
    let recommendation: GameDayAuditEntry["recommendation"] = null;
    if (!homeActive && !awayActive) recommendation = "fair_sim";
    else if (!homeActive && awayActive) recommendation = "force_win_away";
    else if (!awayActive && homeActive) recommendation = "force_win_home";

    entries.push({ gameId: String(channel.game_id), discordChannelId: channel.discord_channel_id, home, away, recommendation });
  }

  return entries;
}
