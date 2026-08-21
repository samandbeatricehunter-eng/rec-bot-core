import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { sendDiscordDirectMessagePayload } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague, siteOnlyGuildId, siteOnlyDiscordId } from "../league-context/league-context.service.js";
import { resolveRecUserIdByAuthUserId } from "../subscriptions/entitlements.service.js";
import {
  autopostAtIso,
  formatMatchupOptionLabel,
  publicStreamUrl,
  type StreamPlatform,
} from "./streaming-labels.js";
import {
  publicApiBaseUrl,
  signOAuthState,
  siteAccountRedirect,
  tiktokOAuthConfigured,
  twitchConfigured,
  verifyOAuthState,
  youtubeConfigured,
} from "./streaming-config.js";
import { canSealStreamingTokens, openStreamingToken, sealStreamingToken } from "./streaming-token-vault.js";
import {
  deleteTwitchEventsub,
  exchangeTwitchCode,
  fetchTwitchUser,
  helixGetStreams,
  subscribeTwitchStreamEvents,
  twitchAuthorizeUrl,
} from "./twitch-client.js";
import { exchangeYoutubeCode, fetchYoutubeChannel, youtubeAuthorizeUrl, youtubeIsLive } from "./youtube-client.js";
import {
  exchangeTiktokCode,
  normalizeTiktokUsername,
  tiktokAuthorizeUrl,
  tiktokIsLive,
} from "./tiktok-client.js";
import { pushStreamingEvent } from "./streaming-realtime.js";

export type StreamingMatchupOption = {
  gameId: string;
  leagueId: string;
  weekNumber: number | null;
  awayTeamName: string;
  homeTeamName: string;
  serverName: string;
  label: string;
  scheduledFor: string | null;
};

type StreamingAccountRow = {
  id: string;
  user_id: string;
  platform: StreamPlatform;
  platform_user_id: string | null;
  platform_login: string;
  display_name: string | null;
  profile_url: string | null;
  token_ciphertext: string | null;
  token_iv: string | null;
  token_tag: string | null;
  token_expires_at: string | null;
  eventsub_online_id: string | null;
  eventsub_offline_id: string | null;
  status: string;
};

function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function listH2hMatchupsForUser(userId: string): Promise<StreamingMatchupOption[]> {
  const { data, error } = await supabase
    .from("rec_games")
    .select(`
      id, league_id, week_number, home_user_id, away_user_id, status,
      home_team:rec_teams!rec_games_home_team_id_fkey(name),
      away_team:rec_teams!rec_games_away_team_id_fkey(name),
      league:rec_leagues!rec_games_league_id_fkey(id, name, current_week),
      scheduling:rec_game_scheduling(status, scheduled_for)
    `)
    .or(`home_user_id.eq.${userId},away_user_id.eq.${userId}`)
    .not("home_user_id", "is", null)
    .not("away_user_id", "is", null)
    .not("status", "in", "(completed,cancelled)");
  if (error) throw new ApiError(500, "Failed to load your matchups.", error);

  const rows = (data ?? []) as any[];
  const leagueIds = [...new Set(rows.map((row) => String(row.league_id)).filter(Boolean))];
  const serverNameByLeague = new Map<string, string>();
  if (leagueIds.length) {
    const links = await supabase
      .from("rec_server_league_links")
      .select("league_id, server:rec_discord_servers(name)")
      .in("league_id", leagueIds)
      .eq("is_primary", true);
    for (const link of links.data ?? []) {
      const name = (link as any).server?.name;
      if (name) serverNameByLeague.set(String(link.league_id), String(name));
    }
  }

  const options: StreamingMatchupOption[] = [];
  for (const row of rows) {
    if (row.home_user_id !== userId && row.away_user_id !== userId) continue;
    const scheduling = Array.isArray(row.scheduling) ? row.scheduling[0] : row.scheduling;
    if (scheduling?.status === "completed") continue;
    const league = row.league;
    const currentWeek = league?.current_week == null ? null : Number(league.current_week);
    const weekNumber = row.week_number == null ? null : Number(row.week_number);
    const scheduledFor = scheduling?.scheduled_for ? String(scheduling.scheduled_for) : null;
    const isCurrentWeek = currentWeek != null && weekNumber === currentWeek;
    const isLiveOrConfirmed = scheduling?.status === "live" || scheduling?.status === "confirmed";
    if (!isCurrentWeek && !isLiveOrConfirmed && !scheduledFor) continue;

    const awayTeamName = row.away_team?.name ?? "Away";
    const homeTeamName = row.home_team?.name ?? "Home";
    const serverName = serverNameByLeague.get(String(row.league_id)) || league?.name || "REC League";
    const label = formatMatchupOptionLabel({ awayTeamName, homeTeamName, serverName });
    options.push({
      gameId: row.id,
      leagueId: row.league_id,
      weekNumber,
      awayTeamName,
      homeTeamName,
      serverName,
      label,
      scheduledFor,
    });
  }

  options.sort((a, b) => a.label.localeCompare(b.label));
  return options.slice(0, 25);
}

