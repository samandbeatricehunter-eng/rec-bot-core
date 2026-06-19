import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

const STREAM_PAYOUT_AMOUNT = 25;

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

export async function recordStreamPost(input: RecordStreamPostInput) {
  const context = await getCurrentLeagueContext(input.guildId);
  const account = await getDiscordAccount(input.discordId);
  const assignment = await getActiveAssignment(context.leagueId, account.user_id);
  const seasonNumber = Number(context.rec_leagues.season_number ?? context.rec_leagues.display_season_number ?? 1);
  const weekNumber = Number(context.rec_leagues.current_week ?? 1);

  const alreadyPaid = await supabase
    .from("rec_stream_payout_reviews")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("user_id", account.user_id)
    .eq("season_number", seasonNumber)
    .eq("week_number", weekNumber)
    .in("status", ["approved", "issued"])
    .limit(1);

  if (alreadyPaid.error) throw new ApiError(500, "Failed to check stream payout status.", alreadyPaid.error);

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

  if ((alreadyPaid.data ?? []).length > 0) {
    return { recorded: true, alreadyPaid: true, streamLog: streamLog.data };
  }

  if (input.submissionType !== "discord_live") {
    return { recorded: true, streamLog: streamLog.data };
  }

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

  if (review.error) throw new ApiError(500, "Failed to create stream payout review.", review.error);

  return {
    recorded: true,
    needsReview: true,
    review: review.data,
    streamLog: streamLog.data,
    pendingPayoutsChannelId: (context.routes as any)?.pending_payouts_channel_id ?? null,
    commissionerRoleId: (context.routes as any)?.commissioner_role_id ?? null,
    compCommitteeRoleId: (context.routes as any)?.comp_committee_role_id ?? null
  };
}

export async function reviewStreamPayout(input: ReviewStreamPayoutInput) {
  const existing = await supabase
    .from("rec_stream_payout_reviews")
    .select("*,streamLog:rec_stream_compliance_logs(*)")
    .eq("id", input.reviewId)
    .maybeSingle();

  if (existing.error) throw new ApiError(500, "Failed to load stream payout review.", existing.error);
  if (!existing.data) throw new ApiError(404, "Stream payout review was not found.");
  if (existing.data.status !== "pending") {
    return { updated: false, reason: `Review is already ${existing.data.status}.`, review: existing.data, streamLog: existing.data.streamLog };
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
      .select("*,streamLog:rec_stream_compliance_logs(*)")
      .single();

    if (denied.error) throw new ApiError(500, "Failed to deny stream payout review.", denied.error);
    return { updated: true, review: denied.data, streamLog: denied.data.streamLog };
  }

  const amount = Number(existing.data.amount ?? STREAM_PAYOUT_AMOUNT);
  const wallet = await supabase
    .from("rec_wallets")
    .select("wallet_balance,savings_balance")
    .eq("user_id", existing.data.user_id)
    .maybeSingle();

  if (wallet.error) throw new ApiError(500, "Failed to load wallet for stream payout.", wallet.error);

  const walletBalance = Number(wallet.data?.wallet_balance ?? 0);
  const savingsBalance = Number(wallet.data?.savings_balance ?? 0);
  const updatedWallet = await supabase
    .from("rec_wallets")
    .upsert({
      user_id: existing.data.user_id,
      wallet_balance: walletBalance + amount,
      savings_balance: savingsBalance,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });

  if (updatedWallet.error) throw new ApiError(500, "Failed to issue stream payout.", updatedWallet.error);

  const ledger = await supabase
    .from("rec_dollar_ledger")
    .insert({
      user_id: existing.data.user_id,
      league_id: existing.data.league_id,
      amount,
      transaction_type: "stream_payout",
      description: "Discord Live stream payout",
      source: "manual_admin_entry",
      source_reference: {
        streamReviewId: existing.data.id,
        streamLogId: existing.data.stream_log_id,
        reviewedByDiscordId: input.reviewedByDiscordId
      }
    })
    .select("id")
    .single();

  if (ledger.error) throw new ApiError(500, "Failed to write stream payout ledger entry.", ledger.error);

  const approved = await supabase
    .from("rec_stream_payout_reviews")
    .update({
      status: "issued",
      reviewed_by_discord_id: input.reviewedByDiscordId,
      issued_ledger_id: ledger.data.id,
      reviewed_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", input.reviewId)
    .select("*,streamLog:rec_stream_compliance_logs(*)")
    .single();

  if (approved.error) throw new ApiError(500, "Failed to approve stream payout review.", approved.error);
  return { updated: true, review: approved.data, streamLog: approved.data.streamLog };
}
