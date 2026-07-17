import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { createGuildChannel, deleteGuildChannel, postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { getAdvanceWeekGames } from "../league-week/advance-results.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { getLeagueConfigAsDraft } from "../setup/setup.service.js";

export async function getGameChannelByDiscordId(discordChannelId: string) {
  const { data, error } = await supabase
    .from("rec_game_channels")
    .select("*")
    .eq("discord_channel_id", discordChannelId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load game channel matchup record.", error);
  return data ?? null;
}

export async function listTrackedGameChannelDiscordIds(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_game_channels")
    .select("discord_channel_id")
    .eq("league_id", context.leagueId)
    .in("status", ["active", "archived"]);
  if (error) throw new ApiError(500, "Failed to load tracked game channels.", error);
  return [...new Set((data ?? []).map((row) => row.discord_channel_id).filter(Boolean))];
}

export async function registerGameChannel(input: {
  guildId: string;
  gameId?: string | null;
  discordChannelId: string;
  seasonNumber: number;
  weekNumber: number;
  awayTeamId?: string | null;
  homeTeamId?: string | null;
  awayUserId?: string | null;
  homeUserId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const now = new Date().toISOString();
  const payload = {
    league_id: context.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    game_id: input.gameId ?? null,
    discord_channel_id: input.discordChannelId,
    away_team_id: input.awayTeamId ?? null,
    home_team_id: input.homeTeamId ?? null,
    away_user_id: input.awayUserId ?? null,
    home_user_id: input.homeUserId ?? null,
    status: "active",
    updated_at: now,
  };

  const existing = await supabase
    .from("rec_game_channels")
    .select("id")
    .eq("discord_channel_id", input.discordChannelId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to look up existing game channel record.", existing.error);

  const result = existing.data?.id
    ? await supabase.from("rec_game_channels").update(payload).eq("id", existing.data.id).select("*").single()
    : await supabase.from("rec_game_channels").insert({ ...payload, created_at: now }).select("*").single();
  if (result.error) throw new ApiError(500, "Failed to register game channel.", result.error);
  return result.data;
}

export async function markTrackedGameChannelsDeleted(discordChannelIds: string[]) {
  if (!discordChannelIds.length) return { updated: 0 };
  const now = new Date().toISOString();
  const result = await supabase
    .from("rec_game_channels")
    .update({ status: "deleted", deleted_at: now, updated_at: now })
    .in("discord_channel_id", discordChannelIds)
    .in("status", ["active", "archived"])
    .select("id");
  if (result.error) throw new ApiError(500, "Failed to mark game channels deleted.", result.error);
  return { updated: result.data?.length ?? 0 };
}

function channelSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
}

function ruleLabel(value: unknown) {
  return String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function fourthDownText(draft: any, isPlayoff: boolean) {
  const rawType = isPlayoff ? draft?.fourthDownRuleTypePlayoff : draft?.fourthDownRuleTypeRegular;
  const type = String(rawType ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const custom = isPlayoff ? draft?.customFourthDownRulePlayoff : draft?.customFourthDownRuleRegular;
  if (type === "none") return "No special 4th down restriction is configured.";
  if (type === "custom") return String(custom ?? "").trim() || "Custom league 4th down rules apply.";
  if (!type) return "Follow the current league 4th down rules.";
  return "Standard REC: past midfield on 4th & 3 or shorter; trailing in the second half may go anytime.";
}

function streamingText(draft: any, isPlayoff: boolean) {
  const requirement = isPlayoff ? draft?.postseasonStreamingRequirement : draft?.regularSeasonStreamingRequirement;
  const side = isPlayoff ? draft?.postseasonStreamingSide : draft?.regularSeasonStreamingSide;
  if (requirement === "disabled") return "Streaming is disabled for this stage.";
  const verb = requirement === "required" ? "must" : "should";
  const sideText = side === "home" ? `the home team ${verb} stream`
    : side === "away" ? `the away team ${verb} stream`
    : side === "both" ? `both teams ${verb} stream`
    : `at least one team ${verb} stream`;
  return `${ruleLabel(requirement || "recommended")}: ${sideText}.`;
}

function gotwStreamingText(draft: any, awayMention?: string | null, homeMention?: string | null) {
  const requirement = draft?.gotwStreamingRequirement ?? "recommended";
  const side = draft?.gotwStreamingSide ?? "either";
  if (requirement === "disabled") return "GOTW streaming is disabled.";
  const verb = requirement === "required" ? "must" : "should";
  const away = awayMention ?? "the away coach";
  const home = homeMention ?? "the home coach";
  const responsible = side === "home" ? `${home} ${verb} stream`
    : side === "away" ? `${away} ${verb} stream`
    : side === "both" ? `${away} and ${home} ${verb} both stream`
    : `at least one of ${away} or ${home} ${verb} stream`;
  return `${ruleLabel(requirement)}: ${responsible}.`;
}

function rankLine(teamName: string, teamId: string | null | undefined, ranks: Map<string, any>) {
  const row = teamId ? ranks.get(teamId) : null;
  if (!row) return `${teamName}: Unranked`;
  const change = row.change == null ? "new" : row.change > 0 ? `+${row.change}` : row.change < 0 ? `${row.change}` : "0";
  return `${teamName}: #${row.rank} (${change})`;
}

async function discordIdsByUserId(userIds: string[]) {
  if (!userIds.length) return new Map<string, string>();
  const { data, error } = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", userIds);
  if (error) throw new ApiError(500, "Failed to load coach Discord mentions for game channels.", error);
  return new Map<string, string>((data ?? []).map((row: any) => [String(row.user_id), String(row.discord_id)]));
}

async function postGameChannelIntro(input: { channelId: string; weekNumber: number; game: any; draft: any; ranks: Map<string, any>; discordByUserId: Map<string, string>; isGotw: boolean }) {
  const awayDiscordId = input.game.awayUserId ? input.discordByUserId.get(input.game.awayUserId) : null;
  const homeDiscordId = input.game.homeUserId ? input.discordByUserId.get(input.game.homeUserId) : null;
  const mentionIds = [awayDiscordId, homeDiscordId].filter(Boolean) as string[];
  const mentions = mentionIds.map((id) => `<@${id}>`);
  const isPlayoff = input.weekNumber > 16;
  const fs = String(input.draft?.fairSimRequirements ?? "Fair Sims are the default when users do not complete a game before advance.");
  const fw = String(input.draft?.forceWinRequirements ?? "Force Wins can be requested when scheduling rules are met and one user misses the agreed time.");
  const gotwRule = input.isGotw ? gotwStreamingText(input.draft, awayDiscordId ? `<@${awayDiscordId}>` : null, homeDiscordId ? `<@${homeDiscordId}>` : null) : null;
  await postDiscordChannelMessage(input.channelId, {
    content: mentions.join(" "),
    embeds: [{
      title: `${input.game.awayTeamName} at ${input.game.homeTeamName}`,
      color: 0xd9a521,
      description: [
        `**Week ${input.weekNumber} H2H${input.isGotw ? " · GAME OF THE WEEK" : ""}**`,
        mentions.length ? `${mentions.join(" vs ")}, this is your head-to-head game channel.` : "This is the head-to-head game channel for this matchup.",
        "",
        "**Power Rankings**",
        rankLine(input.game.awayTeamName, input.game.awayTeamId, input.ranks),
        rankLine(input.game.homeTeamName, input.game.homeTeamId, input.ranks),
        "",
        "**Game Rules**",
        `4th Down: ${fourthDownText(input.draft, isPlayoff)}`,
        `Streaming: ${streamingText(input.draft, isPlayoff)}`,
        ...(gotwRule ? [`GOTW Streaming: ${gotwRule}`] : []),
        "",
        "**FS / FW**",
        `Fair Sim: ${fs}`,
        `Force Win: ${fw}`,
        "",
        "After the game, submit the box score through the Weekly Submissions panel so stats, payouts, records, and stories can update.",
      ].join("\n").slice(0, 4096),
    }],
    allowed_mentions: { users: mentionIds },
  });
}

// Commissioner "Create Game Channels" action in League Mgmt — deletes last week's tracked
// game channels and creates one per current-week H2H matchup, same as the bot's old
// Game Channels menu button, but driven from the web via Discord's REST API.
export async function createGameChannelsForCurrentWeek(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const categoryId = String((context.routes as any)?.game_channels_category_id ?? "");
  if (!categoryId) throw new ApiError(400, "Assign the Game Channels category in Settings before creating game channels.");

  const tracked = await listTrackedGameChannelDiscordIds(guildId);
  const deletedIds: string[] = [];
  for (const channelId of tracked) {
    const id = String(channelId);
    const deleted = await deleteGuildChannel(id, "Replacing tracked REC game channels for the current week schedule.");
    if (deleted) deletedIds.push(id);
  }
  if (deletedIds.length) await markTrackedGameChannelsDeleted(deletedIds);

  const week = await getAdvanceWeekGames(guildId);
  const h2hGames = (week.games as any[]).filter((game) => game.isH2h);
  const [draft, powerRankings, discordByUser] = await Promise.all([
    getLeagueConfigAsDraft(guildId).then((r) => (r as any)?.draft ?? null).catch(() => null),
    computePowerRankings(guildId).catch(() => ({ teams: [] })),
    discordIdsByUserId([...new Set(h2hGames.flatMap((game) => [game.awayUserId, game.homeUserId]).filter(Boolean))] as string[]),
  ]);
  const gotwPolls = await supabase.from("rec_game_of_week_polls").select("game_id").eq("league_id", context.leagueId)
    .eq("season_number", week.seasonNumber).eq("week_number", week.currentWeek).in("status", ["open", "closed"]);
  if (gotwPolls.error) throw new ApiError(500, "Failed to load GOTW for game-channel publishing.", gotwPolls.error);
  const gotwGameIds = new Set((gotwPolls.data ?? []).map((poll: any) => poll.game_id).filter(Boolean));
  const ranks = new Map<string, any>(((powerRankings as any)?.teams ?? []).map((team: any) => [String(team.teamId), team]));

  const created: Array<{ gameId: string; discordChannelId: string; name: string }> = [];
  for (const game of h2hGames) {
    const name = `${channelSlug(game.awayTeamName)}-at-${channelSlug(game.homeTeamName)}`.slice(0, 100);
    const channel = await createGuildChannel(guildId, { name, type: "text", parentChannelId: categoryId });
    await registerGameChannel({
      guildId,
      gameId: game.gameId,
      discordChannelId: channel.id,
      seasonNumber: week.seasonNumber,
      weekNumber: week.currentWeek,
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      awayUserId: game.awayUserId,
      homeUserId: game.homeUserId,
    });
    await postGameChannelIntro({ channelId: channel.id, weekNumber: week.currentWeek, game, draft, ranks, discordByUserId: discordByUser, isGotw: gotwGameIds.has(game.gameId) });
    created.push({ gameId: game.gameId, discordChannelId: channel.id, name: channel.name });
  }

  return { created, deleted: deletedIds.length, eligible: h2hGames.length };
}
