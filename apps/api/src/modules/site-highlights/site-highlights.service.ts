import { ApiError } from "../../lib/errors.js";
import { streamPlaybackUrls } from "../../lib/cloudflare-stream.js";
import { supabase } from "../../lib/supabase.js";
import { reviewHighlightPayout } from "../highlights/highlights.service.js";
import {
  createHighlightDirectUpload,
  getHighlightUploadStatus,
  markHighlightUploadReceived,
  migrateMirroredHighlightsToStream as migrateMirroredHighlightsInternal,
} from "../media/media.service.js";
import { isLeagueCommissioner } from "../site-inbox/site-inbox.service.js";
import { requireLinkedRecUser } from "../site-leagues/site-leagues.service.js";

async function resolveLeagueGuild(leagueId: string): Promise<{ guildId: string; serverId: string }> {
  const link = await supabase
    .from("rec_server_league_links")
    .select("server_id")
    .eq("league_id", leagueId)
    .eq("is_primary", true)
    .maybeSingle();
  if (link.error) throw new ApiError(500, "Failed to resolve league Discord link.", link.error);
  if (!link.data?.server_id) throw new ApiError(404, "This league is not linked to a Discord server yet.");
  const server = await supabase
    .from("rec_discord_servers")
    .select("id,guild_id")
    .eq("id", link.data.server_id)
    .maybeSingle();
  if (server.error) throw new ApiError(500, "Failed to load Discord server.", server.error);
  if (!server.data?.guild_id) throw new ApiError(404, "Discord guild missing for this league.");
  return { guildId: server.data.guild_id, serverId: server.data.id };
}

async function requireLinkedDiscord(authUserId: string) {
  const user = await requireLinkedRecUser(authUserId);
  if (!user.username) {
    throw new ApiError(403, "Set a username on Account before uploading highlights.");
  }
  const discord = await supabase
    .from("rec_discord_accounts")
    .select("discord_id,user_id")
    .eq("user_id", user.recUserId)
    .maybeSingle();
  if (discord.error) throw new ApiError(500, "Failed to load Discord link.", discord.error);
  if (!discord.data?.discord_id) {
    throw new ApiError(403, "Link your Discord identity on Account before uploading highlights.");
  }
  return { ...user, discordId: discord.data.discord_id };
}

export async function createSiteHighlightDirectUpload(input: {
  authUserId: string;
  leagueId: string;
  gameId: string;
  fileName?: string | null;
}) {
  const linked = await requireLinkedDiscord(input.authUserId);
  const { guildId } = await resolveLeagueGuild(input.leagueId);
  return createHighlightDirectUpload({
    guildId,
    discordId: linked.discordId,
    gameId: input.gameId,
    fileName: input.fileName,
  });
}

export async function markSiteHighlightUploadReceived(input: {
  authUserId: string;
  leagueId: string;
  highlightId: string;
}) {
  const linked = await requireLinkedDiscord(input.authUserId);
  const { guildId } = await resolveLeagueGuild(input.leagueId);
  return markHighlightUploadReceived({
    guildId,
    discordId: linked.discordId,
    highlightId: input.highlightId,
  });
}

export async function getSiteHighlightUploadStatus(input: {
  authUserId: string;
  leagueId: string;
  highlightId: string;
}) {
  const linked = await requireLinkedDiscord(input.authUserId);
  const { guildId } = await resolveLeagueGuild(input.leagueId);
  return getHighlightUploadStatus({
    guildId,
    discordId: linked.discordId,
    highlightId: input.highlightId,
  });
}

export async function listSiteUploadableGames(input: {
  authUserId: string;
  leagueId: string;
}) {
  const linked = await requireLinkedDiscord(input.authUserId);
  const league = await supabase
    .from("rec_leagues")
    .select("id,current_week,season_number,season_stage")
    .eq("id", input.leagueId)
    .maybeSingle();
  if (league.error) throw new ApiError(500, "Failed to load league.", league.error);
  if (!league.data) throw new ApiError(404, "League not found.");

  const week = Number(league.data.current_week ?? 1);
  const games = await supabase
    .from("rec_games")
    .select("id,week_number,home_user_id,away_user_id,home_team_id,away_team_id")
    .eq("league_id", input.leagueId)
    .eq("week_number", week)
    .or(`home_user_id.eq.${linked.recUserId},away_user_id.eq.${linked.recUserId}`);
  if (games.error) throw new ApiError(500, "Failed to load matchups.", games.error);

  const teamIds = [...new Set((games.data ?? []).flatMap((g) => [g.home_team_id, g.away_team_id].filter(Boolean)))];
  const teams = teamIds.length
    ? await supabase.from("rec_teams").select("id,name").in("id", teamIds)
    : { data: [], error: null };
  if (teams.error) throw new ApiError(500, "Failed to load teams.", teams.error);
  const teamName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));

  return {
    weekNumber: week,
    seasonNumber: Number(league.data.season_number ?? 1),
    seasonStage: String(league.data.season_stage ?? "regular_season"),
    games: (games.data ?? []).map((game) => ({
      gameId: game.id,
      weekNumber: game.week_number,
      label: `${teamName.get(game.away_team_id) ?? "Away"} @ ${teamName.get(game.home_team_id) ?? "Home"}`,
    })),
  };
}

