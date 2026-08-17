import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { getLeagueDataMode } from "../league-week/data-mode.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { createSiteNotification } from "../site-notifications/site-notifications.service.js";
import { updateRosterPlayer } from "./roster.service.js";

export type RosterEditProposalChanges = {
  position?: string;
  jerseyNumber?: number | null;
  devTrait?: string | null;
  archetype?: string | null;
  attributes?: Record<string, number>;
};

async function userIdForDiscord(discordId: string): Promise<string> {
  const result = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load your REC account.", result.error);
  if (!result.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return result.data.user_id as string;
}

/** The requester's own active team in this league, or throws — proposals are self-service, own-team-only. */
async function ownTeamId(leagueId: string, userId: string): Promise<string> {
  const assignment = await supabase.from("rec_team_assignments").select("team_id")
    .eq("league_id", leagueId).eq("user_id", userId).eq("assignment_status", "active").is("ended_at", null).limit(1).maybeSingle();
  if (assignment.error) throw new ApiError(500, "We couldn't load your team assignment.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(403, "A linked league team is required to propose a roster edit.");
  return String(assignment.data.team_id);
}

function describeChanges(changes: RosterEditProposalChanges): string {
  const lines: string[] = [];
  if (changes.position !== undefined) lines.push(`Position: ${changes.position}`);
  if (changes.jerseyNumber !== undefined) lines.push(`Jersey #: ${changes.jerseyNumber ?? "—"}`);
  if (changes.devTrait !== undefined) lines.push(`Dev trait: ${changes.devTrait ?? "—"}`);
  if (changes.archetype !== undefined) lines.push(`Archetype: ${changes.archetype ?? "—"}`);
  if (changes.attributes) {
    for (const [code, value] of Object.entries(changes.attributes)) lines.push(`${code}: ${value}`);
  }
  return lines.join("\n") || "No changes specified.";
}

export async function submitRosterEditProposal(input: {
  guildId: string;
  discordId: string;
  playerId: string;
  changes: RosterEditProposalChanges;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if ((await getLeagueDataMode(context.leagueId)) !== "manual") {
    throw new ApiError(400, "This league isn't using Manual Entry mode — roster edit proposals aren't available.");
  }
  const userId = await userIdForDiscord(input.discordId);
  const teamId = await ownTeamId(context.leagueId, userId);

  const player = await supabase.from("rec_players").select("id,full_name,team_id")
    .eq("id", input.playerId).eq("league_id", context.leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "We couldn't load that player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (String(player.data.team_id) !== teamId) throw new ApiError(403, "You can only propose edits for players on your own team.");

  const hasChanges = input.changes.position !== undefined || input.changes.jerseyNumber !== undefined
    || input.changes.devTrait !== undefined || input.changes.archetype !== undefined
    || (input.changes.attributes && Object.keys(input.changes.attributes).length > 0);
  if (!hasChanges) throw new ApiError(400, "Propose at least one change.");

  const pending = await supabase.from("rec_roster_edit_proposals").select("id")
    .eq("player_id", input.playerId).eq("status", "pending_review").maybeSingle();
  if (pending.error) throw new ApiError(500, "We couldn't check for an existing proposal.", pending.error);
  if (pending.data) throw new ApiError(409, "A proposal for this player is already pending commissioner review.");

  const proposal = await supabase.from("rec_roster_edit_proposals").insert({
    league_id: context.leagueId,
    team_id: teamId,
    player_id: input.playerId,
    proposed_by_user_id: userId,
    proposed_changes: input.changes,
    status: "pending_review",
  }).select("*").single();
  if (proposal.error) throw new ApiError(500, "We couldn't save that proposal. Please try again.", proposal.error);

  const inboxInsert = await supabase.from("rec_commissioners_inbox").insert({
    guild_id: input.guildId,
    server_id: null,
    league_id: context.leagueId,
    season_number: null,
    week_number: null,
    queue_type: "roster_edit_proposal",
    status: "pending",
    priority: 0,
    header: `Roster Edit: ${player.data.full_name ?? "Player"}`,
    summary: describeChanges(input.changes),
    requester_discord_id: input.discordId,
    requester_user_id: userId,
    team_id: teamId,
    source_table: "rec_roster_edit_proposals",
    source_id: proposal.data.id,
    payload: { proposalId: proposal.data.id, playerId: input.playerId },
  });
  if (inboxInsert.error) console.error("[ERROR] Failed to create commissioner-inbox row for roster edit proposal (non-fatal):", inboxInsert.error);
  void notifyLeagueCommissionersOfPendingItem(context.leagueId);

  return { proposal: proposal.data };
}

export async function listRosterEditProposals(guildId: string, discordId: string, manage = false) {
  const context = await getCurrentLeagueContext(guildId);
  let query = supabase.from("rec_roster_edit_proposals")
    .select("*, player:rec_players(full_name,position), team:rec_teams(name,abbreviation)")
    .eq("league_id", context.leagueId).order("created_at", { ascending: false });
  if (!manage) {
    const userId = await userIdForDiscord(discordId);
    query = query.eq("proposed_by_user_id", userId);
  }
  const result = await query;
  if (result.error) throw new ApiError(500, "We couldn't load roster edit proposals.", result.error);
  return { proposals: result.data ?? [] };
}

export async function reviewRosterEditProposal(input: {
  guildId: string;
  proposalId: string;
  action: "approve" | "reject";
  reviewerDiscordId: string;
  note?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const loaded = await supabase.from("rec_roster_edit_proposals").select("*").eq("id", input.proposalId).eq("league_id", context.leagueId).maybeSingle();
  if (loaded.error || !loaded.data) throw new ApiError(404, "Roster edit proposal not found.");
  const proposal = loaded.data as any;
  if (proposal.status !== "pending_review") throw new ApiError(409, `Proposal is already ${proposal.status}.`);

  const reviewerUserId = await userIdForDiscord(input.reviewerDiscordId);
  const now = new Date().toISOString();

  if (input.action === "reject") {
    if (!input.note?.trim()) throw new ApiError(400, "A rejection reason is required.");
    const rejected = await supabase.from("rec_roster_edit_proposals").update({
      status: "rejected", commissioner_note: input.note.trim(), reviewed_by_user_id: reviewerUserId, reviewed_at: now, updated_at: now,
    }).eq("id", proposal.id);
    if (rejected.error) throw new ApiError(500, "We couldn't reject that proposal. Please try again.", rejected.error);
    await supabase.from("rec_commissioners_inbox").update({ status: "denied", reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: now, review_reason: input.note.trim() })
      .eq("source_table", "rec_roster_edit_proposals").eq("source_id", proposal.id);
    await createSiteNotification({ userId: proposal.proposed_by_user_id, leagueId: context.leagueId, kind: "roster_edit_denied", title: "Your roster edit proposal was denied", body: input.note.trim(), href: "/app" })
      .catch((error) => console.error("[WARN] Failed to notify proposer of roster-edit denial:", error));
    return { rejected: true as const };
  }

  const changes = (proposal.proposed_changes ?? {}) as RosterEditProposalChanges;
  // updateRosterPlayer REPLACES the whole attributes column rather than merging — a proposal
  // that only tweaks one or two stats must still be applied on top of the player's full
  // current attribute set, or approving it would silently wipe every other attribute.
  let mergedAttributes: Record<string, number> | undefined;
  if (changes.attributes) {
    const current = await supabase.from("rec_players").select("attributes").eq("id", proposal.player_id).maybeSingle();
    if (current.error) throw new ApiError(500, "We couldn't load the player's current attributes.", current.error);
    mergedAttributes = { ...(current.data?.attributes as Record<string, number> | null ?? {}), ...changes.attributes };
  }
  await updateRosterPlayer({
    guildId: input.guildId,
    discordId: input.reviewerDiscordId,
    playerId: proposal.player_id,
    position: changes.position,
    jerseyNumber: changes.jerseyNumber,
    devTrait: changes.devTrait,
    archetype: changes.archetype,
    attributes: mergedAttributes,
  });

  const approved = await supabase.from("rec_roster_edit_proposals").update({
    status: "approved", commissioner_note: input.note?.trim() || null, reviewed_by_user_id: reviewerUserId, reviewed_at: now, updated_at: now,
  }).eq("id", proposal.id);
  if (approved.error) throw new ApiError(500, "The roster change was applied, but we couldn't mark the proposal approved. Please try again.", approved.error);
  await supabase.from("rec_commissioners_inbox").update({ status: "approved", reviewed_by_discord_id: input.reviewerDiscordId, reviewed_at: now, review_reason: input.note?.trim() || null })
    .eq("source_table", "rec_roster_edit_proposals").eq("source_id", proposal.id);
  await createSiteNotification({ userId: proposal.proposed_by_user_id, leagueId: context.leagueId, kind: "roster_edit_approved", title: "Your roster edit proposal was approved", body: describeChanges(changes), href: "/app" })
    .catch((error) => console.error("[WARN] Failed to notify proposer of roster-edit approval:", error));

  return { approved: true as const };
}
