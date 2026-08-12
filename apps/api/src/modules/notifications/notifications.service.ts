// One unified commissioner notification feed, read directly off rec_commissioners_inbox —
// see apps/api/src/modules/box-score/box-score.service.ts (the original source of this
// table) and the other 9 sources' service files for the insert/update side that populates
// it. This module only reads; the writes live next to each source's own business logic.
import { formatCoins, deriveCaseDisplayStatus, type CaseDisplayStatus } from "@rec/shared";
import { bestEffortVoid } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import {
  getCommissionerPendingSummaries,
  markCommissionerLeaguesViewed,
  resolveRecUserIdForDiscordId,
  type CommissionerPendingSummary,
} from "./commissioner-pending-summary.js";

export type CommissionerNotification = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  amount: number | null;
  submittedBy: string | null;
  submittedByName: string | null;
  submittedAt: string;
  teamId: string | null;
  weekNumber: number | null;
  sourceId: string | null;
  payload: Record<string, unknown> | null;
  internalMemo: string | null;
  votingTopicId: string | null;
  awaitingUserResponse: boolean;
  displayStatus: CaseDisplayStatus;
};

const COMPLETED_TRANSACTION_TYPES = ["purchase", "highlight", "stream", "eos_payout", "eos_award", "wager"];

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function discordNameMap(discordIds: Array<string | null | undefined>) {
  const ids = [...new Set(discordIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, string>();
  const accounts = await supabase
    .from("rec_discord_accounts")
    .select("discord_id,username,global_name,user:rec_users(username,display_name)")
    .in("discord_id", ids);
  if (accounts.error) throw new ApiError(500, "Failed to resolve member names.", accounts.error);
  return new Map<string, string>((accounts.data ?? []).map((account: any): [string, string] => {
    const user = Array.isArray(account.user) ? account.user[0] : account.user;
    return [account.discord_id, user?.username || user?.display_name || account.global_name || account.username || "REC Member"];
  }));
}

function replaceDiscordMentions(value: string | null | undefined, names: Map<string, string>) {
  return String(value ?? "").replace(/<@!?(\d+)>/g, (_mention, id: string) => names.get(id) ?? "REC Member");
}

// createTeamLinkRequest et al. write a synthetic "site:<userId>" requester_discord_id for a
// requester with no Discord account at all — discordNameMap only ever looks up real Discord
// snowflakes, so that placeholder always missed and fell through to the generic "REC Member".
// This resolves both real requester types properly: a genuine site account shows its own
// name; a Discord-only account (linked, but never logged into the site) is labeled as such
// instead of blending in as if it were a full site member.
async function requesterNameMaps(rows: Array<{ requester_discord_id: string | null; requester_user_id?: string | null }>) {
  const discordIds = [...new Set(
    rows.map((r) => r.requester_discord_id).filter((id): id is string => id != null && !id.startsWith("site:")),
  )];
  const userIds = [...new Set(rows.map((r) => r.requester_user_id).filter((id): id is string => id != null))];

  type AccountRow = { discord_id: string; user_id: string | null; username: string | null; global_name: string | null };
  type UserRow = { id: string; username: string | null; display_name: string | null; supabase_auth_user_id: string | null };

  const [accounts, users] = await Promise.all([
    discordIds.length
      ? supabase.from("rec_discord_accounts").select("discord_id,user_id,username,global_name").in("discord_id", discordIds)
      : Promise.resolve({ data: [] as AccountRow[], error: null as any }),
    userIds.length
      ? supabase.from("rec_users").select("id,username,display_name,supabase_auth_user_id").in("id", userIds)
      : Promise.resolve({ data: [] as UserRow[], error: null as any }),
  ]);
  if (accounts.error) throw new ApiError(500, "Failed to resolve member names.", accounts.error);
  if (users.error) throw new ApiError(500, "Failed to resolve member names.", users.error);

  const accountRows = (accounts.data ?? []) as AccountRow[];
  const userRows = (users.data ?? []) as UserRow[];

  const userById = new Map(userRows.map((u): [string, UserRow] => [u.id, u]));
  const byUserId = new Map<string, string>(userRows.map((u): [string, string] => [u.id, u.username || u.display_name || "Site Member"]));
  const byDiscordId = new Map<string, string>();
  for (const account of accountRows) {
    const user = account.user_id ? userById.get(account.user_id) : undefined;
    // A real site login (supabase_auth_user_id set) means their own chosen name is the best
    // identity to show; otherwise they're Discord-only — say so, using their actual Discord
    // username/nickname rather than the numeric snowflake.
    const siteAccountName: string | null = user?.supabase_auth_user_id ? (user.username || user.display_name || null) : null;
    const discordUsername = account.global_name || account.username;
    byDiscordId.set(account.discord_id, siteAccountName || (discordUsername ? `Discord Member — ${discordUsername}` : "REC Member"));
  }
  return { byDiscordId, byUserId };
}

function resolveRequesterName(row: { requester_discord_id: string | null; requester_user_id?: string | null }, maps: { byDiscordId: Map<string, string>; byUserId: Map<string, string> }): string | null {
  const discordId = row.requester_discord_id;
  if (discordId && !discordId.startsWith("site:")) {
    return maps.byDiscordId.get(discordId) ?? (row.requester_user_id ? maps.byUserId.get(row.requester_user_id) ?? "REC Member" : "REC Member");
  }
  if (row.requester_user_id) return maps.byUserId.get(row.requester_user_id) ?? "REC Member";
  return discordId ? "REC Member" : null;
}

function scalarDetails(payload: Record<string, unknown> | null | undefined) {
  return Object.entries(payload ?? {})
    .filter(([key, value]) => !/id$/i.test(key) && !/Id$/.test(key) && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 8)
    .map(([key, value]) => ({ label: humanize(key), value: String(value) }));
}

export async function listCommissionerNotifications(
  guildId: string,
  sinceIso?: string | null,
): Promise<{ notifications: CommissionerNotification[] }> {
  let query = supabase
    .from("rec_commissioners_inbox")
    .select("id,queue_type,header,summary,amount,requester_discord_id,requester_user_id,team_id,week_number,source_id,payload,created_at,internal_memo,voting_topic_id,awaiting_user_response")
    .eq("guild_id", guildId)
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });
  if (sinceIso) query = query.gt("created_at", sinceIso);

  const { data, error } = await query;
  if (error) throw new ApiError(500, "Failed to load commissioner notifications.", error);

  const names = await discordNameMap((data ?? []).flatMap((row: any) => [row.requester_discord_id]));
  const requesterMaps = await requesterNameMaps(data ?? []);
  return {
    notifications: (data ?? []).map((row: any) => ({
      id: row.id,
      type: row.queue_type,
      title: row.header,
      subtitle: replaceDiscordMentions(row.summary, names),
      amount: row.amount == null ? null : Number(row.amount),
      submittedBy: row.requester_discord_id,
      submittedByName: resolveRequesterName(row, requesterMaps),
      submittedAt: row.created_at,
      teamId: row.team_id,
      weekNumber: row.week_number,
      sourceId: row.source_id,
      payload: row.payload ?? null,
      internalMemo: row.internal_memo ?? null,
      votingTopicId: row.voting_topic_id ?? null,
      awaitingUserResponse: Boolean(row.awaiting_user_response),
      displayStatus: deriveCaseDisplayStatus({
        status: "pending",
        internalMemo: row.internal_memo,
        votingTopicId: row.voting_topic_id,
        awaitingUserResponse: row.awaiting_user_response,
      }),
    })),
  };
}

