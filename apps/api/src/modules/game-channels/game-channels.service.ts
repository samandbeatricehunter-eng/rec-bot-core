import { fairSimRuleLabel, forceWinRuleLabel } from "@rec/shared";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { createGuildChannel, deleteGuildChannel, postDiscordChannelMessage, postDiscordChannelMessageWithFile } from "../../lib/discord-guild.js";
import { getAdvanceWeekGames } from "../league-week/advance-results.service.js";
import { computePowerRankings } from "../schedule/power-rankings.service.js";
import { getLeagueConfigAsDraft } from "../setup/setup.service.js";
import { getActiveSuspension, postSchedulingPanel, repostPendingProposalNoticeIfAny, startResponseClock } from "../scheduling/matchup-scheduling.service.js";
import { renderMatchupCardPng } from "../../lib/matchup-render.js";

const DASHING_NOTICE = "⚠️ **DASHING (QUITTING IN 1ST HALF) IS NOT ALLOWED.**\nUsers can **CONCEDE** the game in the **2ND HALF**, but quitting in the first will result in getting booted, banned, and your username shared on all major Madden gaming servers.";

export async function getGameChannelByDiscordId(discordChannelId: string) {
  const { data, error } = await supabase
    .from("rec_game_channels")
    .select("*")
    .eq("discord_channel_id", discordChannelId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to load game channel matchup record.", error);
  return data ?? null;
}

// Used by box-score submission to find this week's game chat for a matchup, if one exists and
// is still active — a box score can be submitted after the channel's already been archived
// (late submission), in which case there's nowhere to post the opponent-tag notice.
export async function getGameChannelByGameId(gameId: string) {
  const { data, error } = await supabase
    .from("rec_game_channels")
    .select("*")
    .eq("game_id", gameId)
    .eq("status", "active")
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
  const deletedIds = (result.data ?? []).map((row: any) => row.id).filter(Boolean);
  if (deletedIds.length) {
    await supabase
      .from("rec_game_chat_messages")
      .delete()
      .in("game_channel_id", deletedIds)
      .then(({ error }) => {
        if (error) console.error("[ERROR] Failed to delete game chat messages for retired channels (non-fatal):", error);
      });
  }
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

function ruleKeyBullets(keys: unknown, labeler: (key: string) => string): string {
  const list = Array.isArray(keys) ? keys.filter(Boolean) : [];
  if (!list.length) return "_Not configured for this stage._";
  return list.map((key: string) => `• ${labeler(key)}`).join("\n");
}

// Extracted so the site game chat can seed a "channel opened" system-message card with the
// exact same content as the Discord embeds below, instead of duplicating (or faking) it.
function buildGameChannelIntroLines(input: { weekNumber: number; game: any; draft: any; ranks: Map<string, any>; discordByUserId: Map<string, string>; isGotw: boolean }) {
  const awayDiscordId = input.game.awayUserId ? input.discordByUserId.get(input.game.awayUserId) : null;
  const homeDiscordId = input.game.homeUserId ? input.discordByUserId.get(input.game.homeUserId) : null;
  const mentionIds = [awayDiscordId, homeDiscordId].filter(Boolean) as string[];
  const mentions = mentionIds.map((id) => `<@${id}>`);
  const isPlayoff = input.weekNumber > 16;
  const fwKeys = isPlayoff ? input.draft?.forceWinRulesPostseason : input.draft?.forceWinRulesRegular;
  const fsKeys = isPlayoff ? input.draft?.fairSimRulesPostseason : input.draft?.fairSimRulesRegular;
  const gotwRule = input.isGotw ? gotwStreamingText(input.draft, awayDiscordId ? `<@${awayDiscordId}>` : null, homeDiscordId ? `<@${homeDiscordId}>` : null) : null;

  const headerTitle = `Week ${input.weekNumber} · ${input.isGotw ? "GAME OF THE WEEK" : "H2H MATCHUP"}`;
  // Coach mentions live in the message content (postGameChannelIntro), not here -- an embed
  // mention never triggers a Discord ping, so keeping them here too would tag the coaches
  // twice for one actual notification.
  const headerDescription = `${input.game.awayTeamName} at ${input.game.homeTeamName}`;

  const rulesFields = [
    { name: "Fair Sim", value: ruleKeyBullets(fsKeys, fairSimRuleLabel), inline: false },
    { name: "Force Win", value: ruleKeyBullets(fwKeys, forceWinRuleLabel), inline: false },
    { name: "4th Down", value: fourthDownText(input.draft, isPlayoff), inline: false },
    { name: "Streaming", value: gotwRule ? `${streamingText(input.draft, isPlayoff)}\nGOTW: ${gotwRule}` : streamingText(input.draft, isPlayoff), inline: false },
  ];

  // Plain-text mirror of the same content, used to seed the site game-chat "channel opened"
  // system card -- that surface only renders a body string, not real Discord embeds.
  const lines = [
    `**${headerTitle}**`,
    headerDescription,
    "",
    "**Power Rankings**",
    rankLine(input.game.awayTeamName, input.game.awayTeamId, input.ranks),
    rankLine(input.game.homeTeamName, input.game.homeTeamId, input.ranks),
    "",
    "**Rules**",
    ...rulesFields.map((field) => `${field.name}:\n${field.value}`),
    "",
    DASHING_NOTICE,
    "",
    "**After the Game**",
    "Open this matchup's Chat on the REC site/app. Use the matchup actions there to submit the final box score, player stats, and highlights so records, payouts, reels, and stories update.",
  ];
  return {
    mentionIds, mentions, lines,
    title: `${input.game.awayTeamName} at ${input.game.homeTeamName}`,
    headerTitle, headerDescription, rulesFields,
  };
}

// Boot-safe one-time backfill for channels that existed before the intro embed gained the
// dashing warning. The matching system message is the durable receipt, so restarts do not
// repost the notice.
export async function postDashingNoticeToActiveGameChannels() {
  const active = await supabase.from("rec_game_channels").select("id,league_id,game_id,discord_channel_id").eq("status", "active");
  if (active.error) throw new ApiError(500, "Failed to load active game channels for dashing notice.", active.error);

  let posted = 0;
  for (const channel of active.data ?? []) {
    const existing = await supabase.from("rec_game_chat_messages")
      .select("id")
      .eq("game_channel_id", channel.id)
      .eq("source", "system")
      .eq("body", DASHING_NOTICE)
      .limit(1)
      .maybeSingle();
    if (existing.error) {
      console.error("[ERROR] Failed to check dashing-notice receipt (non-fatal):", existing.error);
      continue;
    }
    if (existing.data) continue;

    const message = await postDiscordChannelMessage(String(channel.discord_channel_id), {
      embeds: [{ title: "Important League Notice", color: 0xdc3545, description: DASHING_NOTICE }],
      allowed_mentions: { parse: [] },
    }).catch((error) => {
      console.error("[ERROR] Failed to post dashing notice to game channel (non-fatal):", error);
      return null;
    });
    if (!message) continue;

    const receipt = await supabase.from("rec_game_chat_messages").insert({
      game_channel_id: channel.id,
      league_id: channel.league_id,
      game_id: channel.game_id,
      author_display_name: "REC Bot",
      source: "system",
      body: DASHING_NOTICE,
    });
    if (receipt.error) {
      console.error("[ERROR] Failed to save dashing-notice receipt (non-fatal):", receipt.error);
      continue;
    }
    posted++;
  }
  return { posted };
}

async function postGameChannelIntro(input: { channelId: string; weekNumber: number; game: any; draft: any; ranks: Map<string, any>; discordByUserId: Map<string, string>; isGotw: boolean }) {
  const built = buildGameChannelIntroLines(input);

  // Best-effort: the game-channel post must go out even if Chromium is unavailable or the
  // render times out (e.g. a fresh deploy still warming up) -- the card image is a nice-to-have
  // on top of the header embed, not a hard dependency for the channel to be usable. Raced against
  // an outer timeout as a last-resort safety net -- renderMatchupCardPng has its own internal
  // timeouts, but if Chromium itself hangs on launch (the classic "no sandbox capability in this
  // container" failure mode) rather than rejecting, nothing inside it can catch that; this makes
  // sure a stuck render can never block the rest of a week's channel creation.
  const png = input.game.gameId
    ? await Promise.race([
        renderMatchupCardPng(input.game.gameId),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error("Matchup card render timed out (outer 20s safety net)")), 20_000)),
      ]).catch((error) => {
        console.error("[ERROR] Failed to render matchup card for game channel (non-fatal):", error);
        return null;
      })
    : null;

  // The card image already shows the matchup -- the "Away at Home" text description is only
  // needed as a fallback for when the render didn't come through.
  const headerEmbed: Record<string, unknown> = {
    title: built.headerTitle,
    color: input.isGotw ? 0xd4af37 : 0xd9a521,
    ...(png ? {} : { description: built.headerDescription }),
  };
  const rulesEmbed: Record<string, unknown> = {
    title: "Rules",
    color: 0xd9a521,
    fields: built.rulesFields,
    description: DASHING_NOTICE,
  };

  // Coach mentions live ONLY in the message content, not the header embed's description -- an
  // embed mention never triggers a Discord ping/notification, so this is the one place that
  // needs them for the channel-creation ping to actually fire.
  const payload = {
    content: built.mentions.join(" "),
    embeds: png ? [{ ...headerEmbed, image: { url: "attachment://matchup-card.png" } }, rulesEmbed] : [headerEmbed, rulesEmbed],
    allowed_mentions: { users: built.mentionIds },
  };

  if (png) {
    await postDiscordChannelMessageWithFile(input.channelId, payload, { buffer: png, name: "matchup-card.png" });
  } else {
    await postDiscordChannelMessage(input.channelId, payload);
  }
  return built;
}

