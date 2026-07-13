// One unified commissioner notification feed, read directly off rec_commissioners_inbox —
// see apps/api/src/modules/box-score/box-score.service.ts (the original source of this
// table) and the other 9 sources' service files for the insert/update side that populates
// it. This module only reads; the writes live next to each source's own business logic.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

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
    .select("discord_id,username,global_name,user:rec_users(display_name)")
    .in("discord_id", ids);
  if (accounts.error) throw new ApiError(500, "Failed to resolve member names.", accounts.error);
  return new Map<string, string>((accounts.data ?? []).map((account: any): [string, string] => {
    const user = Array.isArray(account.user) ? account.user[0] : account.user;
    return [account.discord_id, user?.display_name || account.global_name || account.username || "REC Member"];
  }));
}

function replaceDiscordMentions(value: string | null | undefined, names: Map<string, string>) {
  return String(value ?? "").replace(/<@!?(\d+)>/g, (_mention, id: string) => names.get(id) ?? "REC Member");
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
    .select("id,queue_type,header,summary,amount,requester_discord_id,team_id,week_number,source_id,payload,created_at")
    .eq("guild_id", guildId)
    .eq("status", "pending")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });
  if (sinceIso) query = query.gt("created_at", sinceIso);

  const { data, error } = await query;
  if (error) throw new ApiError(500, "Failed to load commissioner notifications.", error);

  const names = await discordNameMap((data ?? []).flatMap((row: any) => [row.requester_discord_id]));
  return {
    notifications: (data ?? []).map((row: any) => ({
      id: row.id,
      type: row.queue_type,
      title: row.header,
      subtitle: replaceDiscordMentions(row.summary, names),
      amount: row.amount == null ? null : Number(row.amount),
      submittedBy: row.requester_discord_id,
      submittedByName: row.requester_discord_id ? names.get(row.requester_discord_id) ?? "REC Member" : null,
      submittedAt: row.created_at,
      teamId: row.team_id,
      weekNumber: row.week_number,
      sourceId: row.source_id,
      payload: row.payload ?? null,
    })),
  };
}

export async function listCompletedCommissionerTransactions(guildId: string) {
  const { data, error } = await supabase
    .from("rec_commissioners_inbox")
    .select("id,queue_type,status,header,summary,amount,requester_discord_id,reviewed_by_discord_id,reviewed_at,team_id,week_number,source_table,source_id,payload,created_at,updated_at")
    .eq("guild_id", guildId)
    .in("queue_type", COMPLETED_TRANSACTION_TYPES)
    .in("status", ["approved", "issued", "fulfilled", "settled", "completed"])
    .order("reviewed_at", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) throw new ApiError(500, "Failed to load completed commissioner transactions.", error);

  const rows = data ?? [];
  const names = await discordNameMap(rows.flatMap((row: any) => [row.requester_discord_id, row.reviewed_by_discord_id]));
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
        details.push({ label: "Purchase", value: humanize(purchase.purchase_type) }, { label: "Cost", value: `$${Number(purchase.cost ?? row.amount ?? 0).toLocaleString()}` });
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
        submittedByName: row.requester_discord_id ? names.get(row.requester_discord_id) ?? "REC Member" : null,
        submittedAt: row.created_at,
        teamId: row.team_id,
        weekNumber: row.week_number,
        sourceId: row.source_id,
        payload: row.payload ?? null,
        status: row.status,
        statusLabel: row.queue_type === "purchase" ? "Approved & Applied" : row.queue_type === "wager" ? "Settled" : "Approved & Issued",
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
