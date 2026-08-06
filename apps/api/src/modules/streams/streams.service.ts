import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { resolveChatAuthor } from "../../lib/chat-identity.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { closeWageringForGame } from "../wagers/wagers.service.js";
import { isDiscordOnlyUser } from "../subscriptions/discord-only.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";

const STREAM_PAYOUT_AMOUNT = 50;

// Site<->Discord stream mirroring — used by both the Discord stream command
// (recordStreamPost) and the site's share-stream flow (shareHubMatchupStream in
// hub.service.ts), so either surface notifies the same places.

// Posts a stream link into the league's configured Discord streams channel, if the league is
// linked to a Discord server and has one configured. `routes` is whatever
// getCurrentLeagueContext(guildId).routes already returned to the caller — no extra guild
// lookup needed since callers already have it. No-op (not an error) when unconfigured/unlinked.
export async function postStreamToDiscordChannel(routes: Record<string, unknown> | null, content: string): Promise<void> {
  const channelId = typeof routes?.streams_channel_id === "string" ? routes.streams_channel_id : null;
  if (!channelId) return;
  await postDiscordChannelMessage(channelId, { content, allowed_mentions: { parse: [] } });
}

// Away/home team names + the H2H-vs-CPU two-way label (matches the convention already used in
// the bot's schedule embeds — apps/bot/src/handlers/stream.ts's boldUserTeam) for a given game,
// shared by both stream-submission surfaces so the derivation only lives in one place.
export async function deriveStreamMatchupContext(leagueId: string, gameId: string): Promise<{ awayTeamName: string; homeTeamName: string; matchupLabel: "H2H" | "CPU" } | null> {
  const game = await supabase.from("rec_games").select("home_team_id,away_team_id,home_user_id,away_user_id").eq("id", gameId).eq("league_id", leagueId).maybeSingle();
  if (game.error || !game.data) return null;
  const teamIds = [game.data.home_team_id, game.data.away_team_id].filter(Boolean);
  const teams = teamIds.length
    ? await supabase.from("rec_teams").select("id,name").in("id", teamIds)
    : { data: [] as any[], error: null };
  if (teams.error) return null;
  const nameById = new Map<string, string>((teams.data ?? []).map((team: any) => [team.id, team.name]));
  return {
    awayTeamName: nameById.get(game.data.away_team_id) ?? "Away",
    homeTeamName: nameById.get(game.data.home_team_id) ?? "Home",
    matchupLabel: game.data.home_user_id && game.data.away_user_id ? "H2H" : "CPU",
  };
}

// Public "someone's live" notice mirrored into the league-wide site chat, regardless of which
// surface (Discord or site) the stream was submitted from.
export async function postLeagueChatStreamNotice(input: {
  leagueId: string;
  seasonNumber: number;
  awayTeamName: string;
  homeTeamName: string;
  matchupLabel: "H2H" | "CPU";
  posterDisplayName: string;
  url: string;
}): Promise<void> {
  const body = `🔴 **${input.matchupLabel}** — ${input.awayTeamName} at ${input.homeTeamName}: ${input.posterDisplayName} is live! ${input.url}`;
  const { error } = await supabase.from("rec_league_chat_messages").insert({
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    author_user_id: null,
    author_discord_id: null,
    author_display_name: "REC Bot",
    is_discord_only: false,
    body,
  });
  if (error) throw error;
}

type RecordStreamPostInput = {
  guildId: string;
  discordId: string;
  discordChannelId: string;
  discordMessageId: string;
  messageUrl?: string | null;
  content?: string | null;
  service?: string | null;
  submissionType?: "link" | "discord_live" | null;
};

type ReviewStreamPayoutInput = {
  reviewId: string;
  leagueId?: string | null;
  action: "approve" | "deny";
  reviewedByDiscordId: string;
  deniedReason?: string | null;
};

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