export async function listCompletedCommissionerTransactions(guildId: string) {
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .select("id,queue_type,status,header,summary,amount,requester_discord_id,requester_user_id,reviewed_by_discord_id,reviewed_at,team_id,week_number,source_table,source_id,payload,created_at,updated_at")
    .eq("guild_id", guildId)
    .in("queue_type", COMPLETED_TRANSACTION_TYPES)
    .in("status", ["approved", "issued", "fulfilled", "settled", "completed"])
    .order("reviewed_at", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) throw new ApiError(500, "Failed to load completed commissioner transactions.", error);

  const rows = data ?? [];
  const names = await discordNameMap(rows.flatMap((row: any) => [row.requester_discord_id, row.reviewed_by_discord_id]));
  const requesterMaps = await requesterNameMaps(rows);
  const sourceIds = (table: string) => rows.filter((row: any) => row.source_table === table && row.source_id).map((row: any) => row.source_id);
  const [purchases, highlights, streams] = await Promise.all([
    sourceIds("rec_purchases").length
      ? supabase.from("rec_purchases").select("id,purchase_type,cost,details,status,approved_at").in("id", sourceIds("rec_purchases"))
      : Promise.resolve({ data: [], error: null }),
    sourceIds("rec_highlight_payout_reviews").length
      ? supabase.from("rec_highlight_payout_reviews").select("id,payout_kind,award_category,vote_count,status,amount,week_number,issued_at").in("id", sourceIds("rec_highlight_payout_reviews"))
      : Promise.resolve({ data: [], error: null }),
    sourceIds("rec_stream_payout_reviews").length
      ? supabase.from("rec_stream_payout_reviews").select("id,status,amount,week_number,issued_at").in("id", sourceIds("rec_stream_payout_reviews"))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (purchases.error || highlights.error || streams.error) throw new ApiError(500, "Failed to load completed transaction details.", purchases.error ?? highlights.error ?? streams.error);
  const purchaseMap = new Map((purchases.data ?? []).map((item: any) => [item.id, item]));
  const highlightMap = new Map((highlights.data ?? []).map((item: any) => [item.id, item]));
  const streamMap = new Map((streams.data ?? []).map((item: any) => [item.id, item]));

  return {
    transactions: rows.map((row: any) => {
      const details: Array<{ label: string; value: string }> = [];
      const purchase: any = purchaseMap.get(row.source_id);
      const highlight: any = highlightMap.get(row.source_id);
      const stream: any = streamMap.get(row.source_id);
      if (purchase) {
        details.push({ label: "Purchase", value: humanize(purchase.purchase_type) }, { label: "Cost", value: formatCoins(purchase.cost ?? row.amount ?? 0) });
        details.push(...scalarDetails(purchase.details));
      } else if (highlight) {
        details.push({ label: "Payout", value: highlight.payout_kind === "season_award" ? "Play of the Year Award" : "Weekly Highlight" });
        if (highlight.award_category) details.push({ label: "Category", value: humanize(highlight.award_category) });
        if (highlight.vote_count != null) details.push({ label: "Votes", value: String(highlight.vote_count) });
      } else if (stream) {
        details.push({ label: "Payout", value: "Discord Live Stream" });
      } else {
        details.push(...scalarDetails(row.payload));
      }
      if (row.week_number != null && !details.some((detail) => detail.label === "Week")) details.push({ label: "Week", value: String(row.week_number) });
      return {
        id: row.id,
        type: row.queue_type,
        title: row.header,
        subtitle: replaceDiscordMentions(row.summary, names),
        amount: row.amount == null ? null : Number(row.amount),
        submittedBy: row.requester_discord_id,
        submittedByName: resolveRequesterName(row, requesterMaps),
        submittedAt: row.created_at,
        teamId: row.team_id,
        weekNumber: row.week_number,
        sourceId: row.source_id,
        payload: row.payload ?? null,
        internalMemo: row.internal_memo ?? null,
        votingTopicId: row.voting_topic_id ?? null,
        awaitingUserResponse: false,
        status: row.status,
        statusLabel: row.queue_type === "purchase" ? "Approved & Applied" : row.queue_type === "wager" ? "Settled" : "Approved & Issued",
        displayStatus: deriveCaseDisplayStatus({ status: row.status }),
        reviewedBy: row.reviewed_by_discord_id,
        reviewedByName: row.reviewed_by_discord_id ? names.get(row.reviewed_by_discord_id) ?? "REC Commissioner" : null,
        completedAt: row.reviewed_at ?? row.updated_at,
        details,
      };
    }),
  };
}

export async function listUnattendedCommissionerNotifications(guildId: string) {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .select("id,header,summary")
    .eq("guild_id", guildId)
    .eq("status", "pending")
    .is("dm_notified_at", null)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load unattended commissioner notifications.", error);
  return { notifications: data ?? [] };
}

/** Bell summary for the current guild's league — "You have N pending items in {league}". */
export async function getCommissionerPendingSummaryForLeague(
  discordId: string,
  leagueId: string,
): Promise<CommissionerPendingSummary | null> {
  const recUserId = await resolveRecUserIdForDiscordId(discordId);
  if (!recUserId) return null;
  const summaries = await getCommissionerPendingSummaries(recUserId, [leagueId]);
  return summaries[0] ?? null;
}

export async function markCommissionerLeagueViewed(discordId: string, leagueId: string): Promise<{ ok: true }> {
  const recUserId = await resolveRecUserIdForDiscordId(discordId);
  if (recUserId) await markCommissionerLeaguesViewed(recUserId, [leagueId]);
  return { ok: true };
}

export async function markCommissionerNotificationsDmSent(guildId: string, ids: string[]) {
  if (!ids.length) return { updated: 0 };
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .update({ dm_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("guild_id", guildId)
    .eq("status", "pending")
    .in("id", ids)
    .select("id");
  if (error) throw new ApiError(500, "Failed to mark commissioner notification DMs.", error);
  return { updated: data?.length ?? 0 };
}

// Generic resolve action for queue_types that have no dedicated review flow of their own (e.g.
// notification-only request types like force_win_request/autopilot_request/matchup_issue_report)
// — every other type is resolved by its own source-specific service function instead, per this
// module's usual "reads only" convention, but those types don't have a source table to update.
const MATCHUP_HELP_QUEUE_TYPES = new Set(["force_win_request", "autopilot_request", "matchup_issue_report"]);

export async function markCommissionerInboxItemHandled(input: { guildId: string; inboxId: string; reviewerDiscordId: string }) {
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .update({ status: "resolved", reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: new Date().toISOString() })
    .eq("id", input.inboxId)
    .eq("guild_id", input.guildId)
    .eq("status", "pending")
    .select("id,league_id,queue_type,header,requester_user_id,payload")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to update item.", error);
  if (!data) throw new ApiError(404, "Item not found or already resolved.");

  // The Request Help flow (Force Win / AutoPilot / Report Issue) promises the requester a
  // private notification when their case is resolved, not just when it's submitted.
  if (MATCHUP_HELP_QUEUE_TYPES.has(data.queue_type) && data.requester_user_id) {
    const gameId = (data.payload as Record<string, unknown> | null)?.gameId as string | undefined;
    const title = `${data.header ?? "Your request"} — resolved`;
    const body = "A commissioner has resolved your request. Check the matchup for details.";
    const href = gameId ? `/matchups/${gameId}` : "/";
    const { createSiteNotification } = await import("../site-notifications/site-notifications.service.js");
    const { sendPushToUsers } = await import("../push/push.service.js");
    bestEffortVoid("notification.matchup_help_resolved", createSiteNotification({ userId: data.requester_user_id, leagueId: data.league_id, kind: "matchup_help_resolved", title, body, href }), { leagueId: data.league_id, userId: data.requester_user_id });
    bestEffortVoid("push.matchup_help_resolved", sendPushToUsers([data.requester_user_id], { title, body, url: href }), { leagueId: data.league_id, userId: data.requester_user_id });
  }

  return { ok: true as const };
}

// The "Waiting on User" display status (deriveCaseDisplayStatus) has no writer without this —
// a commissioner needs to be able to flip a case into that state (e.g. "we asked the coach
// for a screenshot") and back once the requester responds.
export async function setCaseAwaitingUserResponse(input: { guildId: string; inboxId: string; awaiting: boolean }) {
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .update({ awaiting_user_response: input.awaiting, updated_at: new Date().toISOString() })
    .eq("id", input.inboxId)
    .eq("guild_id", input.guildId)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to update case.", error);
  if (!data) throw new ApiError(404, "Case not found.");
  return { ok: true as const };
}

// Commissioner Command Center — cases. internal_memo/voting_topic_id are additive columns on
// the same rec_commissioners_inbox row (see 20260731020000_commissioner_cases.sql); the
// audit trail below is captured automatically by that migration's trigger, not written here.
export async function addCaseMemo(input: { guildId: string; inboxId: string; memo: string }) {
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .update({ internal_memo: input.memo.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", input.inboxId)
    .eq("guild_id", input.guildId)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to save memo.", error);
  if (!data) throw new ApiError(404, "Case not found.");
  return { ok: true as const };
}

export type CommissionerCaseEvent = {
  id: string;
  eventType: string;
  priorState: Record<string, unknown> | null;
  nextState: Record<string, unknown> | null;
  createdAt: string;
};

export async function listCaseEvents(guildId: string, inboxId: string): Promise<{ events: CommissionerCaseEvent[] }> {
  const inbox = await supabase.from("rec_commissioners_inbox").select("id").eq("id", inboxId).eq("guild_id", guildId).maybeSingle();
  if (inbox.error) throw new ApiError(500, "Failed to load case.", inbox.error);
  if (!inbox.data) throw new ApiError(404, "Case not found.");
  const { data, error } = await supabase
    .from("rec_commissioner_case_events")
    .select("id,event_type,prior_state,next_state,created_at")
    .eq("case_id", inboxId)
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, "Failed to load case history.", error);
  return {
    events: (data ?? []).map((row) => ({
      id: row.id,
      eventType: row.event_type,
      priorState: row.prior_state,
      nextState: row.next_state,
      createdAt: row.created_at,
    })),
  };
}

export async function linkCaseToVotingTopic(input: { guildId: string; inboxId: string; topicId: string }) {
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .update({ voting_topic_id: input.topicId, updated_at: new Date().toISOString() })
    .eq("id", input.inboxId)
    .eq("guild_id", input.guildId)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(500, "Failed to link voting topic.", error);
  if (!data) throw new ApiError(404, "Case not found.");
  return { ok: true as const };
}
