// Rise to Immortality: "Roster Movement" auto-post -- diffs each active rec_players row's
// team_id against a snapshot saved after the previous run (rec_immortality_leagues.
// roster_movement_snapshot) and posts anything that changed. Decoupled from the EA import
// pipeline's own internals on purpose: rather than hooking a before/after snapshot into the
// import call itself (risky -- that pipeline has several call sites and a long, careful retry
// path), this just compares "roster state now" to "roster state last time this ran," which is
// called from the same post-import hook points as refreshImmortalityProspectCardsForLeague.
import { supabase } from "../../lib/supabase.js";
import { postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { loadImmortalityLeague } from "./immortality.service.js";

type RosterSnapshot = Record<string, { teamId: string | null; fullName: string; position: string | null }>;

const MAX_EVENTS_SHOWN = 30;

export async function postRosterMovementForLeague(leagueId: string): Promise<void> {
  try {
    const immortalityLeague = await loadImmortalityLeague(leagueId);
    if (!immortalityLeague) return;

    const players = await supabase.from("rec_players").select("id,full_name,position,team_id,roster_status").eq("league_id", leagueId);
    if (players.error) return;

    const current: RosterSnapshot = {};
    for (const row of players.data ?? []) {
      if ((row.roster_status ?? "active") !== "active") continue;
      current[String(row.id)] = {
        teamId: row.team_id ? String(row.team_id) : null,
        fullName: row.full_name ?? "Unknown Player",
        position: row.position ?? null,
      };
    }

    const previous = ((immortalityLeague.roster_movement_snapshot as RosterSnapshot | null) ?? {}) as RosterSnapshot;
    const hasPrevious = Object.keys(previous).length > 0;

    // First run ever for this league -- nothing to diff against, so just establish the
    // baseline instead of announcing the entire initial roster import as "signings".
    if (!hasPrevious) {
      await supabase.from("rec_immortality_leagues").update({
        roster_movement_snapshot: current, updated_at: new Date().toISOString(),
      }).eq("id", immortalityLeague.id);
      return;
    }

    const teamIds = new Set<string>();
    for (const row of Object.values(current)) if (row.teamId) teamIds.add(row.teamId);
    for (const row of Object.values(previous)) if (row.teamId) teamIds.add(row.teamId);
    const teams = teamIds.size
      ? await supabase.from("rec_teams").select("id,name,display_city,display_nick,is_relocated").in("id", [...teamIds])
      : { data: [] as Array<Record<string, unknown>> };
    const teamNameById = new Map<string, string>((teams.data ?? []).map((t: any) => [String(t.id), formatTeamDisplayName(t) ?? String(t.name ?? "a team")]));
    const teamName = (id: string | null) => (id ? (teamNameById.get(id) ?? "a team") : "the free agent pool");

    const events: string[] = [];
    for (const [playerId, cur] of Object.entries(current)) {
      const prev = previous[playerId];
      if (!prev) {
        if (cur.teamId) events.push(`📥 **${cur.fullName}** (${cur.position ?? "?"}) signed with the ${teamName(cur.teamId)}`);
        continue;
      }
      if (prev.teamId === cur.teamId) continue;
      if (!cur.teamId) events.push(`📤 **${cur.fullName}** (${cur.position ?? "?"}) released by ${teamName(prev.teamId)}`);
      else if (!prev.teamId) events.push(`📥 **${cur.fullName}** (${cur.position ?? "?"}) signed with the ${teamName(cur.teamId)}`);
      else events.push(`🔁 **${cur.fullName}** (${cur.position ?? "?"}) moved from ${teamName(prev.teamId)} to ${teamName(cur.teamId)}`);
    }
    for (const [playerId, prev] of Object.entries(previous)) {
      if (!(playerId in current) && prev.teamId) {
        events.push(`🚫 **${prev.fullName}** (${prev.position ?? "?"}) removed from the ${teamName(prev.teamId)} roster`);
      }
    }

    await supabase.from("rec_immortality_leagues").update({
      roster_movement_snapshot: current, updated_at: new Date().toISOString(),
    }).eq("id", immortalityLeague.id);

    if (!events.length) return;
    const routes = await findServerRoutesForLeague(leagueId);
    const channelId = routes?.routes?.roster_movement_channel_id as string | null | undefined;
    if (!channelId) return;

    const shown = events.slice(0, MAX_EVENTS_SHOWN);
    const overflow = events.length > shown.length ? `\n…and ${events.length - shown.length} more.` : "";
    await postDiscordChannelMessage(channelId, {
      embeds: [{ title: "Roster Movement", description: shown.join("\n") + overflow, color: 0x2f81f7 }],
    });
  } catch (err) {
    console.error("[ERROR] Failed to post RTI roster movement (non-fatal):", err);
  }
}
