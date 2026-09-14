import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export type UserActivityActionKey =
  | "played_game"
  | "scheduled_game"
  | "conceded_fw"
  | "changed_availability"
  | "purchase_attribute_upgrade"
  | "purchase"
  | "team_unlinked"
  | "suspended"
  | "suspension_cleared"
  | "wallet_transfer"
  | "other";

/** Best-effort activity write — never blocks the caller’s main path. */
export async function recordUserActivity(input: {
  leagueId: string;
  userId: string;
  teamId?: string | null;
  actionKey: UserActivityActionKey | string;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const summary = String(input.summary ?? "").trim();
  if (!input.leagueId || !input.userId || !summary) return;
  const { error } = await supabase.from("rec_user_activity_events").insert({
    league_id: input.leagueId,
    user_id: input.userId,
    team_id: input.teamId ?? null,
    action_key: String(input.actionKey),
    summary,
    metadata: input.metadata ?? {},
  });
  if (error) console.error("[ERROR] Failed to record user activity event:", error);
}

export async function listUserActivityEvents(input: {
  leagueId: string;
  userId: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 25);
  const { data, error } = await supabase
    .from("rec_user_activity_events")
    .select("id,action_key,summary,metadata,team_id,created_at")
    .eq("league_id", input.leagueId)
    .eq("user_id", input.userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ApiError(500, "We couldn't load that activity log. Please try again.", error);
  return {
    events: (data ?? []).map((row: any) => ({
      id: row.id as string,
      actionKey: row.action_key as string,
      summary: row.summary as string,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      teamId: (row.team_id as string | null) ?? null,
      createdAt: row.created_at as string,
    })),
  };
}
