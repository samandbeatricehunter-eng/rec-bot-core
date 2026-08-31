import { CFB_POSITION_GROUPS, MADDEN_POSITION_GROUPS, normalizeCfbPosition, overallToGrade, isCfb, getRecEditableAttributes, REC_DEV_TRAITS } from "@rec/shared";
import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { uploadImageToCloudflare } from "../../lib/cloudflare-images.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";
import { assertGuildPermission } from "../../lib/user-auth.js";
import { listDraftPicksForTeam } from "../draft-picks/draft-picks.service.js";

export const ROSTER_DEPARTURE_STATUSES = ["drafted", "transferred_out", "retired", "graduated"] as const;
export type RosterDepartureStatus = (typeof ROSTER_DEPARTURE_STATUSES)[number];

async function userIdForDiscord(discordId: string) {
  const result = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (result.error) throw new ApiError(500, "Failed to load your REC account.", result.error);
  if (!result.data?.user_id) throw new ApiError(404, "Discord account is not linked to a REC user.");
  return result.data.user_id as string;
}

async function resolveTargetTeamId(leagueId: string, userId: string, requestedTeamId?: string | null) {
  if (requestedTeamId) {
    const team = await supabase.from("rec_teams").select("id").eq("league_id", leagueId).eq("id", requestedTeamId).maybeSingle();
    if (team.error) throw new ApiError(500, "Failed to load team.", team.error);
    if (!team.data) throw new ApiError(404, "Team not found in this league.");
    return requestedTeamId;
  }
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to load your team assignment.", assignment.error);
  if (!assignment.data?.team_id) throw new ApiError(404, "You are not linked to a team in this league.");
  return assignment.data.team_id as string;
}

export type RosterPlayer = {
  id: string;
  fullName: string;
  position: string;
  positionGroup: string;
  heightInches: number | null;
  weightLbs: number | null;
  handedness: string | null;
  classYear: string | null;
  overallRating: number | null;
  rosterStatus: string;
  isDefaultPlayer: boolean;
  recentIncrease: null;
  devTrait: string | null;
  photoUrl: string | null;
  attributes: Record<string, number | null>;
  age: number | null;
  college: string | null;
  jerseyNumber: number | null;
  archetype: string | null;
  abilities: Array<{ name: string; description?: string }> | null;
  playerSource: string | null;
};

export type RosterPositionGroup = {
  group: string;
  grade: string;
  avgOverall: number | null;
  playerCount: number;
};