export async function matchupScheduledToday(userId: string, now = new Date()): Promise<boolean> {
  const today = utcDateString(now);
  const matchups = await listH2hMatchupsForUser(userId);
  return matchups.some((matchup) => matchup.scheduledFor && matchup.scheduledFor.slice(0, 10) === today);
}

async function discordIdForUser(userId: string): Promise<string | null> {
  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId).maybeSingle();
  return account.data?.discord_id ? String(account.data.discord_id) : null;
}

async function guildIdForLeague(leagueId: string): Promise<string> {
  const linked = await findServerRoutesForLeague(leagueId);
  return linked?.guildId ?? siteOnlyGuildId(leagueId);
}

export function streamingPlatformStatus() {
  return {
    twitch: twitchConfigured(),
    youtube: youtubeConfigured(),
    tiktokOAuth: tiktokOAuthConfigured(),
    tiktokUsername: true,
    publicApi: Boolean(publicApiBaseUrl()),
  };
}

export async function listStreamingAccounts(userId: string) {
  const accounts = await supabase
    .from("rec_streaming_accounts")
    .select("id, platform, platform_login, display_name, profile_url, status")
    .eq("user_id", userId)
    .neq("status", "disabled");
  if (accounts.error) throw new ApiError(500, "Failed to load linked streaming accounts.", accounts.error);
  return {
    accounts: (accounts.data ?? []).map((row: any) => ({
      platform: row.platform as StreamPlatform,
      login: row.platform_login as string,
      displayName: (row.display_name as string | null) ?? null,
      profileUrl: (row.profile_url as string | null) ?? null,
      status: row.status as string,
      streamUrl: publicStreamUrl(row.platform, row.platform_login, null),
    })),
    configured: streamingPlatformStatus(),
  };
}

export async function resolveLinkedStreamUrl(userId: string): Promise<{ url: string; platform: StreamPlatform } | null> {
  const listed = await listStreamingAccounts(userId);
  const preferred = listed.accounts.find((row) => row.platform === "twitch")
    ?? listed.accounts.find((row) => row.platform === "youtube")
    ?? listed.accounts[0];
  if (!preferred) return null;
  return { url: preferred.streamUrl, platform: preferred.platform };
}

export function startStreamingOAuth(input: { authUserId: string; platform: StreamPlatform }): { url: string } {
  const state = signOAuthState({ authUserId: input.authUserId, platform: input.platform });
  if (input.platform === "twitch") return { url: twitchAuthorizeUrl(state) };
  if (input.platform === "youtube") return { url: youtubeAuthorizeUrl(state) };
  return { url: tiktokAuthorizeUrl(state) };
}

