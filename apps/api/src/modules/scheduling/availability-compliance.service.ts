// Advance-triggered availability compliance: replaces the old 60s-polled availability nag.
// Every league advance (see league-week.service.ts's setLeagueWeek) calls
// applyAvailabilityComplianceForAdvance for the league -- each actively assigned user gets two
// free warnings, then has their future payouts held (via economy-backlog.ts's creditOrBacklog)
// until they set their availability again, at which point everything held is released.
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { bestEffortVoid } from "../../lib/best-effort.js";
import { isAvailabilityFullySet } from "./availability.service.js";
import { releaseBacklogForUser } from "../economy/economy-backlog.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { sendPushToUser } from "../push/push.service.js";

const WARNINGS_BEFORE_HOLD = 2;

export async function isPayoutsHeldForAvailability(userId: string, leagueId: string): Promise<boolean> {
  const row = await supabase.from("rec_availability_compliance").select("warning_count").eq("user_id", userId).eq("league_id", leagueId).maybeSingle();
  if (row.error) { console.error("[ERROR] Failed to check availability payout hold (defaulting to not-held):", row.error); return false; }
  return (row.data?.warning_count ?? 0) > WARNINGS_BEFORE_HOLD;
}

async function getWarningCount(userId: string, leagueId: string): Promise<number> {
  const row = await supabase.from("rec_availability_compliance").select("warning_count").eq("user_id", userId).eq("league_id", leagueId).maybeSingle();
  if (row.error) throw new ApiError(500, "Failed to load availability compliance state.", row.error);
  return row.data?.warning_count ?? 0;
}

async function setWarningCount(userId: string, leagueId: string, warningCount: number) {
  const upsert = await supabase.from("rec_availability_compliance").upsert(
    { user_id: userId, league_id: leagueId, warning_count: warningCount, updated_at: new Date().toISOString() },
    { onConflict: "user_id,league_id" },
  );
  if (upsert.error) throw new ApiError(500, "Failed to update availability compliance state.", upsert.error);
}

export type AvailabilityComplianceResult = {
  compliantUserIds: string[];
  nonCompliantUserIds: string[];
  warningStageByUserId: Map<string, number>; // new warning_count after this advance, for non-compliant users
  releasedUserIds: string[];
};

/** Called once per league advance. Returns the compliance snapshot so the nag repost (see
 * availability-nag.service.ts) can reuse it without a second pass over the same users. */
export async function applyAvailabilityComplianceForAdvance(leagueId: string): Promise<AvailabilityComplianceResult> {
  const assignments = await supabase.from("rec_team_assignments").select("user_id").eq("league_id", leagueId).eq("assignment_status", "active").is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load league members for availability compliance.", assignments.error);
  const userIds: string[] = [...new Set<string>((assignments.data ?? []).map((a: any) => String(a.user_id)))];

  const compliantUserIds: string[] = [];
  const nonCompliantUserIds: string[] = [];
  const warningStageByUserId = new Map<string, number>();
  const releasedUserIds: string[] = [];

  for (const userId of userIds) {
    const isFullySet = await isAvailabilityFullySet(userId, leagueId);
    const currentWarnings = await getWarningCount(userId, leagueId);

    if (isFullySet) {
      compliantUserIds.push(userId);
      if (currentWarnings > 0) {
        await setWarningCount(userId, leagueId, 0);
        const release = await releaseBacklogForUser(userId).catch((error) => {
          console.error("[ERROR] Failed to release availability-held payouts (non-fatal):", error);
          return { released: false, totalAmount: 0 };
        });
        if (release.released) releasedUserIds.push(userId);
        if (currentWarnings > WARNINGS_BEFORE_HOLD) {
          bestEffortVoid("notification.availability_payouts_resumed", createSiteNotification({
            userId, leagueId, kind: "availability_payouts_resumed",
            title: "Availability set — payouts resumed",
            body: "Your future payouts are no longer being held, and anything held while you were out of compliance has been released.",
            href: "/account",
          }), { leagueId, userId });
          bestEffortVoid("push.availability_payouts_resumed", sendPushToUser(userId, {
            title: "Payouts resumed",
            body: "Your availability is set again — payouts have resumed and any held coins were released.",
            url: "/account",
          }), { leagueId, userId });
        }
      }
    } else {
      nonCompliantUserIds.push(userId);
      const nextWarnings = currentWarnings + 1;
      await setWarningCount(userId, leagueId, nextWarnings);
      warningStageByUserId.set(userId, nextWarnings);
    }
  }

  return { compliantUserIds, nonCompliantUserIds, warningStageByUserId, releasedUserIds };
}