async function closeGameMarketsAfterStream(input: { guildId: string; leagueId: string; seasonNumber: number; weekNumber: number; teamId: string | null }) {
  if (!input.teamId) return null;
  const seasonId = await resolveSeasonId(input.leagueId, input.seasonNumber);
  const game = await supabase.from("rec_games").select("id")
    .eq("league_id", input.leagueId).eq("season_id", seasonId).eq("week_number", input.weekNumber)
    .or(`home_team_id.eq.${input.teamId},away_team_id.eq.${input.teamId}`).maybeSingle();
  if (game.error) throw new ApiError(500, "Failed to locate streamed matchup.", game.error);
  if (!game.data?.id) return null;
  await Promise.all([
    closeWageringForGame({ guildId: input.guildId, gameId: game.data.id }),
    supabase.from("rec_game_of_week_polls")
      .update({ status: "closed", closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("league_id", input.leagueId).eq("game_id", game.data.id).eq("status", "open"),
  ]);
  return game.data.id;
}

type CreateStreamPayoutReviewInput = {
  guildId: string;
  leagueId: string;
  userId: string;
  discordId: string;
  teamId: string | null;
  streamLogId: string;
  seasonNumber: number;
  weekNumber: number;
  discordChannelId?: string | null;
  discordMessageId?: string | null;
};

type CreateStreamPayoutReviewResult =
  | { created: false; reason: "already_pending" | "already_paid" | "discord_only" }
  | { created: true; review: any };

// Shared eligibility-check + payout-review + commissioner-inbox creation, used by both the
// Discord stream command (recordStreamPost) and the site's share-stream flow
// (shareHubMatchupStream) so a stream submitted from either surface gets the same $50 review —
// this does NOT insert the rec_stream_compliance_logs row itself; callers do that first (their
// insert shapes differ) and pass in the resulting streamLogId.
export async function createStreamPayoutReview(input: CreateStreamPayoutReviewInput): Promise<CreateStreamPayoutReviewResult> {
  // A coach can only have one pending stream payout at a time across the league.
  // Issued/denied reviews no longer block a later weekly stream submission.
  const alreadyPending = await supabase
    .from("rec_stream_payout_reviews")
    .select("id")
    .eq("league_id", input.leagueId)
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .limit(1);
  if (alreadyPending.error) throw new ApiError(500, "Failed to check pending stream payouts.", alreadyPending.error);
  if ((alreadyPending.data ?? []).length > 0) return { created: false, reason: "already_pending" };

  // Keep same-week idempotency for payouts that were already approved or issued.
  const alreadyPaidThisWeek = await supabase
    .from("rec_stream_payout_reviews")
    .select("id")
    .eq("league_id", input.leagueId)
    .eq("user_id", input.userId)
    .eq("season_number", input.seasonNumber)
    .eq("week_number", input.weekNumber)
    .in("status", ["pending", "approved", "issued"])
    .limit(1);
  if (alreadyPaidThisWeek.error) throw new ApiError(500, "Failed to check stream payout status.", alreadyPaidThisWeek.error);
  if ((alreadyPaidThisWeek.data ?? []).length > 0) return { created: false, reason: "already_paid" };

  // Discord-only users can post streams but do not enter payout review.
  if (await isDiscordOnlyUser(input.userId)) return { created: false, reason: "discord_only" };

  const review = await supabase
    .from("rec_stream_payout_reviews")
    .insert({
      stream_log_id: input.streamLogId,
      league_id: input.leagueId,
      user_id: input.userId,
      team_id: input.teamId ?? null,
      season_number: input.seasonNumber,
      week_number: input.weekNumber,
      status: "pending",
      amount: STREAM_PAYOUT_AMOUNT,
      discord_channel_id: input.discordChannelId ?? null,
      discord_message_id: input.discordMessageId ?? null,
    })
    .select("*")
    .single();

  if (review.error) {
    if (review.error.code === "23505") return { created: false, reason: "already_paid" };
    throw new ApiError(500, "Failed to create stream payout review.", review.error);
  }

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: input.leagueId,
    season_number: input.seasonNumber,
    week_number: input.weekNumber,
    queue_type: "stream",
    status: "pending",
    priority: 0,
    header: `Stream: Wk ${input.weekNumber}`,
    summary: `Stream submitted by <@${input.discordId}>.`,
    requester_discord_id: input.discordId,
    requester_user_id: input.userId,
    amount: STREAM_PAYOUT_AMOUNT,
    source_table: "rec_stream_payout_reviews",
    source_id: review.data.id,
    payload: { reviewId: review.data.id, streamLogId: input.streamLogId },
  });
  void notifyLeagueCommissionersOfPendingItem(input.leagueId);

  return { created: true, review: review.data };
}