async function upsertAccount(input: {
  userId: string;
  platform: StreamPlatform;
  platformUserId: string | null;
  platformLogin: string;
  displayName: string | null;
  profileUrl: string;
  token?: { accessToken: string; refreshToken: string | null; expiresAt: number } | null;
  eventsubOnlineId?: string | null;
  eventsubOfflineId?: string | null;
}) {
  const sealed = input.token && canSealStreamingTokens() ? sealStreamingToken(input.token) : null;
  const existing = await supabase
    .from("rec_streaming_accounts")
    .select("id, eventsub_online_id, eventsub_offline_id")
    .eq("user_id", input.userId)
    .eq("platform", input.platform)
    .maybeSingle();
  const payload: Record<string, unknown> = {
    user_id: input.userId,
    platform: input.platform,
    platform_user_id: input.platformUserId,
    platform_login: input.platformLogin,
    display_name: input.displayName,
    profile_url: input.profileUrl,
    eventsub_online_id: input.eventsubOnlineId ?? existing.data?.eventsub_online_id ?? null,
    eventsub_offline_id: input.eventsubOfflineId ?? existing.data?.eventsub_offline_id ?? null,
    status: "active",
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  if (sealed) {
    payload.token_ciphertext = sealed.ciphertext;
    payload.token_iv = sealed.iv;
    payload.token_tag = sealed.tag;
    payload.token_expires_at = input.token ? new Date(input.token.expiresAt).toISOString() : null;
  }
  if (existing.data?.id) {
    const updated = await supabase.from("rec_streaming_accounts").update(payload).eq("id", existing.data.id).select("*").single();
    if (updated.error) throw new ApiError(500, "Failed to save streaming account.", updated.error);
    return updated.data as StreamingAccountRow;
  }
  const inserted = await supabase.from("rec_streaming_accounts").insert({
    ...payload,
    token_ciphertext: sealed?.ciphertext ?? null,
    token_iv: sealed?.iv ?? null,
    token_tag: sealed?.tag ?? null,
    token_expires_at: input.token ? new Date(input.token.expiresAt).toISOString() : null,
  }).select("*").single();
  if (inserted.error) throw new ApiError(500, "Failed to save streaming account.", inserted.error);
  return inserted.data as StreamingAccountRow;
}

export async function completeStreamingOAuth(input: { platform: StreamPlatform; code: string; state: string }): Promise<string> {
  const verified = verifyOAuthState(input.state);
  if (verified.platform !== input.platform) {
    return siteAccountRedirect({ streaming: "error", reason: "platform" });
  }
  const userId = await resolveRecUserIdByAuthUserId(verified.authUserId);
  if (!userId) return siteAccountRedirect({ streaming: "error", reason: "unlinked" });

  try {
    if (input.platform === "twitch") {
      const token = await exchangeTwitchCode(input.code);
      const user = await fetchTwitchUser(token.accessToken);
      const eventsub = await subscribeTwitchStreamEvents(user.id);
      await upsertAccount({
        userId,
        platform: "twitch",
        platformUserId: user.id,
        platformLogin: user.login,
        displayName: user.display_name,
        profileUrl: publicStreamUrl("twitch", user.login),
        token,
        eventsubOnlineId: eventsub.onlineId,
        eventsubOfflineId: eventsub.offlineId,
      });
    } else if (input.platform === "youtube") {
      const token = await exchangeYoutubeCode(input.code);
      const channel = await fetchYoutubeChannel(token.accessToken);
      const login = (channel.customUrl ?? channel.id).replace(/^@/, "");
      await upsertAccount({
        userId,
        platform: "youtube",
        platformUserId: channel.id,
        platformLogin: login,
        displayName: channel.title,
        profileUrl: publicStreamUrl("youtube", login, channel.id),
        token,
      });
    } else {
      const token = await exchangeTiktokCode(input.code);
      await upsertAccount({
        userId,
        platform: "tiktok",
        platformUserId: token.openId,
        platformLogin: token.username,
        displayName: token.displayName,
        profileUrl: publicStreamUrl("tiktok", token.username),
        token,
      });
    }
    return siteAccountRedirect({ streaming: "linked", platform: input.platform });
  } catch (error) {
    console.error("[ERROR] Streaming OAuth failed", input.platform, error);
    return siteAccountRedirect({ streaming: "error", platform: input.platform });
  }
}

export async function linkTiktokUsername(userId: string, username: string) {
  const login = normalizeTiktokUsername(username);
  if (!/^[a-z0-9._]{2,24}$/i.test(login)) {
    throw new ApiError(400, "Enter a valid TikTok username (letters, numbers, period, or underscore).");
  }
  await upsertAccount({
    userId,
    platform: "tiktok",
    platformUserId: null,
    platformLogin: login,
    displayName: login,
    profileUrl: publicStreamUrl("tiktok", login),
    token: null,
  });
  return listStreamingAccounts(userId);
}

export async function unlinkStreamingAccount(userId: string, platform: StreamPlatform) {
  const existing = await supabase
    .from("rec_streaming_accounts")
    .select("id, eventsub_online_id, eventsub_offline_id")
    .eq("user_id", userId)
    .eq("platform", platform)
    .maybeSingle();
  if (existing.data) {
    await Promise.all([
      deleteTwitchEventsub(existing.data.eventsub_online_id),
      deleteTwitchEventsub(existing.data.eventsub_offline_id),
    ]);
    await supabase.from("rec_streaming_accounts").delete().eq("id", existing.data.id);
  }
  return listStreamingAccounts(userId);
}

async function loadAccountByPlatformUser(platform: StreamPlatform, platformUserId: string): Promise<StreamingAccountRow | null> {
  const result = await supabase
    .from("rec_streaming_accounts")
    .select("*")
    .eq("platform", platform)
    .eq("platform_user_id", platformUserId)
    .eq("status", "active")
    .maybeSingle();
  return (result.data as StreamingAccountRow | null) ?? null;
}

async function openSessionForAccount(account: StreamingAccountRow): Promise<any | null> {
  const existing = await supabase
    .from("rec_streaming_sessions")
    .select("*")
    .eq("account_id", account.id)
    .is("ended_at", null)
    .maybeSingle();
  return existing.data ?? null;
}

async function armIntent(input: { userId: string; gameId: string; source: "discord_dm" | "site_modal" | "site_share" }) {
  const game = await supabase.from("rec_games").select("id, league_id, home_user_id, away_user_id").eq("id", input.gameId).maybeSingle();
  if (!game.data) throw new ApiError(404, "Matchup not found.");
  if (game.data.home_user_id !== input.userId && game.data.away_user_id !== input.userId) {
    throw new ApiError(403, "That matchup is not one of yours.");
  }
  await supabase.from("rec_streaming_intents")
    .update({ status: "cancelled" })
    .eq("user_id", input.userId)
    .eq("status", "armed");
  const inserted = await supabase.from("rec_streaming_intents").insert({
    user_id: input.userId,
    game_id: input.gameId,
    league_id: game.data.league_id,
    source: input.source,
    status: "armed",
  }).select("*").single();
  if (inserted.error) throw new ApiError(500, "Failed to mark you live for that matchup.", inserted.error);
  return inserted.data;
}

async function armedIntentForUser(userId: string) {
  const result = await supabase
    .from("rec_streaming_intents")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "armed")
    .maybeSingle();
  return result.data ?? null;
}