type GameChannelContext = Awaited<ReturnType<typeof getCurrentLeagueContext>>;
type AdvanceWeek = Awaited<ReturnType<typeof getAdvanceWeekGames>>;

// If either coach in this H2H matchup is currently suspended (Commish Tools' Suspend User),
// the game channel gets an advisory posted at creation AND the opponent's Force Win is applied
// in the system immediately -- a suspended coach's opponent shouldn't have to notice the
// suspension and go request it manually every week it recurs.
async function postSuspensionAdvisoryIfNeeded(channelId: string, game: any) {
  const [awaySuspension, homeSuspension] = await Promise.all([
    game.awayUserId ? getActiveSuspension(game.awayUserId) : Promise.resolve(null),
    game.homeUserId ? getActiveSuspension(game.homeUserId) : Promise.resolve(null),
  ]);
  const suspended = awaySuspension ? { side: "away" as const, beneficiaryUserId: game.homeUserId, teamName: game.awayTeamName, ...awaySuspension }
    : homeSuspension ? { side: "home" as const, beneficiaryUserId: game.awayUserId, teamName: game.homeTeamName, ...homeSuspension }
    : null;
  if (!suspended || !suspended.beneficiaryUserId) return;

  await supabase.from("rec_game_scheduling").update({
    fw_flagged: true, fw_flagged_for_user_id: suspended.beneficiaryUserId, fw_flagged_at: new Date().toISOString(),
    attention_required: true, updated_at: new Date().toISOString(),
  }).eq("game_id", game.gameId);

  const until = new Date(suspended.endsAt).toUTCString().replace(" GMT", " UTC");
  await postDiscordChannelMessage(channelId, {
    content: `🚫 **${suspended.teamName}'s coach is currently suspended** (until ${until}) — the opponent receives the Force Win by default. This has already been flagged in the system.`,
  }).catch(() => undefined);
}