export async function recordStreamPost(input: RecordStreamPostInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId);
  const assignment = await getActiveAssignment(context.leagueId, account.user_id);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);

  const streamLog = await supabase
    .from("rec_stream_compliance_logs")
    .insert({
      league_id: context.leagueId,
      season_number: seasonNumber,
      week_number: weekNumber,
      user_id: account.user_id,
      team_id: assignment?.team_id ?? null,
      discord_channel_id: input.discordChannelId,
      discord_message_id: input.discordMessageId,
      message_url: input.messageUrl ?? null,
      posted_at: new Date().toISOString(),
      required: false,
      complied: true,
      status: "posted",
      details: {
        service: input.service ?? null,
        submissionType: input.submissionType ?? null,
        content: input.content ?? null
      }
    })
    .select("*")
    .single();

  if (streamLog.error) throw new ApiError(500, "Failed to record stream post.", streamLog.error);

  const lockedGameId = await closeGameMarketsAfterStream({
    guildId: input.guildId,
    leagueId: context.leagueId,
    seasonNumber,
    weekNumber,
    teamId: assignment?.team_id ?? null,
  });

  // rec_stream_compliance_logs.game_id was never set on insert (this was the only place that
  // resolved it) — the hub's "Live Games" card joins through game_id to show real team names,
  // so without this it always fell back to the literal "Away"/"Home" placeholder. Best-effort:
  // a failure here shouldn't block the stream post itself.
  if (lockedGameId) {
    await supabase.from("rec_stream_compliance_logs").update({ game_id: lockedGameId }).eq("id", streamLog.data.id)
      .then(({ error }) => { if (error) console.error("[ERROR] Failed to backfill stream log game_id (non-fatal):", error); });
  }

  // Best-effort public notice on the league chat — never blocks the stream post itself.
  if (lockedGameId) {
    void (async () => {
      const matchupContext = await deriveStreamMatchupContext(context.leagueId, lockedGameId);
      if (!matchupContext) return;
      const author = await resolveChatAuthor(input.discordId);
      await postLeagueChatStreamNotice({
        leagueId: context.leagueId,
        seasonNumber,
        awayTeamName: matchupContext.awayTeamName,
        homeTeamName: matchupContext.homeTeamName,
        matchupLabel: matchupContext.matchupLabel,
        posterDisplayName: author.displayName,
        url: input.messageUrl ?? "Discord Live",
      });
    })().catch((error) => console.error("[ERROR] Failed to post league-chat stream notice (non-fatal):", error));
  }

  const payout = await createStreamPayoutReview({
    guildId: input.guildId,
    leagueId: context.leagueId,
    userId: account.user_id,
    discordId: input.discordId,
    teamId: assignment?.team_id ?? null,
    streamLogId: streamLog.data.id,
    seasonNumber,
    weekNumber,
    discordChannelId: input.discordChannelId,
    discordMessageId: input.discordMessageId,
  });

  if (!payout.created) {
    if (payout.reason === "already_pending") return { recorded: true, alreadyPending: true, lockedGameId, streamLog: streamLog.data };
    if (payout.reason === "already_paid") return { recorded: true, alreadyPaid: true, lockedGameId, streamLog: streamLog.data, economyEligible: true };
    return { recorded: true, economyEligible: false, payoutEligible: false, lockedGameId, streamLog: streamLog.data };
  }

  return {
    recorded: true,
    needsReview: true,
    review: payout.review,
    streamLog: streamLog.data,
    lockedGameId,
    watchPath: `/v1/hub/streams/open/${streamLog.data.id}`,
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
    commissionerRoleId: (context.routes as any)?.commissioner_role_id ?? null,
    compCommitteeRoleId: (context.routes as any)?.comp_committee_role_id ?? null
  };
}

export async function reviewStreamPayout(input: ReviewStreamPayoutInput) {
  let reviewQuery = supabase
    .from("rec_stream_payout_reviews")
    .select("*,stream_log:rec_stream_compliance_logs(*)")
    .eq("id", input.reviewId)
  if (input.leagueId) reviewQuery = reviewQuery.eq("league_id", input.leagueId);
  const existing = await reviewQuery.maybeSingle();

  if (existing.error) throw new ApiError(500, "Failed to load stream payout review.", existing.error);
  if (!existing.data) throw new ApiError(404, "Stream payout review was not found.");
  if (existing.data.status !== "pending") {
    return { updated: false, reason: `Review is already ${existing.data.status}.`, review: existing.data, streamLog: existing.data.stream_log };
  }

  if (input.action === "deny") {
    const denied = await supabase
      .from("rec_stream_payout_reviews")
      .update({
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        denied_reason: input.deniedReason ?? "Denied by commissioner review.",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", input.reviewId)
      .select("*,stream_log:rec_stream_compliance_logs(*)")
      .single();

    if (denied.error) throw new ApiError(500, "Failed to deny stream payout review.", denied.error);
    await supabase
      .from("rec_commissioners_inbox")
      .update({
        status: "denied",
        reviewed_by_discord_id: input.reviewedByDiscordId,
        reviewed_at: denied.data.reviewed_at,
        review_reason: denied.data.denied_reason ?? null,
      })
      .eq("source_table", "rec_stream_payout_reviews")
      .eq("source_id", input.reviewId);
    return { updated: true, review: denied.data, streamLog: denied.data.stream_log };
  }

  const amount = Number(existing.data.amount ?? STREAM_PAYOUT_AMOUNT);
  const credit = await creditOrBacklog({
    leagueId: existing.data.league_id,
    seasonNumber: existing.data.season_number,
    userId: existing.data.user_id,
    amount,
    description: `Discord Live stream payout - Wk ${existing.data.week_number}`,
    transactionType: "stream_payout",
    source: "stream",
    sourceReference: {
      reviewId: existing.data.id,
      streamLogId: existing.data.stream_log_id
    }
  });

  const approved = await supabase
    .from("rec_stream_payout_reviews")
    .update({
      status: "issued",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      issued_ledger_id: credit.ledgerId,
      reviewed_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", input.reviewId)
    .select("*,stream_log:rec_stream_compliance_logs(*)")
    .single();

  if (approved.error) throw new ApiError(500, "Failed to approve stream payout review.", approved.error);

  await supabase
    .from("rec_commissioners_inbox")
    .update({
      status: "approved",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      reviewed_at: approved.data.reviewed_at,
    })
    .eq("source_table", "rec_stream_payout_reviews")
    .eq("source_id", input.reviewId);

  const streamer = await supabase
    .from("rec_discord_accounts")
    .select("discord_id")
    .eq("user_id", existing.data.user_id)
    .maybeSingle();

  return {
    updated: true,
    review: approved.data,
    streamLog: approved.data.stream_log,
    amount,
    streamerDiscordId: streamer.data?.discord_id ?? null
  };
}