export async function getTeamRoster(input: { guildId: string; discordId: string; teamId?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  // resolveTargetTeamId only ever touches userId on the "no teamId given, look up MY team"
  // fallback path -- viewing an explicitly-selected open team's roster (the /openteams "View
  // Rosters" flow) never needed it at all. Requiring a linked REC account just to browse a
  // team's roster before ever joining the league locked out exactly the people /openteams is
  // for: prospective members who haven't signed up on the site yet.
  const userId = input.teamId ? "" : await userIdForDiscord(input.discordId);
  const teamId = await resolveTargetTeamId(leagueId, userId, input.teamId);

  const team = await supabase.from("rec_teams").select("id,name,abbreviation,display_abbr,is_relocated").eq("id", teamId).single();
  if (team.error) throw new ApiError(500, "Failed to load team.", team.error);

  const players = await supabase
    .from("rec_players")
    .select("id,full_name,position,height_inches,weight_lbs,handedness,class_year,overall_rating,roster_status,is_default_player,dev_trait,photo_url,attributes,age,birth_year,college,jersey_number,archetype,abilities,player_source")
    .eq("league_id", leagueId)
    .eq("team_id", teamId)
    .in("roster_status", ["active", "transferred_in"])
    .order("position", { ascending: true })
    .order("overall_rating", { ascending: false });
  if (players.error) throw new ApiError(500, "Failed to load roster.", players.error);

  const rows: RosterPlayer[] = (players.data ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name ?? "Unknown",
    position: p.position ?? "",
    positionGroup: normalizeCfbPosition(p.position ?? ""),
    heightInches: p.height_inches,
    weightLbs: p.weight_lbs,
    handedness: p.handedness ?? null,
    classYear: p.class_year,
    overallRating: p.overall_rating,
    rosterStatus: p.roster_status ?? "active",
    isDefaultPlayer: Boolean(p.is_default_player),
    // Recorded OVR/attribute increases aren't logged yet (self-report + commissioner-approve
    // flow is a separate, not-yet-built feature) — always null until that lands.
    recentIncrease: null,
    devTrait: p.dev_trait ?? null,
    photoUrl: p.photo_url ?? null,
    attributes: (p.attributes ?? {}) as Record<string, number | null>,
    age: typeof p.age === "number" ? p.age : (typeof p.birth_year === "number" ? Math.max(18, Math.min(45, 2026 - p.birth_year)) : null),
    college: p.college ?? null,
    jerseyNumber: typeof p.jersey_number === "number" ? p.jersey_number : null,
    archetype: p.archetype ?? null,
    abilities: Array.isArray(p.abilities) ? p.abilities as Array<{ name: string; description?: string }> : null,
    playerSource: p.player_source ?? null,
  }));

  const isMadden = context.rec_leagues.game?.startsWith("madden") ?? false;
  const activeRows = rows.filter((r) => r.rosterStatus === "active" || r.rosterStatus === "transferred_in");
  const groupList: readonly string[] = isMadden ? MADDEN_POSITION_GROUPS : CFB_POSITION_GROUPS;
  const groups: RosterPositionGroup[] = groupList.map((group) => {
    const inGroup = activeRows.filter((r) => r.positionGroup === group);
    const withOverall = inGroup.filter((r) => r.overallRating != null);
    const avgOverall = withOverall.length
      ? Math.round((withOverall.reduce((sum, r) => sum + (r.overallRating ?? 0), 0) / withOverall.length) * 10) / 10
      : null;
    return {
      group,
      grade: overallToGrade(avgOverall),
      avgOverall,
      playerCount: inGroup.length,
    };
  });

  // Draft picks are a Madden-only asset (CFB leagues use recruiting/transfer portal instead)
  // shown as their own "position group" alongside the real position groups, per how coaches
  // already browse rosters here.
  const draftPicks = isMadden ? await listDraftPicksForTeam(input.guildId, teamId) : [];
  const positionGroups = isMadden
    ? [...groups, { group: "Draft Picks", grade: "—", avgOverall: null, playerCount: draftPicks.length }]
    : groups;

  // CFB leagues let coaches mark departures (Went Pro / Graduated-Retired / Transferred) any
  // time — including mid-season, so a coach catching up on a missed change isn't blocked.
  // Exposed here so the roster UI can show the per-player status selector without a round trip.
  const canEditRosterStatus = isCfb(context.rec_leagues.game);

  // Cap room is Madden-only (EA import populates it onto each week's standings snapshot, not a
  // live figure) and purely informational for the trade builder -- best-effort, non-fatal if
  // the league has never had a snapshot yet (e.g. a brand-new Madden league before its first
  // import) or isn't Madden at all.
  let capRoom: number | null = null;
  if (isMadden) {
    const snapshot = await supabase.from("rec_team_standings_snapshots")
      .select("cap_room")
      .eq("team_id", teamId)
      .order("season_number", { ascending: false })
      .order("week_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    capRoom = snapshot.data?.cap_room ?? null;
  }

  return {
    team: {
      id: team.data.id,
      name: team.data.name,
      abbreviation: team.data.display_abbr || team.data.abbreviation,
      capRoom,
    },
    players: rows,
    positionGroups,
    draftPicks,
    canEditRosterStatus,
  };
}

