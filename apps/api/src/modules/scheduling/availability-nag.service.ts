// Advance-triggered availability nag: replaces reminder-poller.service.ts's old 60s-polled
// runAvailabilityNag. Called once per league advance (see league-week.service.ts), right after
// applyAvailabilityComplianceForAdvance -- deletes the previous nag message and posts a fresh
// one tagging every non-compliant user, each with their current warning stage so this one
// message doubles as the compliance notice (no separate per-advance DM for the common case).
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, deleteDiscordMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import type { AvailabilityComplianceResult } from "./availability-compliance.service.js";

async function discordIdsFor(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", ids);
  if (error) { console.error("[ERROR] availability nag: failed to load discord ids (non-fatal):", error); return new Map(); }
  return new Map((data ?? []).map((r: any) => [String(r.user_id), String(r.discord_id)]));
}

function warningLine(warningCount: number): string {
  if (warningCount >= 3) return "payouts are being held every advance until you set your availability";
  return `warning ${warningCount} of 2 — after one more missed advance, your payouts will be held until you set your availability, then paid out automatically`;
}

export async function repostAvailabilityNag(leagueId: string, compliance: AvailabilityComplianceResult): Promise<void> {
  const routes = await findServerRoutesForLeague(leagueId).catch(() => null);
  const channelId = String((routes?.routes as any)?.scheduling_channel_id ?? "");
  const state = await supabase.from("rec_availability_nag_state").select("channel_id,message_id").eq("league_id", leagueId).maybeSingle();
  if (state.error) { console.error("[ERROR] availability nag: failed to load nag state (non-fatal):", state.error); return; }

  if (state.data?.message_id) {
    await deleteDiscordMessage(state.data.channel_id, state.data.message_id).catch(() => undefined);
    await supabase.from("rec_availability_nag_state").delete().eq("league_id", leagueId);
  }

  if (!channelId || !compliance.nonCompliantUserIds.length) return;

  const discordByUser = await discordIdsFor(compliance.nonCompliantUserIds);
  const lines = compliance.nonCompliantUserIds
    .map((userId) => {
      const discordId = discordByUser.get(userId);
      if (!discordId) return null;
      const warningCount = compliance.warningStageByUserId.get(userId) ?? 1;
      return `<@${discordId}> — ${warningLine(warningCount)}`;
    })
    .filter((v): v is string => Boolean(v));
  if (!lines.length) return;

  const mentionIds = [...discordByUser.values()];
  const posted = await postDiscordChannelMessage(channelId, {
    content: `Set your availability and timezone through here or the site so the scheduling system can find shared kickoff windows for your games.\n\n${lines.join("\n")}`,
    allowed_mentions: { users: mentionIds },
  }).catch((error) => { console.error("[ERROR] availability nag: failed to post (non-fatal):", error); return null; });

  if (posted?.id) {
    const upserted = await supabase.from("rec_availability_nag_state").upsert(
      { league_id: leagueId, channel_id: channelId, message_id: posted.id, posted_at: new Date().toISOString() },
      { onConflict: "league_id" },
    );
    if (upserted.error) console.error("[ERROR] availability nag: failed to record nag state (non-fatal):", upserted.error);
  }
}