function discordPromptComponents(promptId: string, matchups: StreamingMatchupOption[]) {
  return [
    {
      type: 1,
      components: [{
        type: 3,
        custom_id: `rec:live:game:${promptId}`,
        placeholder: "Select a matchup",
        options: matchups.map((matchup) => ({ label: matchup.label.slice(0, 100), value: matchup.gameId })),
      }],
    },
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: `rec:live:ok:${promptId}`, label: "Confirm" },
        { type: 2, style: 2, custom_id: `rec:live:no:${promptId}`, label: "No" },
      ],
    },
  ];
}

async function sendOrReusePromptDm(input: {
  userId: string;
  prompt: { id: string };
  kind: "day_of" | "went_live";
  matchups: StreamingMatchupOption[];
}) {
  const discordId = await discordIdForUser(input.userId);
  if (!discordId || !input.matchups.length) return;
  const description = input.kind === "day_of"
    ? "You have a scheduled matchup today. Going live for one of your games? Pick it below and hit Confirm. Hit No if you are not streaming a league game."
    : "You just went live. Are you streaming one of your REC league games? Pick the matchup and hit Confirm, or No to ignore this stream.";
  try {
    const sent = await sendDiscordDirectMessagePayload(discordId, {
      content: input.kind === "day_of" ? "You have a matchup today." : "You just went live.",
      embeds: [{ title: "Going live for a league game?", description }],
      components: discordPromptComponents(input.prompt.id, input.matchups),
    });
    if (sent?.id) {
      await supabase.from("rec_streaming_prompts").update({
        discord_message_id: sent.id,
      }).eq("id", input.prompt.id);
    }
  } catch (error) {
    console.error("[ERROR] Failed to DM streaming prompt (non-fatal):", error);
  }
}

async function createPrompt(input: {
  userId: string;
  kind: "day_of" | "went_live";
  sessionId?: string | null;
}) {
  const inserted = await supabase.from("rec_streaming_prompts").insert({
    user_id: input.userId,
    prompt_kind: input.kind,
    prompt_date: utcDateString(),
    session_id: input.sessionId ?? null,
    status: "pending",
  }).select("*").single();
  if (inserted.error) {
    if (inserted.error.code === "23505" && input.kind === "day_of") {
      const existing = await supabase.from("rec_streaming_prompts")
        .select("*").eq("user_id", input.userId).eq("prompt_kind", "day_of").eq("prompt_date", utcDateString()).maybeSingle();
      return existing.data;
    }
    throw new ApiError(500, "Failed to create live-stream prompt.", inserted.error);
  }
  return inserted.data;
}

