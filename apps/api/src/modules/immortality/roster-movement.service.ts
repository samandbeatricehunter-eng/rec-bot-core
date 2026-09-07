// Rise to Immortality: "Roster Movement" auto-post -- diffs each active rec_players row's
// team_id against a snapshot saved after the previous run (rec_immortality_leagues.
// roster_movement_snapshot) and posts anything that changed. Decoupled from the EA import
// pipeline's own internals on purpose: rather than hooking a before/after snapshot into the
// import call itself (risky -- that pipeline has several call sites and a long, careful retry
// path), this just compares "roster state now" to "roster state last time this ran," which is
// called from the same post-import hook points as refreshImmortalityProspectCardsForLeague.
//
// Pass 7 addition: any move touching a USER-controlled team also gets its own dedicated embed
// (in addition to the general combined embed below, unchanged), and a trade/release touching a
// team whose Owner hasn't unlocked that authority on the Franchise Pillar tree gets flagged in
// the same channel, tagging Commissioner + Comp Committee roles and the offending coach.
import { ensureManagedRoleId, postDiscordChannelMessage } from "../../lib/discord-guild.js";
import { supabase } from "../../lib/supabase.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { formatTeamDisplayName } from "../users/user-profile-stats.service.js";
import { discordIdForRecUser, loadImmortalityLeague } from "./immortality.service.js";
import { ownerAuthorityForTeam } from "./owner-progression.service.js";

type RosterSnapshot = Record<string, { teamId: string | null; fullName: string; position: string | null }>;

const MAX_EVENTS_SHOWN = 30;

type MovementEvent = {
  kind: "signed" | "released" | "moved" | "removed";
  line: string;
  fromTeamId: string | null;
  toTeamId: string | null;
};

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

    const events: MovementEvent[] = [];
    for (const [playerId, cur] of Object.entries(current)) {
      const prev = previous[playerId];
      if (!prev) {
        if (cur.teamId) events.push({ kind: "signed", fromTeamId: null, toTeamId: cur.teamId, line: `📥 **${cur.fullName}** (${cur.position ?? "?"}) signed with the ${teamName(cur.teamId)}` });
        continue;
      }
      if (prev.teamId === cur.teamId) continue;
      if (!cur.teamId) events.push({ kind: "released", fromTeamId: prev.teamId, toTeamId: null, line: `📤 **${cur.fullName}** (${cur.position ?? "?"}) released by ${teamName(prev.teamId)}` });
      else if (!prev.teamId) events.push({ kind: "signed", fromTeamId: null, toTeamId: cur.teamId, line: `📥 **${cur.fullName}** (${cur.position ?? "?"}) signed with the ${teamName(cur.teamId)}` });
      else events.push({ kind: "moved", fromTeamId: prev.teamId, toTeamId: cur.teamId, line: `🔁 **${cur.fullName}** (${cur.position ?? "?"}) moved from ${teamName(prev.teamId)} to ${teamName(cur.teamId)}` });
    }
    for (const [playerId, prev] of Object.entries(previous)) {
      if (!(playerId in current) && prev.teamId) {
        events.push({ kind: "removed", fromTeamId: prev.teamId, toTeamId: null, line: `🚫 **${prev.fullName}** (${prev.position ?? "?"}) removed from the ${teamName(prev.teamId)} roster` });
      }
    }

    await supabase.from("rec_immortality_leagues").update({
      roster_movement_snapshot: current, updated_at: new Date().toISOString(),
    }).eq("id", immortalityLeague.id);

    if (!events.length) return;
    const routes = await findServerRoutesForLeague(leagueId);
    const guildId = routes?.guildId;
    const channelId = routes?.routes?.roster_movement_channel_id as string | null | undefined;
    if (!channelId) return;

    const shown = events.slice(0, MAX_EVENTS_SHOWN);
    const overflow = events.length > shown.length ? `\n…and ${events.length - shown.length} more.` : "";
    await postDiscordChannelMessage(channelId, {
      embeds: [{ title: "Roster Movement", description: shown.map((e) => e.line).join("\n") + overflow, color: 0x2f81f7 }],
    });

    if (guildId) {
      await postPerUserTeamMovement({ leagueId, guildId, channelId, events, teamName, teamIds }).catch((error) => {
        console.error(`[ERROR] Failed to post per-user-team roster movement for league ${leagueId} (non-fatal):`, error);
      });
    }
  } catch (err) {
    console.error("[ERROR] Failed to post RTI roster movement (non-fatal):", err);
  }
}