// Shared by both createGameChannelsForCurrentWeek (full replace) and
// repairGameChannelsForCurrentWeek (fill-only) — everything past "which games need a
// channel" is identical: create the Discord channel, register it, post the intro embed,
// seed the game chat system card.
async function createChannelsForGames(context: GameChannelContext, guildId: string, categoryId: string, week: AdvanceWeek, games: any[]) {
  const [draft, powerRankings, discordByUser] = await Promise.all([
    bestEffort("game_channels.league_config_draft", () => getLeagueConfigAsDraft(guildId).then((r) => (r as any)?.draft ?? null), { guildId }).then((v) => v ?? null),
    computePowerRankings(guildId).catch(() => ({ teams: [] })),
    discordIdsByUserId([...new Set(games.flatMap((game) => [game.awayUserId, game.homeUserId]).filter(Boolean))] as string[]),
  ]);
  const gotwPolls = await supabase.from("rec_game_of_week_polls").select("game_id").eq("league_id", context.leagueId)
    .eq("season_number", week.seasonNumber).eq("week_number", week.currentWeek).in("status", ["open", "closed"]);
  if (gotwPolls.error) throw new ApiError(500, "Failed to load GOTW for game-channel publishing.", gotwPolls.error);
  const gotwGameIds = new Set((gotwPolls.data ?? []).map((poll: any) => poll.game_id).filter(Boolean));
  const ranks = new Map<string, any>(((powerRankings as any)?.teams ?? []).map((team: any) => [String(team.teamId), team]));

  const created: Array<{ gameId: string; gameChannelId: string | null; discordChannelId: string; name: string; awayUserId: string | null; homeUserId: string | null }> = [];
  for (const game of games) {
    const name = `${channelSlug(game.awayTeamName)}-at-${channelSlug(game.homeTeamName)}`.slice(0, 100);
    const channel = await createGuildChannel(guildId, { name, type: "text", parentChannelId: categoryId });
    const gameChannelRow = await registerGameChannel({
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
    const intro = await postGameChannelIntro({ channelId: channel.id, weekNumber: week.currentWeek, game, draft, ranks, discordByUserId: discordByUser, isGotw: gotwGameIds.has(game.gameId) });
    if (game.awayUserId && game.homeUserId) {
      await startResponseClock(game.gameId).catch((error) => console.error("[ERROR] Failed to start scheduling response clock (non-fatal):", error));
      await postSchedulingPanel(channel.id, game.gameId);
      await postSuspensionAdvisoryIfNeeded(channel.id, game).catch((error) => console.error("[ERROR] Failed to post suspension advisory (non-fatal):", error));
      // Channel wipe/recreate (or a repair filling a gap) must not silently drop a pending
      // scheduling offer -- repost it into the freshly-created channel.
      await repostPendingProposalNoticeIfAny(game.gameId).catch((error) => console.error("[ERROR] Failed to repost pending proposal notice (non-fatal):", error));
    }
    if (gameChannelRow?.id) {
      await supabase
        .from("rec_game_chat_messages")
        .insert({
          game_channel_id: gameChannelRow.id,
          league_id: context.leagueId,
          game_id: game.gameId,
          author_display_name: "REC Bot",
          source: "system",
          body: intro.lines.join("\n").trim().slice(0, 2000),
        })
        .then(({ error }) => {
          if (error) console.error("[ERROR] Failed to seed game chat intro card (non-fatal):", error);
        });
    }
    created.push({ gameId: game.gameId, gameChannelId: gameChannelRow?.id ?? null, discordChannelId: channel.id, name: channel.name, awayUserId: game.awayUserId ?? null, homeUserId: game.homeUserId ?? null });
  }
  return created;
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
  const created = await createChannelsForGames(context, guildId, categoryId, week, h2hGames);
  return { created, deleted: deletedIds.length, eligible: h2hGames.length };
}

// Backs the "Repair Game Channels" picker modal — lists every current-week H2H matchup so
// the commissioner can choose which ones to wipe+recreate, rather than only offering
// wipe-everything (createGameChannelsForCurrentWeek) or fill-only (repairGameChannelsForCurrentWeek).
export async function listCurrentWeekGameChannelCandidates(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const week = await getAdvanceWeekGames(guildId);
  const h2hGames = (week.games as any[]).filter((game) => game.isH2h);
  if (!h2hGames.length) return { candidates: [] };

  const existing = await supabase
    .from("rec_game_channels")
    .select("game_id")
    .eq("league_id", context.leagueId)
    .eq("status", "active")
    .in("game_id", h2hGames.map((game) => game.gameId));
  if (existing.error) throw new ApiError(500, "Failed to check existing game channels.", existing.error);
  const hasChannel = new Set((existing.data ?? []).map((row: any) => row.game_id));

  return {
    candidates: h2hGames.map((game) => ({
      gameId: game.gameId as string,
      name: `${game.awayTeamName} at ${game.homeTeamName}`,
      hasActiveChannel: hasChannel.has(game.gameId),
    })),
  };
}

// Recreate variant: wipes+recreates only the specific current-week matchups the commissioner
// selected in the picker modal, leaving every other tracked channel untouched. Shares
// createChannelsForGames with the two whole-week variants above.
export async function recreateGameChannelsForGames(guildId: string, gameIds: string[]) {
  const context = await getCurrentLeagueContext(guildId);
  const categoryId = String((context.routes as any)?.game_channels_category_id ?? "");
  if (!categoryId) throw new ApiError(400, "Assign the Game Channels category in Settings before creating game channels.");
  if (!gameIds.length) return { created: [], deleted: 0, eligible: 0 };

  const week = await getAdvanceWeekGames(guildId);
  const selectedIds = new Set(gameIds);
  const h2hGames = (week.games as any[]).filter((game) => game.isH2h && selectedIds.has(game.gameId));
  if (!h2hGames.length) return { created: [], deleted: 0, eligible: 0 };

  const existing = await supabase
    .from("rec_game_channels")
    .select("discord_channel_id")
    .eq("league_id", context.leagueId)
    .eq("status", "active")
    .in("game_id", h2hGames.map((game) => game.gameId));
  if (existing.error) throw new ApiError(500, "Failed to load existing game channels for the selected matchups.", existing.error);

  const deletedIds: string[] = [];
  for (const row of existing.data ?? []) {
    const channelId = String((row as any).discord_channel_id ?? "");
    if (!channelId) continue;
    const deleted = await deleteGuildChannel(channelId, "Recreating this REC game channel by commissioner request.");
    if (deleted) deletedIds.push(channelId);
  }
  if (deletedIds.length) await markTrackedGameChannelsDeleted(deletedIds);

  const created = await createChannelsForGames(context, guildId, categoryId, week, h2hGames);
  return { created, deleted: deletedIds.length, eligible: h2hGames.length };
}

// Repair variant: never deletes or touches an existing tracked channel — only creates one
// for a current-week H2H matchup that doesn't have an active channel yet. Covers a league
// that advanced with an incomplete schedule (channels already ran once) and then had more
// games added afterward — this fills exactly the gap, leaving every in-use channel alone.
export async function repairGameChannelsForCurrentWeek(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const categoryId = String((context.routes as any)?.game_channels_category_id ?? "");
  if (!categoryId) throw new ApiError(400, "Assign the Game Channels category in Settings before creating game channels.");

  const week = await getAdvanceWeekGames(guildId);
  const h2hGames = (week.games as any[]).filter((game) => game.isH2h);
  if (!h2hGames.length) return { created: [], skipped: 0, eligible: 0 };

  const existing = await supabase
    .from("rec_game_channels")
    .select("game_id")
    .eq("league_id", context.leagueId)
    .eq("status", "active")
    .in("game_id", h2hGames.map((game) => game.gameId));
  if (existing.error) throw new ApiError(500, "Failed to check existing game channels.", existing.error);
  const alreadyCovered = new Set((existing.data ?? []).map((row: any) => row.game_id));
  const missingGames = h2hGames.filter((game) => !alreadyCovered.has(game.gameId));

  const created = missingGames.length ? await createChannelsForGames(context, guildId, categoryId, week, missingGames) : [];
  return { created, skipped: h2hGames.length - missingGames.length, eligible: h2hGames.length };
}