/** True if the requester may manage this team's roster — its own coach, or a co-commissioner+. */
async function assertCanManageTeamRoster(guildId: string, discordId: string, leagueId: string, userId: string, teamId: string) {
  const isCommish = await assertGuildPermission(guildId, discordId, "co_commissioner").then(() => true).catch(() => false);
  if (isCommish) return;
  const assignment = await supabase
    .from("rec_team_assignments")
    .select("team_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .eq("assignment_status", "active")
    .is("ended_at", null)
    .maybeSingle();
  if (assignment.error) throw new ApiError(500, "Failed to check team assignment.", assignment.error);
  if (assignment.data?.team_id !== teamId) {
    throw new ApiError(403, "Only that team's coach or a commissioner can manage this roster.");
  }
}

/** Mark a departing player drafted/transferred out/retired/graduated — never touches active
 * roster math destructively, just flips roster_status so the roster viewer (and later, editorial
 * signals) can tell who's still on the team. */
export async function setPlayerDeparture(input: {
  guildId: string;
  discordId: string;
  playerId: string;
  status: RosterDepartureStatus;
  note?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const player = await supabase.from("rec_players").select("id,team_id,league_id").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (!player.data.team_id) throw new ApiError(409, "Player has no team.");

  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, player.data.team_id);

  if (input.status === "transferred_out" && !input.note?.trim()) {
    throw new ApiError(400, "Enter the school this player transferred to.");
  }

  const updated = await supabase
    .from("rec_players")
    .update({ roster_status: input.status, status_changed_at: new Date().toISOString(), status_note: input.note?.trim() || null })
    .eq("id", input.playerId)
    .select("id,full_name,roster_status")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to update player status.", updated.error);

  if (input.status === "drafted") {
    await incrementPlayersGoneProCounters(leagueId, userId, resolveSeasonNumber(context));
  }

  return updated.data;
}

async function incrementPlayersGoneProCounters(leagueId: string, userId: string, seasonNumber: number) {
  const season = await supabase.from("rec_season_user_records").select("id,players_gone_pro").eq("league_id", leagueId).eq("season_number", seasonNumber).eq("user_id", userId).maybeSingle();
  if (season.data) {
    await supabase.from("rec_season_user_records").update({ players_gone_pro: Number(season.data.players_gone_pro ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", season.data.id);
  } else {
    await supabase.from("rec_season_user_records").insert({ league_id: leagueId, season_number: seasonNumber, user_id: userId, players_gone_pro: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  const global = await supabase.from("rec_global_user_records").select("user_id,players_gone_pro_career").eq("user_id", userId).maybeSingle();
  if (global.data) {
    await supabase.from("rec_global_user_records").update({ players_gone_pro_career: Number(global.data.players_gone_pro_career ?? 0) + 1, updated_at: new Date().toISOString() }).eq("user_id", userId);
  } else {
    await supabase.from("rec_global_user_records").insert({ user_id: userId, players_gone_pro_career: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
}

/** Directly add a tracked player to a team's roster — the commissioner's "Edit Rosters" path
 * (any team) and the auto-approved path when a commissioner submits their own "Edit Roster"
 * quick-action request. Never touches is_default_player (stays false), matching the rule that
 * only recruits/manually-added players are eligible replacement targets for custom players and
 * legend purchases. */
export async function addRosterPlayer(input: {
  guildId: string;
  discordId: string;
  teamId: string;
  firstName: string;
  lastName: string;
  position: string;
  heightInches?: number | null;
  weightLbs?: number | null;
  handedness?: string | null;
  overallRating?: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);
  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, input.teamId);

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ApiError(400, "First and last name are required.");
  const position = input.position.trim().toUpperCase();
  if (!position) throw new ApiError(400, "Position is required.");

  const inserted = await supabase
    .from("rec_players")
    .insert({
      league_id: leagueId,
      team_id: input.teamId,
      madden_player_id: `manual:${leagueId}:${crypto.randomUUID()}`,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      position,
      height_inches: input.heightInches ?? null,
      weight_lbs: input.weightLbs ?? null,
      handedness: input.handedness ?? null,
      overall_rating: input.overallRating ?? null,
      is_free_agent: false,
      is_default_player: false,
      player_source: "manual_roster_add",
      roster_status: "active",
      status_changed_at: new Date().toISOString(),
      raw_payload: {},
    })
    .select("id,full_name,position,roster_status")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to add player to roster.", inserted.error);
  return inserted.data;
}

/** Reinstate a player accidentally marked as departed, or one who "stayed another year" after
 * being logged as entering the portal — back to active with no status note. */
export async function reinstatePlayer(input: { guildId: string; discordId: string; playerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const player = await supabase.from("rec_players").select("id,team_id").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (!player.data.team_id) throw new ApiError(409, "Player has no team.");

  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, player.data.team_id);

  const updated = await supabase
    .from("rec_players")
    .update({ roster_status: "active", status_changed_at: new Date().toISOString(), status_note: null })
    .eq("id", input.playerId)
    .select("id,full_name,roster_status")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to reinstate player.", updated.error);
  return updated.data;
}

/** Hard-removes a player from the roster entirely — for correcting a mistaken entry (wrong
 * position/name on an add, a duplicate, etc.), not a real roster-status transition like
 * graduated/drafted/transferred (those stay reversible via reinstatePlayer). No commissioner
 * approval needed, same as every other status change here — team ownership is the only gate.
 * The frontend is expected to confirm with the user before calling this; it's irreversible. */
export async function deleteRosterPlayer(input: { guildId: string; discordId: string; playerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const player = await supabase.from("rec_players").select("id,team_id,full_name").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (!player.data.team_id) throw new ApiError(409, "Player has no team.");

  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, player.data.team_id);

  const deleted = await supabase.from("rec_players").delete().eq("id", input.playerId).select("id,full_name").maybeSingle();
  if (deleted.error) throw new ApiError(500, "Failed to remove player.", deleted.error);
  return { removed: true as const, fullName: player.data.full_name as string };
}

/** Log an incoming transfer — a brand-new rec_players row, never a baseline/default player
 * (is_default_player stays false), so it's naturally exempt from the default-player purchase
 * restriction that's planned for the attribute-upgrade flow. */
export async function addTransferInPlayer(input: {
  guildId: string;
  discordId: string;
  teamId: string;
  firstName: string;
  lastName: string;
  position: string;
  classYear?: string | null;
  overallRating?: number | null;
  heightInches?: number | null;
  weightLbs?: number | null;
  handedness?: string | null;
  note?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);
  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, input.teamId);

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ApiError(400, "First and last name are required.");
  const position = input.position.trim().toUpperCase();
  if (!position) throw new ApiError(400, "Position is required.");

  const inserted = await supabase
    .from("rec_players")
    .insert({
      league_id: leagueId,
      team_id: input.teamId,
      madden_player_id: `transfer:${leagueId}:${crypto.randomUUID()}`,
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`,
      position,
      class_year: input.classYear ?? null,
      overall_rating: input.overallRating ?? null,
      height_inches: input.heightInches ?? null,
      weight_lbs: input.weightLbs ?? null,
      handedness: input.handedness ?? null,
      is_free_agent: false,
      is_default_player: false,
      roster_status: "transferred_in",
      status_changed_at: new Date().toISOString(),
      status_note: input.note?.trim() || null,
      raw_payload: {},
    })
    .select("id,full_name,roster_status")
    .single();
  if (inserted.error) throw new ApiError(500, "Failed to log incoming transfer.", inserted.error);
  return inserted.data;
}

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** League Mgmt headshot upload (plan §11): a commissioner-facing form control in the roster
 * editor that uploads one player's custom headshot to Cloudflare Images and overwrites that
 * player's rec_players.photo_url. Re-uploads use the player id as the Cloudflare image id,
 * so replacing a headshot overwrites the same image instead of accumulating orphans. */
export async function uploadPlayerPhoto(input: {
  guildId: string;
  discordId: string;
  playerId: string;
  contentType: string;
  imageBuffer: Buffer;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const player = await supabase.from("rec_players").select("id,team_id,league_id").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (!player.data.team_id) throw new ApiError(409, "Player has no team.");

  await assertCanManageTeamRoster(input.guildId, input.discordId, leagueId, userId, player.data.team_id);

  if (!PHOTO_ALLOWED_TYPES.has(input.contentType)) {
    throw new ApiError(400, "Headshot must be a JPEG, PNG, or WebP image.");
  }
  if (input.imageBuffer.length === 0 || input.imageBuffer.length > PHOTO_MAX_BYTES) {
    throw new ApiError(400, "Headshot must be between 1 byte and 5 MB.");
  }

  // Square-ish 2-3x the app's ~96px roster slots (≈300px) reads crisp on retina; the field
  // hint text repeats this so it lands in front of the person cropping the source image.
  const uploaded = await uploadImageToCloudflare({
    buffer: input.imageBuffer,
    contentType: input.contentType,
    imageId: input.playerId,
    meta: { leagueId, playerId: input.playerId },
  });

  const updated = await supabase
    .from("rec_players")
    .update({ photo_url: uploaded.url, updated_at: new Date().toISOString() })
    .eq("id", input.playerId)
    .select("id,full_name,photo_url")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to save the player's headshot.", updated.error);

  return { playerId: updated.data.id, photoUrl: updated.data.photo_url };
}

// ---------------------------------------------------------------------------
// Roster pool editor — League Mgmt "Edit Rosters" side of the plan: the commissioner
// sees every unassigned player (the draft pool in fantasy_draft leagues, the free-agent
// pool elsewhere) and can assign WHOLE players to a team, release a roster player back
// into the pool, or edit a player's identity/attributes in place. Mirrors the fantasy
// draft's team_id/is_free_agent lifecycle: assignment sets team_id + is_free_agent false,
// release reverses it (team_id null + is_free_agent true), so released players reappear in
// the pool the same way an undone draft pick does.
// ---------------------------------------------------------------------------

export type RosterPoolPlayer = {
  id: string;
  fullName: string;
  position: string;
  positionGroup: string;
  jerseyNumber: number | null;
  archetype: string | null;
  devTrait: string | null;
  overallRating: number | null;
  heightInches: number | null;
  weightLbs: number | null;
  handedness: string | null;
  photoUrl: string | null;
  isFreeAgent: boolean;
  attributes: Record<string, number | null>;
  abilities: Array<{ name: string; description: string }> | null;
};

/** Unassigned players (team_id null) in position-group order, with per-group counts and
 * grade so the pool view reads like the team-roster viewer it mirrors. `search` matches
 * the player's full name; `positionGroup` is an exact position-group code. */
export async function listRosterPool(input: { guildId: string; discordId: string; search?: string | null; positionGroup?: string | null }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const { data, error } = await supabase
    .from("rec_players")
    .select("id,full_name,position,jersey_number,archetype,dev_trait,overall_rating,height_inches,weight_lbs,handedness,photo_url,is_free_agent,attributes,abilities")
    .eq("league_id", leagueId)
    .is("team_id", null)
    .order("position", { ascending: true })
    .order("overall_rating", { ascending: false });
  if (error) throw new ApiError(500, "Failed to load the player pool.", error);

  const search = input.search?.trim().toLowerCase();
  const positionGroup = input.positionGroup?.trim().toUpperCase();
  const filtered = (data ?? []).filter((p) => {
    if (search && !(p.full_name ?? "").toLowerCase().includes(search)) return false;
    if (positionGroup && normalizeCfbPosition(p.position ?? "") !== positionGroup) return false;
    return true;
  });

  const players: RosterPoolPlayer[] = filtered.map((p) => ({
    id: p.id,
    fullName: p.full_name ?? "Unknown",
    position: p.position ?? "",
    positionGroup: normalizeCfbPosition(p.position ?? ""),
    jerseyNumber: p.jersey_number,
    archetype: p.archetype ?? null,
    devTrait: p.dev_trait ?? null,
    overallRating: p.overall_rating,
    heightInches: p.height_inches,
    weightLbs: p.weight_lbs,
    handedness: p.handedness ?? null,
    photoUrl: p.photo_url ?? null,
    isFreeAgent: Boolean(p.is_free_agent),
    attributes: (p.attributes ?? {}) as Record<string, number | null>,
    abilities: (p.abilities ?? null) as Array<{ name: string; description: string }> | null,
  }));

  const isMadden = context.rec_leagues.game?.startsWith("madden") ?? false;
  const groupList: readonly string[] = isMadden ? MADDEN_POSITION_GROUPS : CFB_POSITION_GROUPS;
  const positionGroups: RosterPositionGroup[] = groupList.map((group) => {
    const inGroup = players.filter((r) => r.positionGroup === group);
    const withOverall = inGroup.filter((r) => r.overallRating != null);
    const avgOverall = withOverall.length
      ? Math.round((withOverall.reduce((sum, r) => sum + (r.overallRating ?? 0), 0) / withOverall.length) * 10) / 10
      : null;
    return {
      group,
      grade: overallToGrade(avgOverall),
      avgOverall,
      playerCount: inGroup.length,
    };
  });

  return { players, positionGroups };
}

/** Assign an unassigned pool player to a team — the commissioner's "assign from the pool"
 * action and the post-draft assign-the-pool flow. Only league teams are valid targets,
 * and only team_id-null players can be assigned (mirrors recordPick's guard). */
export async function assignRosterPlayer(input: { guildId: string; discordId: string; playerId: string; teamId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const [player, team] = await Promise.all([
    supabase.from("rec_players").select("id,team_id,is_free_agent").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle(),
    supabase.from("rec_teams").select("id").eq("id", input.teamId).eq("league_id", leagueId).maybeSingle(),
  ]);
  if (player.error) throw new ApiError(500, "Failed to load that player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (player.data.team_id != null) throw new ApiError(409, "That player is already assigned to a team.");
  if (team.error) throw new ApiError(500, "Failed to load that team.", team.error);
  if (!team.data) throw new ApiError(404, "Team not found in this league.");

  const updated = await supabase
    .from("rec_players")
    .update({ team_id: input.teamId, is_free_agent: false, updated_at: new Date().toISOString() })
    .eq("id", input.playerId)
    .select("id,full_name,team_id")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to assign that player.", updated.error);
  return { ok: true as const, playerId: updated.data.id, fullName: updated.data.full_name, teamId: updated.data.team_id };
}

/** Release a roster player back into the pool (team_id null + is_free_agent true), where
 * they reappear in the pool/assign dropdowns — the editor's "Remove" action. */
export async function releaseRosterPlayer(input: { guildId: string; discordId: string; playerId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);

  const player = await supabase.from("rec_players").select("id,team_id,full_name").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load that player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");
  if (player.data.team_id == null) throw new ApiError(409, "That player is already in the pool.");

  const updated = await supabase
    .from("rec_players")
    .update({ team_id: null, is_free_agent: true, updated_at: new Date().toISOString() })
    .eq("id", input.playerId)
    .select("id,full_name")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to release that player.", updated.error);
  return { ok: true as const, playerId: updated.data.id, fullName: updated.data.full_name };
}

/** Edit a player's identity + attributes in place — the league editor's full edit modal
 * (all fields, including the full attribute grid). Game-aware: dev trait is a Madden
 * concept and is ignored for CFB leagues; class year is a CFB concept and is ignored for
 * Madden. Attributes are validated against the shared editable set (all 53 Madden codes). */
export async function updateRosterPlayer(input: {
  guildId: string;
  discordId: string;
  playerId: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  jerseyNumber?: number | null;
  archetype?: string | null;
  devTrait?: string | null;
  classYear?: string | null;
  overallRating?: number | null;
  heightInches?: number | null;
  weightLbs?: number | null;
  handedness?: string | null;
  attributes?: Record<string, number>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const leagueId = context.leagueId;
  const userId = await userIdForDiscord(input.discordId);
  const isMadden = context.rec_leagues.game?.startsWith("madden") ?? false;

  const player = await supabase.from("rec_players").select("id,full_name").eq("id", input.playerId).eq("league_id", leagueId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load that player.", player.error);
  if (!player.data) throw new ApiError(404, "Player not found in this league.");

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.firstName !== undefined || input.lastName !== undefined) {
    const firstName = (input.firstName ?? player.data.full_name?.split(/\s+/)[0] ?? "").trim();
    const lastName = (input.lastName ?? player.data.full_name?.split(/\s+/).slice(1).join(" ") ?? "").trim();
    if (!firstName || !lastName) throw new ApiError(400, "First and last name are required.");
    patch.first_name = firstName;
    patch.last_name = lastName;
    patch.full_name = `${firstName} ${lastName}`;
  }

  if (input.position !== undefined) {
    const position = input.position.trim().toUpperCase();
    if (!position) throw new ApiError(400, "Position is required.");
    patch.position = position;
  }
  if (input.jerseyNumber !== undefined) {
    if (input.jerseyNumber != null && (input.jerseyNumber < 0 || input.jerseyNumber > 99)) throw new ApiError(400, "Jersey number must be 0-99.");
    patch.jersey_number = input.jerseyNumber;
  }
  if (input.archetype !== undefined) patch.archetype = input.archetype || null;
  if (isMadden && input.devTrait !== undefined) {
    const valid = REC_DEV_TRAITS.MADDEN.some((t) => t.key === input.devTrait);
    if (input.devTrait && !valid) throw new ApiError(400, "That development trait isn't valid for Madden.");
    patch.dev_trait = input.devTrait || null;
  }
  if (!isMadden && input.classYear !== undefined) {
    const valid = ["FR", "SO", "JR", "SR", "RS-FR", "RS-SO", "RS-JR", "RS-SR"].includes(input.classYear ?? "");
    if (input.classYear && !valid) throw new ApiError(400, "That class year isn't valid.");
    patch.class_year = input.classYear || null;
  }
  if (input.overallRating !== undefined) {
    if (input.overallRating != null && (input.overallRating < 0 || input.overallRating > 99)) throw new ApiError(400, "Overall rating must be 0-99.");
    patch.overall_rating = input.overallRating;
  }
  if (input.heightInches !== undefined) {
    if (input.heightInches != null && (input.heightInches < 48 || input.heightInches > 90)) throw new ApiError(400, "Height must be 48-90 inches.");
    patch.height_inches = input.heightInches;
  }
  if (input.weightLbs !== undefined) {
    if (input.weightLbs != null && (input.weightLbs < 100 || input.weightLbs > 450)) throw new ApiError(400, "Weight must be 100-450 lbs.");
    patch.weight_lbs = input.weightLbs;
  }
  if (input.handedness !== undefined) {
    if (input.handedness && !["left", "right"].includes(input.handedness)) throw new ApiError(400, "Handedness must be left or right.");
    patch.handedness = input.handedness || null;
  }

  if (input.attributes !== undefined) {
    const editable = new Set(getRecEditableAttributes(isMadden ? "MADDEN" : "CFB", "", undefined));
    const attributes: Record<string, number> = {};
    for (const [key, value] of Object.entries(input.attributes)) {
      const code = key.trim().toLowerCase();
      if (!editable.has(code)) throw new ApiError(400, `Attribute ${key} isn't editable.`);
      if (!Number.isInteger(value) || value < 0 || value > 99) throw new ApiError(400, `Attribute ${key} must be an integer from 0 through 99.`);
      attributes[code] = value;
    }
    patch.attributes = attributes;
  }

  const updated = await supabase
    .from("rec_players")
    .update(patch)
    .eq("id", input.playerId)
    .select("id,full_name,position,overall_rating")
    .single();
  if (updated.error) throw new ApiError(500, "Failed to update that player.", updated.error);
  return { ok: true as const, playerId: updated.data.id, fullName: updated.data.full_name, position: updated.data.position, overallRating: updated.data.overall_rating };
}