async function postPerUserTeamMovement(input: {
  leagueId: string; guildId: string; channelId: string; events: MovementEvent[];
  teamName: (id: string | null) => string; teamIds: Set<string>;
}): Promise<void> {
  const assignments = await supabase.from("rec_team_assignments").select("team_id,user_id")
    .eq("league_id", input.leagueId).eq("assignment_status", "active").is("ended_at", null).in("team_id", [...input.teamIds]);
  const userByTeam = new Map<string, string>((assignments.data ?? []).map((row: any) => [String(row.team_id), String(row.user_id)]));
  if (!userByTeam.size) return;

  const eventsByTeam = new Map<string, MovementEvent[]>();
  for (const event of input.events) {
    for (const teamId of [event.fromTeamId, event.toTeamId]) {
      if (!teamId || !userByTeam.has(teamId)) continue;
      (eventsByTeam.get(teamId) ?? eventsByTeam.set(teamId, []).get(teamId)!).push(event);
    }
  }
  if (!eventsByTeam.size) return;

  let commissionerRoleId: string | null = null;
  let compCommitteeRoleId: string | null = null;
  try {
    commissionerRoleId = await ensureManagedRoleId(input.guildId, "commissioner");
    compCommitteeRoleId = await ensureManagedRoleId(input.guildId, "compCommittee");
  } catch (error) {
    console.error(`[ERROR] Could not resolve commissioner/comp-committee roles for guild ${input.guildId} (non-fatal):`, error);
  }

  for (const [teamId, teamEvents] of eventsByTeam) {
    const userId = userByTeam.get(teamId)!;
    await postDiscordChannelMessage(input.channelId, {
      embeds: [{ title: `Roster Movement — ${input.teamName(teamId)}`, description: teamEvents.map((e) => e.line).join("\n").slice(0, 4096), color: 0x2f81f7 }],
    });

    const violations: string[] = [];
    const authority = await ownerAuthorityForTeam(input.leagueId, teamId).catch(() => null);
    const personnelCouncilTier = authority?.personnelCouncilTier ?? 0;
    const releaseAuthorityUnlocked = authority?.releaseAuthorityUnlocked ?? false;
    for (const event of teamEvents) {
      if (event.kind === "moved" && personnelCouncilTier < 1) {
        violations.push(`Trade detected: ${event.line.replace(/^🔁 /, "")}`);
      } else if ((event.kind === "released" || event.kind === "removed") && event.fromTeamId === teamId && !releaseAuthorityUnlocked) {
        violations.push(`Release detected: ${event.line.replace(/^(📤|🚫) /, "")}`);
      }
    }
    if (!violations.length) continue;

    const offendingDiscordId = await discordIdForRecUser(userId).catch(() => null);
    const mentions = [
      commissionerRoleId ? `<@&${commissionerRoleId}>` : null,
      compCommitteeRoleId ? `<@&${compCommitteeRoleId}>` : null,
      offendingDiscordId ? `<@${offendingDiscordId}>` : null,
    ].filter((v): v is string => Boolean(v)).join(" ");
    await postDiscordChannelMessage(input.channelId, {
      content: mentions || undefined,
      embeds: [{
        title: `⚠️ Personnel Authority Violation — ${input.teamName(teamId)}`,
        description: `${violations.join("\n")}\n\nThis team hasn't unlocked ${personnelCouncilTier < 1 ? "Personnel Council (trades)" : ""}${personnelCouncilTier < 1 && !releaseAuthorityUnlocked ? " / " : ""}${!releaseAuthorityUnlocked ? "Front Office Access (releases)" : ""} on the Franchise Pillar (Owner) tree. Confirm this was a sanctioned move.`,
        color: 0xd94040,
      }],
    });
  }
}
