import { randomUUID } from "node:crypto";
import { isRegularSeasonWeek, type LeagueGame } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import {
  copyStreamFromUrl,
  createStreamDirectUpload,
  deleteStreamVideo,
  HIGHLIGHT_MAX_DURATION_SECONDS,
  HIGHLIGHT_MAX_HEIGHT,
  streamPlaybackUrls,
  verifyStreamWebhookSignature,
} from "../../lib/cloudflare-stream.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

const HIGHLIGHT_PAYOUT_AMOUNT = 25;
const HIGHLIGHT_WEEKLY_PAID_LIMIT = 2;
const HIGHLIGHT_WEEKLY_UPLOAD_LIMIT = 2;

async function getDiscordAccount(discordId: string) {
  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  if (!account.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return account.data;
}

async function getActiveAssignment(leagueId: string, userId: string) {
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load active team assignment.", assignment.error);
  return assignment.data;
}

async function maybeCreateWeeklyPayoutReview(input: {
  leagueId: string;
  highlightId: string;
  userId: string;
  teamId: string | null;
  seasonNumber: number;
  weekNumber: number;
  seasonStage: string;
  discordChannelId: string | null;
  discordMessageId: string | null;
  game: string | null;
  guildId?: string | null;
  serverId?: string | null;
  requesterDiscordId?: string | null;
}) {
  const leagueGame = (input.game ?? "madden_26") as LeagueGame;
  const isRegularSeason =
    input.seasonStage === "regular_season" &&
    input.weekNumber >= 1 &&
    isRegularSeasonWeek(input.weekNumber, leagueGame);
  const isPostseason = ["wild_card", "divisional", "conference_championship", "super_bowl", "postseason", "playoffs"].includes(input.seasonStage);
  if (!isRegularSeason && !isPostseason) return;

  const existingPaid = await supabase
    .from("rec_highlight_payout_reviews")
    .select("id")
    .eq("league_id", input.leagueId)
    .eq("user_id", input.userId)
    .eq("season_number", input.seasonNumber)
    .eq("week_number", input.weekNumber)
    .in("status", ["pending", "approved", "issued"])
    .limit(HIGHLIGHT_WEEKLY_PAID_LIMIT);
  if (existingPaid.error) throw new ApiError(500, "Failed to check highlight payout status.", existingPaid.error);
  const paidCount = (existingPaid.data ?? []).length;
  const amount = paidCount >= HIGHLIGHT_WEEKLY_PAID_LIMIT ? 0 : HIGHLIGHT_PAYOUT_AMOUNT;

  const review = await supabase
    .from("rec_highlight_payout_reviews")
    .insert({
      highlight_post_id: input.highlightId,
      league_id: input.leagueId,
      user_id: input.userId,
      team_id: input.teamId,
      season_number: input.seasonNumber,
      week_number: input.weekNumber,
      payout_kind: "weekly_highlight",
      status: "pending",
      amount,
      discord_channel_id: input.discordChannelId,
      discord_message_id: input.discordMessageId,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (review.error) throw new ApiError(500, "Failed to create highlight payout review.", review.error);

  await supabase
    .from("rec_highlight_posts")
    .update({
      payout_review_id: review.data.id,
      is_first_this_week: paidCount === 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.highlightId);

  if (input.guildId) {
    const inbox = await supabase.from("rec_commissioners_inbox").insert({
      guild_id: input.guildId,
      server_id: input.serverId,
      league_id: input.leagueId,
      season_number: input.seasonNumber,
      week_number: input.weekNumber,
      queue_type: "highlight",
      status: "pending",
      priority: 0,
      header: amount > 0 ? `Highlight payout: Wk ${input.weekNumber}` : `Highlight review: Wk ${input.weekNumber}`,
      summary: input.requesterDiscordId
        ? `Highlight uploaded by <@${input.requesterDiscordId}> — approve to publish${amount > 0 ? ` and pay ${amount}` : ""}.`
        : `Highlight uploaded — approve to publish${amount > 0 ? ` and pay ${amount}` : ""}.`,
      requester_discord_id: input.requesterDiscordId,
      requester_user_id: input.userId,
      amount,
      source_table: "rec_highlight_payout_reviews",
      source_id: review.data.id,
      payload: { reviewId: review.data.id, highlightPostId: input.highlightId, payoutKind: "weekly_highlight", amount },
    });
    if (inbox.error) {
      console.error("[ERROR] Failed to create commissioners inbox row for weekly highlight payout:", inbox.error);
    }
  }
}

async function assertWeeklyHighlightUploadAllowed(input: {
  leagueId: string;
  userId: string;
  seasonNumber: number;
  weekNumber: number;
  seasonStage: string;
}) {
  const isRegularSeason = input.seasonStage === "regular_season";
  const isPostseason = ["wild_card", "divisional", "conference_championship", "super_bowl", "postseason", "playoffs", "national_championship"].includes(input.seasonStage);
  if (!isRegularSeason && !isPostseason) return;

  const existing = await supabase
    .from("rec_highlight_posts")
    .select("id,media_status")
    .eq("league_id", input.leagueId)
    .eq("user_id", input.userId)
    .eq("season_number", input.seasonNumber)
    .eq("week_number", input.weekNumber);
  if (existing.error) throw new ApiError(500, "Failed to check weekly highlight upload limit.", existing.error);
  const count = (existing.data ?? []).filter((row) => row.media_status !== "failed" && row.media_status !== "deleted").length;
  if (count >= HIGHLIGHT_WEEKLY_UPLOAD_LIMIT) {
    throw new ApiError(400, `You can upload at most ${HIGHLIGHT_WEEKLY_UPLOAD_LIMIT} highlights per week during the regular season and postseason.`);
  }
}


export async function createHighlightDirectUpload(input: {
  guildId: string;
  discordId: string;
  gameId: string;
  fileName?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId);
  const assignment = await getActiveAssignment(context.leagueId, account.user_id);

  const game = await supabase
    .from("rec_games")
    .select("id,week_number,home_user_id,away_user_id,league_id")
    .eq("id", input.gameId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (game.error) throw new ApiError(500, "Failed to load matchup.", game.error);
  if (!game.data) throw new ApiError(404, "Matchup not found.");
  if (game.data.home_user_id !== account.user_id && game.data.away_user_id !== account.user_id) {
    throw new ApiError(403, "Only matchup participants can upload highlights.");
  }

  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(game.data.week_number ?? context.rec_leagues.current_week ?? 1);
  const seasonStage = String(context.rec_leagues.season_stage ?? context.rec_leagues.current_phase ?? "regular_season");

  await assertWeeklyHighlightUploadAllowed({
    leagueId: context.leagueId,
    userId: account.user_id,
    seasonNumber,
    weekNumber,
    seasonStage,
  });
  const highlightId = randomUUID();

  const stream = await createStreamDirectUpload({
    maxDurationSeconds: HIGHLIGHT_MAX_DURATION_SECONDS,
    meta: {
      name: input.fileName?.slice(0, 120) || `highlight-${highlightId}`,
      highlightId,
      leagueId: context.leagueId,
      gameId: input.gameId,
    },
  });

  const now = new Date().toISOString();
  const inserted = await supabase
    .from("rec_highlight_posts")
    .insert({
      id: highlightId,
      league_id: context.leagueId,
      user_id: account.user_id,
      team_id: assignment?.team_id ?? null,
      season_number: seasonNumber,
      week_number: weekNumber,
      season_stage: seasonStage,
      game_id: input.gameId,
      cloudflare_stream_uid: stream.uid,
      storage_provider: "cloudflare_stream",
      media_status: "uploading",
      max_height: HIGHLIGHT_MAX_HEIGHT,
      retained_as_poty: false,
      hub_visible: false,
      content: null,
      created_at: now,
      updated_at: now,
    })
    .select("id,cloudflare_stream_uid,media_status")
    .single();
  if (inserted.error) {
    await deleteStreamVideo(stream.uid).catch(() => undefined);
    throw new ApiError(500, "Failed to create highlight draft.", inserted.error);
  }

  return {
    highlightId: inserted.data.id,
    uploadURL: stream.uploadURL,
    streamUid: stream.uid,
    maxDurationSeconds: HIGHLIGHT_MAX_DURATION_SECONDS,
    maxHeight: HIGHLIGHT_MAX_HEIGHT,
  };
}

const DURATION_REJECT_MESSAGE =
  "Clip longer than 45 seconds. Crop to 45 seconds or less and upload again.";

export async function getHighlightUploadStatus(input: {
  guildId: string;
  discordId: string;
  highlightId: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  await getDiscordAccount(input.discordId);
  const highlight = await supabase
    .from("rec_highlight_posts")
    .select("id,media_status,playback_url,cloudflare_stream_uid,max_height,storage_provider")
    .eq("id", input.highlightId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (highlight.error) throw new ApiError(500, "Failed to load highlight status.", highlight.error);
  if (!highlight.data) throw new ApiError(404, "Highlight not found.");
  const streamUid = highlight.data.cloudflare_stream_uid;
  return {
    highlightId: highlight.data.id,
    mediaStatus: highlight.data.media_status,
    playbackUrl: highlight.data.playback_url,
    streamUid,
    iframeUrl: streamUid ? streamPlaybackUrls(streamUid).iframe : null,
    maxHeight: highlight.data.max_height,
    storageProvider: highlight.data.storage_provider,
    failureReason:
      highlight.data.media_status === "failed"
        ? DURATION_REJECT_MESSAGE
        : null,
  };
}

export async function markHighlightUploadReceived(input: {
  guildId: string;
  discordId: string;
  highlightId: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId);
  const updated = await supabase
    .from("rec_highlight_posts")
    .update({ media_status: "processing", updated_at: new Date().toISOString() })
    .eq("id", input.highlightId)
    .eq("league_id", context.leagueId)
    .eq("user_id", account.user_id)
    .in("media_status", ["uploading", "processing"])
    .select("id,media_status")
    .maybeSingle();
  if (updated.error) throw new ApiError(500, "Failed to update highlight upload status.", updated.error);
  if (!updated.data) throw new ApiError(404, "Highlight draft not found.");
  return { highlightId: updated.data.id, mediaStatus: updated.data.media_status };
}

type StreamWebhookBody = {
  uid?: string;
  readyToStream?: boolean;
  duration?: number;
  status?: { state?: string; errorReasonCode?: string; errorReasonText?: string };
  playback?: { hls?: string };
  input?: { height?: number; duration?: number };
};

function isDurationReject(body: StreamWebhookBody): boolean {
  const code = String(body.status?.errorReasonCode ?? "").toUpperCase();
  const text = String(body.status?.errorReasonText ?? "").toLowerCase();
  if (code.includes("DURATION") || text.includes("duration") || text.includes("maxduration")) return true;
  const duration = Number(body.duration ?? body.input?.duration ?? 0);
  return Number.isFinite(duration) && duration > HIGHLIGHT_MAX_DURATION_SECONDS;
}

export async function handleStreamWebhook(input: { rawBody: string; signatureHeader: string | undefined }) {
  if (!verifyStreamWebhookSignature(input.rawBody, input.signatureHeader)) {
    throw new ApiError(401, "Invalid Stream webhook signature.");
  }

  let body: StreamWebhookBody;
  try {
    body = JSON.parse(input.rawBody) as StreamWebhookBody;
  } catch {
    throw new ApiError(400, "Invalid Stream webhook JSON.");
  }

  const uid = body.uid?.trim();
  if (!uid) throw new ApiError(400, "Stream webhook missing uid.");

  const row = await supabase
    .from("rec_highlight_posts")
    .select("id,league_id,user_id,team_id,season_number,week_number,season_stage,discord_channel_id,discord_message_id,payout_review_id")
    .eq("cloudflare_stream_uid", uid)
    .maybeSingle();
  if (row.error) throw new ApiError(500, "Failed to load highlight for Stream webhook.", row.error);
  if (!row.data) return { ok: true, matched: false };

  const state = String(body.status?.state ?? "").toLowerCase();
  const now = new Date().toISOString();

  if (state === "error" || isDurationReject(body)) {
    await supabase
      .from("rec_highlight_posts")
      .update({ media_status: "failed", updated_at: now })
      .eq("id", row.data.id);
    await deleteStreamVideo(uid).catch((error) => {
      console.error(`[ERROR] Failed to delete rejected Stream video ${uid}:`, error);
    });
    return {
      ok: true,
      matched: true,
      mediaStatus: "failed",
      reason: isDurationReject(body) ? DURATION_REJECT_MESSAGE : undefined,
    };
  }

  if (state === "ready" || body.readyToStream) {
    const urls = streamPlaybackUrls(uid);
    const playbackUrl = body.playback?.hls ?? urls.hls;
    const maxHeight = body.input?.height && body.input.height > 0
      ? Math.min(HIGHLIGHT_MAX_HEIGHT, body.input.height)
      : HIGHLIGHT_MAX_HEIGHT;

    const updated = await supabase
      .from("rec_highlight_posts")
      .update({
        media_status: "ready",
        playback_url: playbackUrl,
        content: playbackUrl,
        max_height: maxHeight,
        updated_at: now,
      })
      .eq("id", row.data.id)
      .select("id,payout_review_id")
      .single();
    if (updated.error) throw new ApiError(500, "Failed to mark highlight ready.", updated.error);

    if (!updated.data.payout_review_id) {
      const league = await supabase.from("rec_leagues").select("game").eq("id", row.data.league_id).maybeSingle();
      const link = await supabase
        .from("rec_server_league_links")
        .select("server_id")
        .eq("league_id", row.data.league_id)
        .eq("is_primary", true)
        .maybeSingle();
      let guildId: string | null = null;
      let serverId: string | null = link.data?.server_id ?? null;
      if (serverId) {
        const server = await supabase.from("rec_discord_servers").select("guild_id").eq("id", serverId).maybeSingle();
        guildId = server.data?.guild_id ?? null;
      }
      const discordAccount = await supabase
        .from("rec_discord_accounts")
        .select("discord_id")
        .eq("user_id", row.data.user_id)
        .maybeSingle();
      await maybeCreateWeeklyPayoutReview({
        leagueId: row.data.league_id,
        highlightId: row.data.id,
        userId: row.data.user_id,
        teamId: row.data.team_id,
        seasonNumber: row.data.season_number,
        weekNumber: row.data.week_number,
        seasonStage: String(row.data.season_stage ?? "regular_season"),
        discordChannelId: row.data.discord_channel_id,
        discordMessageId: row.data.discord_message_id,
        game: league.data?.game ?? null,
        guildId,
        serverId,
        requesterDiscordId: discordAccount.data?.discord_id ?? null,
      }).catch((error) => console.error("[ERROR] Failed to create weekly payout review for Stream highlight:", error));
    }

    return { ok: true, matched: true, mediaStatus: "ready" };
  }

  await supabase
    .from("rec_highlight_posts")
    .update({ media_status: "processing", updated_at: now })
    .eq("id", row.data.id)
    .in("media_status", ["uploading", "processing"]);

  return { ok: true, matched: true, mediaStatus: "processing" };
}

export async function deleteStreamVideosForHighlights(
  posts: Array<{ cloudflare_stream_uid?: string | null }>,
): Promise<void> {
  const uids = [...new Set(posts.map((post) => post.cloudflare_stream_uid).filter((uid): uid is string => Boolean(uid)))];
  await Promise.all(uids.map(async (uid) => {
    try {
      await deleteStreamVideo(uid);
    } catch (error) {
      console.error(`[ERROR] Failed to delete Stream video ${uid}:`, error);
    }
  }));
}

export async function deleteAllLeagueStreamHighlights(leagueId: string): Promise<{ deleted: number }> {
  const posts = await supabase
    .from("rec_highlight_posts")
    .select("id,cloudflare_stream_uid")
    .eq("league_id", leagueId)
    .not("cloudflare_stream_uid", "is", null);
  if (posts.error) throw new ApiError(500, "Failed to list league Stream highlights.", posts.error);
  await deleteStreamVideosForHighlights(posts.data ?? []);
  if (posts.data?.length) {
    await supabase
      .from("rec_highlight_posts")
      .update({ media_status: "deleted", updated_at: new Date().toISOString() })
      .eq("league_id", leagueId)
      .not("cloudflare_stream_uid", "is", null);
  }
  return { deleted: posts.data?.length ?? 0 };
}

/** Copy mirrored / Discord CDN highlight URLs into Cloudflare Stream (batch). */
export async function migrateMirroredHighlightsToStream(input: {
  leagueId?: string | null;
  limit?: number;
}) {
  let query = supabase
    .from("rec_highlight_posts")
    .select("id,league_id,content,playback_url,cloudflare_stream_uid,storage_provider,media_status,hub_visible")
    .is("cloudflare_stream_uid", null)
    .not("content", "is", null)
    .neq("media_status", "deleted")
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(input.limit ?? 25, 1), 100));
  if (input.leagueId) query = query.eq("league_id", input.leagueId);

  const rows = await query;
  if (rows.error) throw new ApiError(500, "Failed to list mirrored highlights.", rows.error);

  const results: Array<{ highlightId: string; ok: boolean; error?: string; streamUid?: string }> = [];
  for (const row of rows.data ?? []) {
    const url = String(row.playback_url || row.content || "").trim();
    if (!url.startsWith("http")) {
      results.push({ highlightId: row.id, ok: false, error: "No public media URL." });
      continue;
    }
    try {
      const copied = await copyStreamFromUrl({
        url,
        meta: { highlightId: row.id, leagueId: row.league_id, migrated: "1" },
      });
      const urls = streamPlaybackUrls(copied.uid);
      const updated = await supabase
        .from("rec_highlight_posts")
        .update({
          cloudflare_stream_uid: copied.uid,
          storage_provider: "cloudflare_stream",
          media_status: "ready",
          playback_url: urls.hls,
          content: urls.hls,
          hub_visible: row.hub_visible === true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updated.error) throw updated.error;
      results.push({ highlightId: row.id, ok: true, streamUid: copied.uid });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[migrate-mirrored-highlights] ${row.id}: ${message}`);
      results.push({
        highlightId: row.id,
        ok: false,
        error: message,
      });
    }
  }

  return {
    attempted: results.length,
    succeeded: results.filter((row) => row.ok).length,
    failed: results.filter((row) => !row.ok).length,
    results,
  };
}
