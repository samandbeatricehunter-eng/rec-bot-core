import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";

async function resolveLeagueUser(guildId: string, discordId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const account = await supabase
    .from("rec_discord_accounts")
    .select("user_id,discord_id")
    .eq("discord_id", discordId)
    .maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load Discord account.", account.error);
  if (!account.data?.user_id) throw new ApiError(404, "That Discord user is not registered.");

  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", context.leagueId)
    .eq("user_id", account.data.user_id)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to verify active team link.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(400, "That user is not actively linked to a team in this league.");

  return { context, userId: account.data.user_id, teamId: assignment.data.team_id };
}

export async function listReversibleTransactions(input: { guildId: string; discordId: string }) {
  const { context, userId } = await resolveLeagueUser(input.guildId, input.discordId);
  const txns = await supabase
    .from("rec_dollar_ledger")
    .select("id,amount,transaction_type,description,source,source_reference,created_at")
    .eq("league_id", context.leagueId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (txns.error) throw new ApiError(500, "Failed to load reversible transactions.", txns.error);

  const reversedIds = new Set(
    (txns.data ?? [])
      .map((row: any) => row.source_reference?.reversedLedgerId)
      .filter(Boolean),
  );
  return {
    userId,
    transactions: (txns.data ?? []).map((row: any) => ({
      ...row,
      reversible: Number(row.amount ?? 0) !== 0 && row.transaction_type !== "admin_reversal" && !reversedIds.has(row.id),
    })),
  };
}

export async function reverseTransaction(input: { guildId: string; discordId: string; ledgerId: string; requestedByDiscordId: string }) {
  const { context, userId } = await resolveLeagueUser(input.guildId, input.discordId);
  const existing = await supabase
    .from("rec_dollar_ledger")
    .select("*")
    .eq("id", input.ledgerId)
    .eq("league_id", context.leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load transaction.", existing.error);
  if (!existing.data) throw new ApiError(404, "Transaction not found.");
  if (String(existing.data.transaction_type ?? "") === "admin_reversal") throw new ApiError(400, "Reversal transactions cannot be reversed.");

  const already = await supabase
    .from("rec_dollar_ledger")
    .select("id")
    .eq("league_id", context.leagueId)
    .eq("user_id", userId)
    .eq("transaction_type", "admin_reversal")
    .contains("source_reference", { reversedLedgerId: input.ledgerId })
    .limit(1);
  if (already.error) throw new ApiError(500, "Failed to check existing reversal.", already.error);
  if ((already.data ?? []).length) throw new ApiError(409, "That transaction has already been reversed.");

  const amount = -Number(existing.data.amount ?? 0);
  if (!Number.isFinite(amount) || amount === 0) throw new ApiError(400, "Only non-zero wallet transactions can be reversed.");
  const ledger = await supabase.rpc("add_to_wallet", {
    p_user_id: userId,
    p_amount: amount,
    p_league_id: context.leagueId,
    p_description: `Admin reversal of ${existing.data.transaction_type ?? "transaction"}`,
    p_transaction_type: "admin_reversal",
    p_source: "admin_correction",
    p_source_reference: {
      reversedLedgerId: input.ledgerId,
      requestedByDiscordId: input.requestedByDiscordId,
      originalAmount: Number(existing.data.amount ?? 0),
      originalType: existing.data.transaction_type ?? null,
    },
  });
  if (ledger.error) throw new ApiError(500, "Failed to reverse transaction.", ledger.error);

  return { reversed: true, ledgerId: ledger.data, amount, original: existing.data };
}
