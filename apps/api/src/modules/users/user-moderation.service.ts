import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import {
  addMemberRole,
  applySuspendedRoleMuteOnCategory,
  ensureManagedRoleId,
  removeMemberRole,
} from "../../lib/discord-guild.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { recordUserActivity } from "./user-activity.service.js";
import { listUserActivityEvents } from "./user-activity.service.js";

async function userIdFromDiscord(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't look up that Discord account.", account.error);
  if (!account.data?.user_id) throw new ApiError(404, "That Discord account is not linked to a REC user.");
  return account.data.user_id as string;
}

async function discordIdForUser(userId: string) {
  const account = await supabase.from("rec_discord_accounts").select("discord_id").eq("user_id", userId).maybeSingle();
  if (account.error) throw new ApiError(500, "We couldn't look up that user's Discord id.", account.error);
  return account.data?.discord_id ? String(account.data.discord_id) : null;
}

async function assertTeamUserInLeague(leagueId: string, teamId: string, userId: string) {
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("id")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't verify that team link.", assignment.error);
  if (!assignment.data) throw new ApiError(404, "That user is not linked to this team.");
}

export async function getManageUserActivityLog(input: { guildId: string; teamId: string; userId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  await assertTeamUserInLeague(context.leagueId, input.teamId, input.userId);
  return listUserActivityEvents({ leagueId: context.leagueId, userId: input.userId, limit: 25 });
}

export async function getManageUserTransactions(input: { guildId: string; teamId: string; userId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  await assertTeamUserInLeague(context.leagueId, input.teamId, input.userId);

  const [walletRes, ledgerRes, pendingPurchasesRes, pendingInboxRes] = await Promise.all([
    supabase.from("rec_wallets").select("wallet_balance,savings_balance").eq("user_id", input.userId).maybeSingle(),
    supabase
      .from("rec_dollar_ledger")
      .select("id,amount,transaction_type,description,created_at")
      .eq("league_id", context.leagueId)
      .eq("user_id", input.userId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("rec_purchases")
      .select("id,purchase_type,status,cost,created_at")
      .eq("league_id", context.leagueId)
      .eq("user_id", input.userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("rec_commissioners_inbox")
      .select("id,queue_type,header,status,created_at")
      .eq("league_id", context.leagueId)
      .eq("requester_user_id", input.userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  if (walletRes.error) throw new ApiError(500, "We couldn't load wallet balances.", walletRes.error);
  if (ledgerRes.error) throw new ApiError(500, "We couldn't load transactions.", ledgerRes.error);
  // purchases / inbox tables may vary by league type — degrade empty on missing/error
  const pendingPurchases = pendingPurchasesRes.error ? [] : (pendingPurchasesRes.data ?? []);
  const pendingInbox = pendingInboxRes.error ? [] : (pendingInboxRes.data ?? []);

  return {
    wallet: {
      walletBalance: Number(walletRes.data?.wallet_balance ?? 0),
      savingsBalance: Number(walletRes.data?.savings_balance ?? 0),
    },
    transactions: (ledgerRes.data ?? []).map((row: any) => ({
      id: row.id as string,
      amount: Number(row.amount ?? 0),
      transactionType: (row.transaction_type as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      createdAt: row.created_at as string,
    })),
    pending: {
      purchases: pendingPurchases.map((row: any) => ({
        id: row.id as string,
        purchaseType: (row.purchase_type as string | null) ?? null,
        status: row.status as string,
        amount: row.cost != null ? Number(row.cost) : null,
        createdAt: row.created_at as string,
      })),
      inbox: pendingInbox.map((row: any) => ({
        id: row.id as string,
        queueType: row.queue_type as string,
        header: (row.header as string | null) ?? null,
        createdAt: row.created_at as string,
      })),
    },
  };
}

async function applySuspendedDiscordState(guildId: string, leagueId: string, userId: string) {
  const discordId = await discordIdForUser(userId);
  if (!discordId) {
    throw new ApiError(400, "That user has no linked Discord account, so the SUSPENDED Discord role cannot be applied.");
  }

  // Find-or-create the real Discord guild role named "SUSPENDED", then grant it to the member.
  const roleId = await ensureManagedRoleId(guildId, "suspended");
  await addMemberRole(guildId, discordId, roleId, "REC Manage Users — Discord SUSPENDED role");

  const context = await getCurrentLeagueContext(guildId);
  const categoryId = String((context.routes as any)?.game_channels_category_id ?? "");
  if (categoryId) {
    await applySuspendedRoleMuteOnCategory(categoryId, roleId).catch((error) => {
      console.error("[ERROR] Failed to mute SUSPENDED Discord role on game-channels category (non-fatal):", error);
    });
  } else {
    // No category configured — mute each open Discord game channel for this coach.
    const channels = await supabase
      .from("rec_game_channels")
      .select("discord_channel_id, game_id")
      .not("discord_channel_id", "is", null);
    const gameIds = [...new Set((channels.data ?? []).map((row: any) => row.game_id).filter(Boolean))];
    const games = gameIds.length
      ? await supabase.from("rec_games").select("id,home_user_id,away_user_id").eq("league_id", leagueId).in("id", gameIds)
      : { data: [] as any[], error: null };
    const relevant = new Set(
      (games.data ?? [])
        .filter((g: any) => g.home_user_id === userId || g.away_user_id === userId)
        .map((g: any) => g.id as string),
    );
    for (const row of channels.data ?? []) {
      if (!relevant.has(row.game_id)) continue;
      const channelId = String(row.discord_channel_id ?? "");
      if (!channelId) continue;
      await applySuspendedRoleMuteOnCategory(channelId, roleId).catch(() => undefined);
    }
  }

  return { discordId, roleId };
}

async function clearSuspendedDiscordState(guildId: string, userId: string) {
  const discordId = await discordIdForUser(userId);
  if (!discordId) return;
  const roleId = await ensureManagedRoleId(guildId, "suspended").catch(() => null);
  if (!roleId) return;
  await removeMemberRole(guildId, discordId, roleId, "REC suspension completed / cleared").catch((error) => {
    console.error("[ERROR] Failed to remove SUSPENDED role (non-fatal):", error);
  });
}

export async function suspendManageUser(input: {
  guildId: string;
  teamId: string;
  userId: string;
  advances: number;
  reason: string;
  requestedByDiscordId: string;
}) {
  const advances = Math.floor(Number(input.advances));
  if (!Number.isFinite(advances) || advances < 1 || advances > 52) {
    throw new ApiError(400, "Suspension length must be between 1 and 52 advances.");
  }
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw new ApiError(400, "Enter a short suspension reason.");

  const context = await getCurrentLeagueContext(input.guildId);
  await assertTeamUserInLeague(context.leagueId, input.teamId, input.userId);
  const actorUserId = await userIdFromDiscord(input.requestedByDiscordId).catch(() => null);

  // Deactivate any prior active rows for this user in the league
  await supabase
    .from("rec_user_suspensions")
    .update({ active: false })
    .eq("league_id", context.leagueId)
    .eq("user_id", input.userId)
    .eq("active", true);

  const startsAt = new Date();
  // Calendar end is a backstop only; remaining_advances is authoritative for Manage Users.
  const endsAt = new Date(startsAt.getTime() + advances * 14 * 24 * 60 * 60 * 1000);
  const id = randomUUID();

  // Discord role first — if grant fails, do not leave a DB-only suspension active.
  await applySuspendedDiscordState(input.guildId, context.leagueId, input.userId);

  const insert = await supabase.from("rec_user_suspensions").insert({
    id,
    league_id: context.leagueId,
    user_id: input.userId,
    reason,
    weeks: advances,
    remaining_advances: advances,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    created_by_user_id: actorUserId,
    active: true,
    created_at: startsAt.toISOString(),
  });
  if (insert.error) {
    await clearSuspendedDiscordState(input.guildId, input.userId);
    throw new ApiError(500, "Failed to record the suspension.", insert.error);
  }

  await recordUserActivity({
    leagueId: context.leagueId,
    userId: input.userId,
    teamId: input.teamId,
    actionKey: "suspended",
    summary: `Suspended for ${advances} advance${advances === 1 ? "" : "s"}: ${reason}`,
    metadata: { advances, reason, suspensionId: id },
  });
  await writeAuditLog({
    action: "user.suspended.manage_users",
    entityType: "rec_user_suspensions",
    entityId: id,
    newValue: { userId: input.userId, teamId: input.teamId, advances, reason },
    reason: `Suspended by discord:${input.requestedByDiscordId}`,
    source: "manual_admin_entry",
  });

  return { suspended: true, suspensionId: id, remainingAdvances: advances, endsAt: endsAt.toISOString() };
}

/** Decrement advance-based suspensions after a successful league advance. */
export async function tickSuspensionsOnAdvance(input: { leagueId: string; guildId: string }) {
  const active = await supabase
    .from("rec_user_suspensions")
    .select("id,user_id,remaining_advances,reason")
    .eq("league_id", input.leagueId)
    .eq("active", true)
    .not("remaining_advances", "is", null);
  if (active.error) {
    console.error("[ERROR] Failed to load advance-based suspensions:", active.error);
    return { ticked: 0, cleared: 0 };
  }

  let ticked = 0;
  let cleared = 0;
  for (const row of active.data ?? []) {
    const remaining = Number(row.remaining_advances ?? 0) - 1;
    ticked += 1;
    if (remaining <= 0) {
      await supabase.from("rec_user_suspensions").update({
        active: false,
        remaining_advances: 0,
      }).eq("id", row.id);
      await clearSuspendedDiscordState(input.guildId, row.user_id);
      await recordUserActivity({
        leagueId: input.leagueId,
        userId: row.user_id,
        actionKey: "suspension_cleared",
        summary: "Suspension completed after scheduled advances.",
        metadata: { suspensionId: row.id },
      });
      cleared += 1;
    } else {
      await supabase.from("rec_user_suspensions").update({ remaining_advances: remaining }).eq("id", row.id);
    }
  }
  return { ticked, cleared };
}