export async function listPendingSiteHighlightReviews(input: {
  authUserId: string;
  leagueId: string;
}) {
  const user = await requireLinkedRecUser(input.authUserId);
  if (!(await isLeagueCommissioner(input.leagueId, user.recUserId))) {
    throw new ApiError(403, "Only commissioners can review highlights.");
  }

  const inbox = await supabase
    .from("rec_commissioners_inbox")
    .select("id,header,summary,amount,source_id,payload,created_at,requester_user_id")
    .eq("league_id", input.leagueId)
    .eq("queue_type", "highlight")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  if (inbox.error) throw new ApiError(500, "Failed to load pending highlight reviews.", inbox.error);

  const reviewIds = (inbox.data ?? []).map((row) => row.source_id).filter(Boolean);
  const reviews = reviewIds.length
    ? await supabase
        .from("rec_highlight_payout_reviews")
        .select("id,amount,highlight_post_id,highlight_post:rec_highlight_posts(id,playback_url,cloudflare_stream_uid,media_status,content,user:rec_users(display_name,username))")
        .in("id", reviewIds)
    : { data: [], error: null };
  if (reviews.error) throw new ApiError(500, "Failed to load highlight review details.", reviews.error);
  const byReview = new Map<string, any>((reviews.data ?? []).map((row: any) => [String(row.id), row]));

  return {
    items: (inbox.data ?? []).map((row) => {
      const review = byReview.get(row.source_id);
      const post = review?.highlight_post;
      const streamUid = post?.cloudflare_stream_uid ?? null;
      return {
        inboxId: row.id,
        reviewId: row.source_id,
        header: row.header,
        summary: row.summary,
        amount: Number(row.amount ?? review?.amount ?? 0),
        createdAt: row.created_at,
        uploaderName: post?.user?.display_name ?? post?.user?.username ?? "Coach",
        mediaStatus: post?.media_status ?? null,
        playbackUrl: post?.playback_url ?? post?.content ?? null,
        iframeUrl: streamUid ? streamPlaybackUrls(streamUid).iframe : null,
        streamUid,
      };
    }),
  };
}

export async function reviewSiteHighlightPayout(input: {
  authUserId: string;
  leagueId: string;
  reviewId: string;
  action: "approve" | "deny";
  deniedReason?: string;
}) {
  const user = await requireLinkedRecUser(input.authUserId);
  if (!(await isLeagueCommissioner(input.leagueId, user.recUserId))) {
    throw new ApiError(403, "Only commissioners can review highlights.");
  }
  const discord = await supabase
    .from("rec_discord_accounts")
    .select("discord_id")
    .eq("user_id", user.recUserId)
    .maybeSingle();
  if (discord.error) throw new ApiError(500, "Failed to load commissioner Discord link.", discord.error);

  return reviewHighlightPayout({
    reviewId: input.reviewId,
    action: input.action,
    reviewedByDiscordId: discord.data?.discord_id ?? user.recUserId,
    deniedReason: input.deniedReason,
  });
}

/** Commissioner-gated wrapper around the internal Stream backfill. */
export async function migrateMirroredHighlightsToStream(input: {
  authUserId: string;
  leagueId?: string | null;
  limit?: number;
}) {
  const user = await requireLinkedRecUser(input.authUserId);
  if (input.leagueId) {
    if (!(await isLeagueCommissioner(input.leagueId, user.recUserId))) {
      throw new ApiError(403, "Only commissioners can migrate this league's highlights.");
    }
  }
  return migrateMirroredHighlightsInternal({
    leagueId: input.leagueId,
    limit: input.limit,
  });
}