export async function handleStreamerWentLive(input: {
  platform: StreamPlatform;
  platformUserId?: string | null;
  platformLogin?: string | null;
  streamId?: string | null;
  account?: StreamingAccountRow | null;
}) {
  const account = input.account ?? (
    input.platformUserId
      ? await loadAccountByPlatformUser(input.platform, input.platformUserId)
      : null
  );
  if (!account) return { handled: false as const };
  const existing = await openSessionForAccount(account);
  if (existing) return { handled: true as const, sessionId: existing.id, duplicate: true };

  const streamUrl = publicStreamUrl(account.platform, account.platform_login, account.platform_user_id);
  const startedAt = Date.now();
  const intent = await armedIntentForUser(account.user_id);
  const session = await supabase.from("rec_streaming_sessions").insert({
    user_id: account.user_id,
    account_id: account.id,
    platform: account.platform,
    platform_stream_id: input.streamId ?? null,
    stream_url: streamUrl,
    started_at: new Date(startedAt).toISOString(),
    status: intent ? "live" : "live",
    confirmed_game_id: intent?.game_id ?? null,
    ignored: false,
    autopost_at: intent ? autopostAtIso(startedAt) : null,
  }).select("*").single();
  if (session.error) throw new ApiError(500, "Failed to record live stream.", session.error);

  const matchups = await listH2hMatchupsForUser(account.user_id);
  if (intent) {
    return { handled: true as const, sessionId: session.data.id, armed: true };
  }
  if (!matchups.length) {
    await supabase.from("rec_streaming_sessions").update({
      ignored: true,
      status: "ignored",
      updated_at: new Date().toISOString(),
    }).eq("id", session.data.id);
    return { handled: true as const, sessionId: session.data.id, ignored: true };
  }

  const prompt = await createPrompt({ userId: account.user_id, kind: "went_live", sessionId: session.data.id });
  if (prompt) {
    await sendOrReusePromptDm({ userId: account.user_id, prompt, kind: "went_live", matchups });
    pushStreamingEvent(account.user_id, {
      kind: "went_live",
      promptId: prompt.id,
      sessionId: session.data.id,
      platform: account.platform,
      streamUrl,
      matchups: matchups.map((row) => ({ gameId: row.gameId, label: row.label })),
    });
  }
  return { handled: true as const, sessionId: session.data.id, prompted: true };
}

export async function handleStreamerWentOffline(input: {
  platform: StreamPlatform;
  platformUserId?: string | null;
  account?: StreamingAccountRow | null;
}) {
  const account = input.account ?? (
    input.platformUserId
      ? await loadAccountByPlatformUser(input.platform, input.platformUserId)
      : null
  );
  if (!account) return { ended: false as const };
  const session = await openSessionForAccount(account);
  if (!session) return { ended: false as const };
  const now = new Date().toISOString();
  await supabase.from("rec_streaming_sessions").update({
    ended_at: now,
    status: session.posted_at ? "posted" : session.ignored ? "ignored" : "ended",
    updated_at: now,
  }).eq("id", session.id);
  if (session.posted_stream_log_id) {
    await supabase.from("rec_stream_compliance_logs").update({ ended_at: now }).eq("id", session.posted_stream_log_id).is("ended_at", null);
  }
  if (session.confirmed_game_id) {
    await supabase.from("rec_stream_compliance_logs").update({ ended_at: now }).eq("game_id", session.confirmed_game_id).eq("user_id", account.user_id).is("ended_at", null);
  }
  pushStreamingEvent(account.user_id, { kind: "ended", sessionId: session.id });
  return { ended: true as const, sessionId: session.id };
}

