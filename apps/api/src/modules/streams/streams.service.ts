import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonId } from "../league-context/season.service.js";
import { closeWageringForGame } from "../wagers/wagers.service.js";
import { isDiscordOnlyUser } from "../subscriptions/discord-only.service.js";

const STREAM_PAYOUT_AMOUNT = 50;

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

export async function recordStreamPost(input: RecordStreamPostInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId);
  const assignment = await getActiveAssignment(context.leagueId, account.user_id);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);

  // A coach can only have one pending stream payout at a time across the league.
  // Issued/denied reviews no longer block a later weekly stream submission.
  const alreadyPending = await supabase
    .from("rec_stream_payout_reviews")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("user_id", account.user_id)
    .eq("status", "pending")
    .limit(1);

  if (alreadyPending.error) throw new ApiError(500, "Failed to check pending stream payouts.", alreadyPending.error);

  // Keep same-week idempotency for payouts that were already approved or issued.
  const alreadyPaidThisWeek = await supabase
    .from("rec_stream_payout_reviews")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("user_id", account.user_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .in("status", ["pending", "approved", "issued"])
    .limit(1);

  if (alreadyPaidThisWeek.error) throw new ApiError(500, "Failed to check stream payout status.", alreadyPaidThisWeek.error);

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

  if ((alreadyPending.data ?? []).length > 0) {
    return { recorded: true, alreadyPending: true, lockedGameId, streamLog: streamLog.data };
  }

  if ((alreadyPaidThisWeek.data ?? []).length > 0) {
    return { recorded: true, alreadyPaid: true, lockedGameId, streamLog: streamLog.data, economyEligible: true };
  }

  // Discord-only users can post streams but do not enter payout review.
  if (await isDiscordOnlyUser(account.user_id)) {
    return { recorded: true, economyEligible: false, payoutEligible: false, lockedGameId, streamLog: streamLog.data };
  }

  // Every stream (link or Discord Live) is eligible for one payout per week.
  const review = await supabase
    .from("rec_stream_payout_reviews")
    .insert({
      stream_log_id: streamLog.data.id,
      league_id: context.leagueId,
      user_id: account.user_id,
      team_id: assignment?.team_id ?? null,
      season_number: seasonNumber,
      week_number: weekNumber,
      status: "pending",
      amount: STREAM_PAYOUT_AMOUNT,
      discord_channel_id: input.discordChannelId,
      discord_message_id: input.discordMessageId
    })
    .select("*")
    .single();

  if (review.error) {
    if (review.error.code === "23505") {
      return { recorded: true, alreadyPaid: true, lockedGameId, streamLog: streamLog.data };
    }
    throw new ApiError(500, "Failed to create stream payout review.", review.error);
  }

  await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: context.leagueId,
    season_number: seasonNumber,
    week_number: weekNumber,
    queue_type: "stream",
    status: "pending",
    priority: 0,
    header: `Stream: Wk ${weekNumber}`,
    summary: `Stream submitted by <@${input.discordId}>.`,
    requester_discord_id: input.discordId,
    requester_user_id: account.user_id,
    amount: STREAM_PAYOUT_AMOUNT,
    source_table: "rec_stream_payout_reviews",
    source_id: review.data.id,
    payload: { reviewId: review.data.id, streamLogId: streamLog.data.id },
  });

  return {
    recorded: true,
    needsReview: true,
    review: review.data,
    streamLog: streamLog.data,
    lockedGameId,
    watchPath: `/v1/hub/streams/open/${streamLog.data.id}`,
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
    commissionerRoleId: (context.routes as any)?.commissioner_role_id ?? null,
    compCommitteeRoleId: (context.routes as any)?.comp_committee_role_id ?? null
  };
}

export async function reviewStreamPayout(input: ReviewStreamPayoutInput) {
  const existing = await supabase
    .from("rec_stream_payout_reviews")
    .select("*,stream_log:rec_stream_compliance_logs(*)")
    .eq("id", input.reviewId)
    .maybeSingle();

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
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: existing.data.user_id,
    p_amount: amount,
    p_league_id: existing.data.league_id,
    p_description: `Discord Live stream payout - Wk ${existing.data.week_number}`,
    p_transaction_type: "stream_payout",
    p_source: "stream",
    p_source_reference: {
      reviewId: existing.data.id,
      streamLogId: existing.data.stream_log_id
    }
  });
  if (ledger.error) throw new ApiError(500, "Failed to issue stream payout.", ledger.error);

  const approved = await supabase
    .from("rec_stream_payout_reviews")
    .update({
      status: "issued",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      issued_ledger_id: ledger.data,
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
