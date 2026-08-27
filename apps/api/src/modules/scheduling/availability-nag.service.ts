// Advance-triggered availability nag: replaces reminder-poller.service.ts's old 60s-polled
// runAvailabilityNag. Called once per league advance (see league-week.service.ts), right after
// applyAvailabilityComplianceForAdvance -- deletes the previous nag message(s) and posts fresh
// ones tagging every non-compliant user, each with their current warning stage so this one
// message doubles as the compliance notice (no separate per-advance DM for the common case).
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage, deleteDiscordMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import type { AvailabilityComplianceResult } from "./availability-compliance.service.js";

// Discord rejects a whole message outright (400/50035) once content passes 2000 chars -- a
// league with enough non-compliant users at once can blow past that in a single message (this is
// exactly what silently ate every nag post before this fix: postDiscordChannelMessage only logs a
// WARN on rejection, so the failure never surfaced anywhere). Chunk well under the real limit.
const MAX_CONTENT_LENGTH = 1800;

// Same three buttons the "League Availability" control panel used to carry at the top of the
// channel -- moved here so they sit next to the people who actually need to click them, instead
// of a separate always-present panel no one associates with the nag.
const NAG_COMPONENTS = [{
  type: 1,
  components: [
    { type: 2, style: 2, custom_id: "rec:availboard:setavailability", label: "Set Availability" },
    { type: 2, style: 2, custom_id: "rec:availboard:settimezone", label: "Set Timezone" },
    { type: 2, style: 2, custom_id: "rec:availboard:thisweek", label: "This Week" },
  ],
}];

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

// Groups lines into message bodies that each stay under MAX_CONTENT_LENGTH once the shared intro
// is prepended to the first chunk.
function chunkContent(intro: string, lines: string[]): string[] {
  const chunks: string[] = [];
  let current = intro;
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > MAX_CONTENT_LENGTH && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function repostAvailabilityNag(leagueId: string, compliance: AvailabilityComplianceResult): Promise<void> {
  const routes = await findServerRoutesForLeague(leagueId).catch(() => null);
  const channelId = String((routes?.routes as any)?.scheduling_channel_id ?? "");
  const state = await supabase.from("rec_availability_nag_state").select("channel_id,message_ids").eq("league_id", leagueId).maybeSingle();
  if (state.error) { console.error("[ERROR] availability nag: failed to load nag state (non-fatal):", state.error); return; }

  if (state.data?.message_ids?.length) {
    for (const messageId of state.data.message_ids as string[]) {
      await deleteDiscordMessage(state.data.channel_id, messageId).catch(() => undefined);
    }
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

  const intro = "Set your availability and timezone through here or the site so the scheduling system can find shared kickoff windows for your games.";
  const chunks = chunkContent(intro, lines);
  const mentionIds = [...discordByUser.values()];
  const postedIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const posted = await postDiscordChannelMessage(channelId, {
      content: chunks[i],
      allowed_mentions: { users: mentionIds },
      // Buttons only need to appear once -- put them on the last message so they land right
      // after the full list of tagged coaches, not detached above it.
      components: i === chunks.length - 1 ? NAG_COMPONENTS : undefined,
    }).catch((error) => { console.error("[ERROR] availability nag: failed to post (non-fatal):", error); return null; });
    if (posted?.id) postedIds.push(posted.id);
  }

  if (postedIds.length) {
    const upserted = await supabase.from("rec_availability_nag_state").upsert(
      { league_id: leagueId, channel_id: channelId, message_ids: postedIds, posted_at: new Date().toISOString() },
      { onConflict: "league_id" },
    );
    if (upserted.error) console.error("[ERROR] availability nag: failed to record nag state (non-fatal):", upserted.error);
  }
}