export async function getLivePromptForUser(userId: string) {
  const session = await supabase
    .from("rec_streaming_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("ended_at", null)
    .eq("ignored", false)
    .maybeSingle();
  if (!session.data || session.data.confirmed_game_id || session.data.posted_at) {
    return { prompt: null, matchups: [] as StreamingMatchupOption[], session: null };
  }
  const prompt = await supabase
    .from("rec_streaming_prompts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const matchups = await listH2hMatchupsForUser(userId);
  return { prompt: prompt.data ?? null, matchups, session: session.data };
}

export async function selectPromptGame(input: { userId: string; promptId: string; gameId: string }) {
  const matchups = await listH2hMatchupsForUser(input.userId);
  if (!matchups.some((row) => row.gameId === input.gameId)) {
    throw new ApiError(400, "Pick one of your current H2H matchups.");
  }
  const updated = await supabase.from("rec_streaming_prompts")
    .update({ selected_game_id: input.gameId })
    .eq("id", input.promptId)
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (!updated.data) throw new ApiError(404, "That prompt is no longer active.");
  return { selected: true as const, gameId: input.gameId };
}

export async function confirmPrompt(input: {
  userId: string;
  promptId: string;
  gameId?: string | null;
  source: "discord_dm" | "site_modal";
}) {
  const prompt = await supabase.from("rec_streaming_prompts").select("*").eq("id", input.promptId).eq("user_id", input.userId).maybeSingle();
  if (!prompt.data) throw new ApiError(404, "That prompt was not found.");
  if (prompt.data.status !== "pending") return { confirmed: false as const, reason: prompt.data.status };

  const gameId = input.gameId ?? prompt.data.selected_game_id;
  if (!gameId) throw new ApiError(400, "Select a matchup first.");
  await armIntent({ userId: input.userId, gameId, source: input.source });
  const now = new Date().toISOString();
  await supabase.from("rec_streaming_prompts").update({
    status: "confirmed",
    confirmed_game_id: gameId,
    selected_game_id: gameId,
    responded_at: now,
  }).eq("id", input.promptId);

  const sessionQuery = prompt.data.session_id
    ? await supabase.from("rec_streaming_sessions").select("*").eq("id", prompt.data.session_id).maybeSingle()
    : await supabase.from("rec_streaming_sessions").select("*").eq("user_id", input.userId).is("ended_at", null).maybeSingle();
  const session = sessionQuery.data;
  if (session && !session.ignored && !session.posted_at) {
    const startedAt = new Date(session.started_at).getTime();
    await supabase.from("rec_streaming_sessions").update({
      confirmed_game_id: gameId,
      autopost_at: autopostAtIso(startedAt),
      updated_at: now,
    }).eq("id", session.id);
    if (shouldPostNow(startedAt)) {
      await postConfirmedSession(session.id).catch((error) => console.error("[ERROR] Immediate autopost failed (non-fatal):", error));
    }
  }
  return { confirmed: true as const, gameId };
}

function shouldPostNow(startedAtMs: number) {
  return Date.now() >= startedAtMs + 3 * 60_000;
}

export async function declinePrompt(input: { userId: string; promptId: string }) {
  const prompt = await supabase.from("rec_streaming_prompts").select("*").eq("id", input.promptId).eq("user_id", input.userId).maybeSingle();
  if (!prompt.data) throw new ApiError(404, "That prompt was not found.");
  const now = new Date().toISOString();
  await supabase.from("rec_streaming_prompts").update({
    status: "declined",
    responded_at: now,
  }).eq("id", input.promptId);

  const sessionQuery = prompt.data.session_id
    ? await supabase.from("rec_streaming_sessions").select("*").eq("id", prompt.data.session_id).maybeSingle()
    : await supabase.from("rec_streaming_sessions").select("*").eq("user_id", input.userId).is("ended_at", null).maybeSingle();
  if (sessionQuery.data && !sessionQuery.data.posted_at) {
    await supabase.from("rec_streaming_sessions").update({
      ignored: true,
      status: "ignored",
      autopost_at: null,
      updated_at: now,
    }).eq("id", sessionQuery.data.id);
  }
  return { declined: true as const };
}

export async function confirmGameFromSite(input: { userId: string; gameId: string; source: "site_modal" | "site_share" }) {
  await armIntent({ userId: input.userId, gameId: input.gameId, source: input.source });
  const session = await supabase.from("rec_streaming_sessions").select("*").eq("user_id", input.userId).is("ended_at", null).maybeSingle();
  if (session.data && !session.data.ignored && !session.data.posted_at) {
    const startedAt = new Date(session.data.started_at).getTime();
    await supabase.from("rec_streaming_sessions").update({
      confirmed_game_id: input.gameId,
      autopost_at: input.source === "site_share" ? new Date().toISOString() : autopostAtIso(startedAt),
      updated_at: new Date().toISOString(),
    }).eq("id", session.data.id);
    if (input.source === "site_share" || shouldPostNow(startedAt)) {
      await postConfirmedSession(session.data.id).catch((error) => console.error("[ERROR] Site stream post failed (non-fatal):", error));
    }
  }
  return { confirmed: true as const, gameId: input.gameId };
}

export async function postConfirmedSession(sessionId: string) {
  const session = await supabase.from("rec_streaming_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session.data || session.data.posted_at || session.data.ignored || session.data.ended_at) return { posted: false as const };
  const gameId = session.data.confirmed_game_id;
  if (!gameId) return { posted: false as const };

  const game = await supabase.from("rec_games").select("id, league_id, week_number").eq("id", gameId).maybeSingle();
  if (!game.data) return { posted: false as const };

  const guildId = await guildIdForLeague(game.data.league_id);
  const discordId = (await discordIdForUser(session.data.user_id)) ?? siteOnlyDiscordId(session.data.user_id);
  const { shareHubMatchupStream } = await import("../hub/hub.service.js");
  const posted = await shareHubMatchupStream({
    guildId,
    discordId,
    gameId,
    url: session.data.stream_url,
  });

  const now = new Date().toISOString();
  await supabase.from("rec_streaming_sessions").update({
    posted_at: now,
    posted_stream_log_id: posted.streamLogId,
    status: "posted",
    updated_at: now,
  }).eq("id", sessionId);
  await supabase.from("rec_streaming_intents")
    .update({ status: "consumed", consumed_at: now })
    .eq("user_id", session.data.user_id)
    .eq("game_id", gameId)
    .eq("status", "armed");

  const matchup = (await listH2hMatchupsForUser(session.data.user_id)).find((row) => row.gameId === gameId);
  const { postStreamToGameChannel } = await import("../streams/streams.service.js");
  await postStreamToGameChannel({
    gameId,
    streamerDiscordId: discordId.startsWith("site:") ? null : discordId,
    awayTeamName: matchup?.awayTeamName ?? "Away",
    homeTeamName: matchup?.homeTeamName ?? "Home",
    url: session.data.stream_url,
    weekNumber: matchup?.weekNumber ?? game.data.week_number,
  }).catch((error) => console.error("[ERROR] Failed to post stream to game channel (non-fatal):", error));

  return { posted: true as const, streamLogId: posted.streamLogId };
}

export async function runStreamingAutopostSweep() {
  const due = await supabase
    .from("rec_streaming_sessions")
    .select("id")
    .is("ended_at", null)
    .eq("ignored", false)
    .is("posted_at", null)
    .not("confirmed_game_id", "is", null)
    .not("autopost_at", "is", null)
    .lte("autopost_at", new Date().toISOString());
  for (const row of due.data ?? []) {
    await postConfirmedSession(row.id).catch((error) => console.error("[ERROR] Autopost sweep failed for session", row.id, error));
  }
}

export async function runStreamingGameTimerEnd() {
  const cutoff = new Date(Date.now() - 45 * 60_000).toISOString();
  const liveGames = await supabase
    .from("rec_game_scheduling")
    .select("game_id")
    .not("game_started_at", "is", null)
    .lte("game_started_at", cutoff)
    .neq("status", "completed");
  const gameIds = (liveGames.data ?? []).map((row: any) => String(row.game_id));
  if (!gameIds.length) return;
  const now = new Date().toISOString();
  await supabase.from("rec_stream_compliance_logs").update({ ended_at: now }).in("game_id", gameIds).is("ended_at", null);
  await supabase.from("rec_streaming_sessions").update({
    ended_at: now,
    status: "ended",
    updated_at: now,
  }).in("confirmed_game_id", gameIds).is("ended_at", null);
}

export async function runDayOfStreamingPrompts() {
  const today = utcDateString();
  const start = `${today}T00:00:00.000Z`;
  const end = `${today}T23:59:59.999Z`;
  const scheduled = await supabase
    .from("rec_game_scheduling")
    .select("game_id, scheduled_for")
    .not("scheduled_for", "is", null)
    .gte("scheduled_for", start)
    .lte("scheduled_for", end)
    .not("status", "in", "(completed)");
  const gameIds = [...new Set((scheduled.data ?? []).map((row: any) => String(row.game_id)))];
  if (!gameIds.length) return;

  const games = await supabase
    .from("rec_games")
    .select("id, home_user_id, away_user_id")
    .in("id", gameIds)
    .not("home_user_id", "is", null)
    .not("away_user_id", "is", null);
  const userIds = [...new Set((games.data ?? []).flatMap((row: any) => [row.home_user_id, row.away_user_id]).filter(Boolean).map(String))];
  if (!userIds.length) return;

  const linked = await supabase
    .from("rec_streaming_accounts")
    .select("user_id")
    .in("user_id", userIds)
    .eq("status", "active");
  const linkedUsers = [...new Set((linked.data ?? []).map((row: any) => String(row.user_id)))];
  const already = await supabase
    .from("rec_streaming_prompts")
    .select("user_id")
    .eq("prompt_kind", "day_of")
    .eq("prompt_date", today)
    .in("user_id", linkedUsers);
  const sent = new Set((already.data ?? []).map((row: any) => String(row.user_id)));

  for (const userId of linkedUsers) {
    if (sent.has(userId)) continue;
    const matchups = await listH2hMatchupsForUser(userId);
    if (!matchups.length) continue;
    const prompt = await createPrompt({ userId, kind: "day_of" });
    if (!prompt || prompt.status !== "pending") continue;
    await sendOrReusePromptDm({ userId, prompt, kind: "day_of", matchups });
  }
}

export async function pollLinkedLiveStatus() {
  const accounts = await supabase.from("rec_streaming_accounts").select("*").eq("status", "active");
  const rows = (accounts.data ?? []) as StreamingAccountRow[];
  const twitch = rows.filter((row) => row.platform === "twitch" && row.platform_user_id);
  const liveTwitch = await helixGetStreams(twitch.map((row) => String(row.platform_user_id)));
  const liveTwitchIds = new Set(liveTwitch.map((row) => row.user_id));

  for (const account of twitch) {
    const live = liveTwitchIds.has(String(account.platform_user_id));
    const session = await openSessionForAccount(account);
    if (live && !session) {
      const stream = liveTwitch.find((row) => row.user_id === account.platform_user_id);
      await handleStreamerWentLive({
        platform: "twitch",
        platformUserId: account.platform_user_id,
        streamId: stream?.id ?? null,
        account,
      }).catch((error) => console.error("[ERROR] Twitch poll went-live failed", account.id, error));
    } else if (!live && session) {
      await handleStreamerWentOffline({ platform: "twitch", account }).catch((error) => console.error("[ERROR] Twitch poll went-offline failed", account.id, error));
    }
  }

  for (const account of rows.filter((row) => row.platform === "youtube")) {
    if (!account.token_ciphertext || !account.token_iv || !account.token_tag) continue;
    try {
      const token = openStreamingToken({
        ciphertext: account.token_ciphertext,
        iv: account.token_iv,
        tag: account.token_tag,
      });
      const live = await youtubeIsLive(token);
      const session = await openSessionForAccount(account);
      if (live.live && !session) {
        await handleStreamerWentLive({ platform: "youtube", account, streamId: live.streamId });
      } else if (!live.live && session) {
        await handleStreamerWentOffline({ platform: "youtube", account });
      }
    } catch (error) {
      console.error("[ERROR] YouTube live poll failed", account.id, error);
    }
  }

  for (const account of rows.filter((row) => row.platform === "tiktok")) {
    const live = await tiktokIsLive(account.platform_login);
    const session = await openSessionForAccount(account);
    if (live && !session) {
      await handleStreamerWentLive({ platform: "tiktok", account });
    } else if (!live && session) {
      await handleStreamerWentOffline({ platform: "tiktok", account });
    }
  }
}

export async function runStreamingSweep() {
  await runDayOfStreamingPrompts().catch((error) => console.error("[ERROR] Day-of streaming prompts failed:", error));
  await pollLinkedLiveStatus().catch((error) => console.error("[ERROR] Streaming live poll failed:", error));
  await runStreamingAutopostSweep().catch((error) => console.error("[ERROR] Streaming autopost sweep failed:", error));
  await runStreamingGameTimerEnd().catch((error) => console.error("[ERROR] Streaming game-timer end failed:", error));
}

export async function handleTwitchEventsubPayload(body: any) {
  const type = String(body?.subscription?.type ?? "");
  const event = body?.event ?? {};
  const userId = String(event.broadcaster_user_id ?? "");
  if (!userId) return { ok: true };
  if (type === "stream.online") {
    await handleStreamerWentLive({
      platform: "twitch",
      platformUserId: userId,
      platformLogin: event.broadcaster_user_login,
      streamId: event.id ?? null,
    });
  } else if (type === "stream.offline") {
    await handleStreamerWentOffline({ platform: "twitch", platformUserId: userId });
  }
  return { ok: true };
}
