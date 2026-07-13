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
  submittedAt: string;
  teamId: string | null;
  weekNumber: number | null;
  sourceId: string | null;
  payload: Record<string, unknown> | null;
};

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

  return {
    notifications: (data ?? []).map((row: any) => ({
      id: row.id,
      type: row.queue_type,
      title: row.header,
      subtitle: row.summary ?? "",
      amount: row.amount == null ? null : Number(row.amount),
      submittedBy: row.requester_discord_id,
      submittedAt: row.created_at,
      teamId: row.team_id,
      weekNumber: row.week_number,
      sourceId: row.source_id,
      payload: row.payload ?? null,
    })),
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
