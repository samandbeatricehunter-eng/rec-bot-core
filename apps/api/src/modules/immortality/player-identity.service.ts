/**
 * Rise to Immortality Pass 2 (Identity Integrity).
 *
 * Every RTI prospect's rec_players row starts out as a synthetic placeholder (a non-numeric
 * madden_player_id). ea-direct-writer.ts's directWriteRoster() already adopts real EA rows onto
 * matching placeholders in place (rec_players.id never changes, so
 * rec_immortality_prospects.player_id stays valid across the transition) -- this module doesn't
 * duplicate that adoption logic, it only tracks *whether* it happened for each prospect and
 * surfaces a commissioner-actionable signal when it hasn't, so grading never silently runs off a
 * synthetic/stale stat line (see gradeProspectForWeek's identity_status gate in
 * xp-awards.service.ts).
 */
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getPgPool } from "../../db/client.js";
import { findServerRoutesForLeague } from "../league-context/league-context.service.js";
import { notifyLeagueCommissionersOfPendingItem } from "../notifications/commissioner-pending-summary.js";
import { discordIdForRecUser, loadImmortalityLeague, resolveProspectTeamName } from "./immortality.service.js";

export type IdentityStatus = "synthetic" | "verified" | "missing" | "ambiguous" | "stale" | "matched_pending_apply";

type ProspectIdentityRow = {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  position: string;
  side: string;
  player_id: string | null;
  identity_status: IdentityStatus | null;
  review_status: string | null;
  reviewed_at: string | null;
  headshot_url?: string | null;
};

export const RTI_SYNTHETIC_MADDEN_PREFIX = "rti:";

function isNumericId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^[0-9]+$/.test(id);
}

/** True for an RTI-created prospect both before and after EA identity adoption.
 * Placeholders keep a `rti:{prospectId}` madden id; after the real EA row is adopted in place,
 * that column becomes a numeric franchise id, so callers must also match `rec_players.id`
 * against rec_immortality_prospects.player_id. */
export function isImmortalityCreatedPlayer(
  maddenPlayerId: string | null | undefined,
  recPlayerId: string | null | undefined,
  prospectPlayerIds: Set<string>,
): boolean {
  if (String(maddenPlayerId ?? "").startsWith(RTI_SYNTHETIC_MADDEN_PREFIX)) return true;
  return Boolean(recPlayerId && prospectPlayerIds.has(String(recPlayerId)));
}

export async function loadRtiProspectPlayerIds(leagueId: string): Promise<Set<string>> {
  const immortality = await loadImmortalityLeague(leagueId);
  if (!immortality) return new Set();
  const rows = await supabase.from("rec_immortality_prospects")
    .select("player_id")
    .eq("immortality_league_id", immortality.id)
    .not("player_id", "is", null);
  return new Set(
    (rows.data ?? [])
      .map((row: { player_id: string | null }) => row.player_id)
      .filter((id): id is string => Boolean(id)),
  );
}

/** Creation/upload headshots live on rec_immortality_prospects.headshot_url. EA import then
 * stamps the replaced Madden player's baseline portrait onto rec_players.photo_url (EA-ID
 * restore). Always overwrite the roster row with the prospect's chosen photo -- including
 * clearing it when they never picked one, so the replaced player's face never stays. */
export async function applyRtiCreatedPlayerPhotos(leagueId: string): Promise<number> {
  const result = await getPgPool().query(
    `update rec_players p
        set photo_url = pr.headshot_url, updated_at = now()
       from rec_immortality_prospects pr
       join rec_immortality_leagues l on l.id = pr.immortality_league_id
      where pr.player_id = p.id
        and l.league_id = $1
        and p.league_id = $1
        and p.photo_url is distinct from pr.headshot_url`,
    [leagueId],
  );
  return result.rowCount ?? 0;
}

function fullNameFor(prospect: { first_name: string | null; last_name: string | null }): string {
  return `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Unnamed Prospect";
}

/** Pure decision table for one prospect's identity status, given what's already been resolved
 * from rec_players (isNumericId(madden_player_id), rosterStatus) and, for a still-synthetic
 * placeholder, how many non-numeric placeholders on the same team share its exact name --
 * siblingCount includes the prospect's own row, so 1 means "just itself" (not yet adopted, but
 * unambiguous) and 2+ means at least one other placeholder shares the name too (genuinely
 * ambiguous). Kept separate from reconcileRtiProspectIdentities' DB orchestration so the state
 * machine itself is unit-testable without a pool. */
export function nextIdentityStatus(input: {
  name: string;
  isNumericId: boolean;
  rosterStatus: string | null;
  siblingCount: number;
  appliedInGame: boolean;
}): { status: Exclude<IdentityStatus, "synthetic">; note: string } {
  if (input.isNumericId) {
    if (input.rosterStatus !== "active") {
      return {
        status: "stale",
        note: `${input.name}'s linked player is no longer active on the imported roster (status: ${input.rosterStatus ?? "unknown"}). Re-link them to their current roster entry.`,
      };
    }
    // A real roster-name match by itself isn't enough -- the commissioner also has to have
    // actually clicked "Applied In Game" on the original prospect review (review_status
    // ='approved' AND reviewed_at set by reviewImmortalityProspect; review_status alone is not
    // the real signal, since it's also auto-set to 'approved' the instant Creation Points is
    // submitted, with reviewed_at left null -- see reviewImmortalityProspect's doc comment).
    if (!input.appliedInGame) {
      return {
        status: "matched_pending_apply",
        note: `A roster match was found for ${input.name}, but this build hasn't been marked "Applied In Game" yet. Approve the original prospect review to confirm you've created them in Madden.`,
      };
    }
    return { status: "verified", note: "" };
  }
  if (input.siblingCount >= 2) {
    return {
      status: "ambiguous",
      note: `${input.siblingCount} placeholders on this team share the exact name "${input.name}" -- the importer can't tell which one is this prospect. Pick the right roster entry manually.`,
    };
  }
  return {
    status: "missing",
    note: `No imported roster player named "${input.name}" has matched this prospect's placeholder yet. If the in-game custom-player name doesn't exactly match, link it manually.`,
  };
}

async function writeIdentityIssue(input: {
  guildId: string; leagueId: string; prospect: ProspectIdentityRow; status: "missing" | "ambiguous" | "stale" | "matched_pending_apply"; note: string; teamName: string | null;
}): Promise<void> {
  const existing = await supabase.from("rec_commissioners_inbox")
    .select("id")
    .eq("guild_id", input.guildId)
    .eq("queue_type", "immortality_identity_issue")
    .eq("source_table", "rec_immortality_prospects")
    .eq("source_id", input.prospect.id)
    .maybeSingle();
  if (existing.error) {
    console.error(`[ERROR] Failed to check existing identity-issue inbox row for prospect ${input.prospect.id} (non-fatal):`, existing.error);
    return;
  }

  const discordId = await discordIdForRecUser(input.prospect.user_id).catch(() => null);
  const name = fullNameFor(input.prospect);
  const payload = {
    guild_id: input.guildId,
    league_id: input.leagueId,
    queue_type: "immortality_identity_issue",
    status: "pending",
    priority: input.status === "ambiguous" ? 1 : 0,
    header: `Identity ${input.status === "missing" ? "Not Found" : input.status === "ambiguous" ? "Ambiguous" : input.status === "matched_pending_apply" ? "Awaiting Applied In Game" : "Went Stale"}: ${name} (${input.prospect.position})${input.teamName ? ` — ${input.teamName}` : ""}`,
    summary: input.note,
    requester_user_id: input.prospect.user_id,
    requester_discord_id: discordId,
    source_table: "rec_immortality_prospects",
    source_id: input.prospect.id,
    reviewed_by_discord_id: null,
    reviewed_at: null,
    review_reason: null,
    payload: {
      prospectId: input.prospect.id, status: input.status, name,
      position: input.prospect.position, side: input.prospect.side, note: input.note,
    },
    updated_at: new Date().toISOString(),
  };
  const write = existing.data
    ? await supabase.from("rec_commissioners_inbox").update(payload).eq("id", existing.data.id)
    : await supabase.from("rec_commissioners_inbox").insert(payload);
  if (write.error) {
    console.error(`[ERROR] Failed to write identity-issue inbox row for prospect ${input.prospect.id} (non-fatal):`, write.error);
    return;
  }
  await notifyLeagueCommissionersOfPendingItem(input.leagueId);
}

async function resolveIdentityIssue(guildId: string, prospectId: string, reviewerDiscordId?: string | null): Promise<void> {
  await supabase.from("rec_commissioners_inbox").update({
    status: "resolved",
    reviewed_by_discord_id: reviewerDiscordId ?? null,
    reviewed_at: new Date().toISOString(),
  })
    .eq("guild_id", guildId)
    .eq("queue_type", "immortality_identity_issue")
    .eq("source_table", "rec_immortality_prospects")
    .eq("source_id", prospectId)
    .eq("status", "pending");
}

/** Called once per import (see awardImmortalityChallengesAfterAdvance, which every import and
 * Advance path routes through) so grading always sees fresh identity status the same pass it
 * runs. Cheap and idempotent -- safe to call redundantly or on a league with no changes at all. */
export async function reconcileRtiProspectIdentities(leagueId: string): Promise<void> {
  const immortality = await loadImmortalityLeague(leagueId);
  if (!immortality) return;

  const prospects = await supabase.from("rec_immortality_prospects")
    .select("id,user_id,first_name,last_name,position,side,player_id,identity_status,review_status,reviewed_at,headshot_url")
    .eq("immortality_league_id", immortality.id)
    .not("player_id", "is", null);
  if (prospects.error || !prospects.data?.length) return;

  const routes = await findServerRoutesForLeague(leagueId).catch(() => null);
  const guildId = routes?.guildId ?? null;
  const now = new Date().toISOString();

  for (const prospect of prospects.data as ProspectIdentityRow[]) {
    let player = await supabase.from("rec_players")
      .select("id,team_id,roster_status,madden_player_id,full_name,photo_url")
      .eq("id", prospect.player_id)
      .maybeSingle();
    if (player.error || !player.data) continue;

    // Self-heal path: ea-direct-writer.ts / madden-companion.canonical.ts are supposed to adopt
    // a real EA roster row onto this exact placeholder IN PLACE (see this module's doc comment),
    // but if that adoption ever misses -- team resolution not ready yet, a duplicate-key race,
    // etc. -- the import instead inserts a SEPARATE new row with the real numeric madden_player_id
    // and leaves this placeholder orphaned (usually roster_status flips to 'removed' once the real
    // roster no longer lists the synthetic entry). Confirmed live in M27 RTI (2026-09-08): a
    // prospect stayed linked to an orphaned placeholder while the real active row -- with a full
    // week's real stats already attached -- sat unlinked, showing as "Identity Not Found" and a
    // blank Season Snapshot despite the player existing and having played. Detect and repair that
    // here (before computing this prospect's status) instead of just reporting "missing" for a
    // player who, from the coach's perspective, obviously already exists in-game.
    if (!isNumericId(player.data.madden_player_id)) {
      const orphanCandidate = await getPgPool().query<{ id: string; photo_url: string | null }>(
        `select id, photo_url from rec_players
         where team_id = $1 and lower(full_name) = lower($2) and id <> $3
           and roster_status = 'active' and madden_player_id ~ '^[0-9]+$'
         limit 2`,
        [player.data.team_id, player.data.full_name ?? "", player.data.id],
      );
      if (orphanCandidate.rows.length > 1) {
        // limit 2 above exists specifically to detect this case -- two-or-more active rows share
        // this placeholder's name/team, so auto-repair can't safely guess which one to adopt.
        // Surface it distinctly instead of silently falling through as "no candidate found," which
        // would otherwise be indistinguishable from the 0-match case below.
        console.warn(`[player-identity] reconcileRtiProspectIdentities: ambiguous self-heal for orphaned placeholder ${player.data.id} (${player.data.full_name ?? "unknown"}) on team ${player.data.team_id} -- ${orphanCandidate.rows.length}+ active candidates share its name, skipping auto-repair for manual review.`);
      } else if (orphanCandidate.rows.length === 1) {
        const target = orphanCandidate.rows[0];
        const sourcePhoto = prospect.headshot_url || player.data.photo_url;
        if (sourcePhoto && sourcePhoto !== target.photo_url) {
          await supabase.from("rec_players").update({ photo_url: sourcePhoto, updated_at: now }).eq("id", target.id);
        }
        await supabase.from("rec_immortality_prospects").update({ player_id: target.id, updated_at: now }).eq("id", prospect.id);
        player = await supabase.from("rec_players")
          .select("id,team_id,roster_status,madden_player_id,full_name,photo_url")
          .eq("id", target.id)
          .maybeSingle();
        if (player.error || !player.data) continue;
        // Regrading here (before identity_status is updated below) would be a no-op --
        // gradeProspectForWeek gates on identity_status, which in the DB is still whatever it
        // was before this self-heal until the update further down commits "verified". The
        // regrade call below (after that commit) is what actually catches this prospect up.
      }
    }

    const wasStatus: IdentityStatus = prospect.identity_status ?? "synthetic";
    const numericId = isNumericId(player.data.madden_player_id);
    let siblingCount = 0;
    if (!numericId) {
      // The query builder has no case-insensitive/regex filter, so this goes straight to the
      // pool -- exactly how ea-direct-writer.ts's own placeholder-adoption lookup does it.
      const siblings = await getPgPool().query<{ id: string; madden_player_id: string | null }>(
        `select id, madden_player_id from rec_players where team_id = $1 and lower(full_name) = lower($2)`,
        [player.data.team_id, player.data.full_name ?? ""],
      );
      // Includes the prospect's own row -- nextIdentityStatus's siblingCount>=2 means "this
      // placeholder plus at least one other share the name," i.e. genuinely ambiguous.
      siblingCount = siblings.rows.filter((row) => !isNumericId(row.madden_player_id)).length;
    }
    const appliedInGame = prospect.review_status === "approved" && prospect.reviewed_at != null;
    const { status: target, note } = nextIdentityStatus({
      name: fullNameFor(prospect), isNumericId: numericId, rosterStatus: player.data.roster_status, siblingCount, appliedInGame,
    });

    if (target === wasStatus) {
      await supabase.from("rec_immortality_prospects").update({ identity_checked_at: now }).eq("id", prospect.id);
      continue;
    }

    const update: Record<string, unknown> = { identity_status: target, identity_checked_at: now };
    if (target === "verified") {
      update.identity_verified_at = now;
      update.identity_match_method = "exact_name_team";
      update.identity_note = null;
    } else {
      update.identity_note = note;
    }
    await supabase.from("rec_immortality_prospects").update(update).eq("id", prospect.id);

    // Newly verified (from any other status, including via the self-heal above): catch up on
    // every completed week this prospect's identity was too broken to grade. Regardless of
    // guildId -- this is about game stats, not Discord notifications, so it must not be skipped
    // just because server routes haven't been resolved.
    if (target === "verified" && wasStatus !== "verified") {
      await regradeProspectHistory({ leagueId, prospectId: prospect.id }).catch((error) => {
        console.error(`[ERROR] Regrade after identity verification failed for prospect ${prospect.id} (non-fatal):`, error);
      });
    }

    if (!guildId) continue;
    if (target === "verified") {
      await resolveIdentityIssue(guildId, prospect.id);
    } else {
      const teamName = await resolveProspectTeamName(leagueId, { player_id: prospect.player_id, user_id: prospect.user_id });
      await writeIdentityIssue({ guildId, leagueId, prospect, status: target, note, teamName });
    }
  }

  await applyRtiCreatedPlayerPhotos(leagueId).catch((error) => {
    console.error(`[ERROR] RTI created-player photo restore failed for league ${leagueId} (non-fatal):`, error);
  });
}

export type RosterCandidate = {
  id: string;
  fullName: string;
  position: string;
  jerseyNumber: number | null;
  overallRating: number | null;
  maddenPlayerId: string | null;
  teamId: string | null;
};

export async function searchRosterCandidates(input: {
  leagueId: string; teamId?: string | null; query: string;
}): Promise<RosterCandidate[]> {
  const trimmed = input.query.trim();
  if (!trimmed) return [];
  // Case-insensitive partial match -- straight to the pool, same reason as reconcile's sibling
  // check above (the query builder has no ilike()).
  const params: unknown[] = [input.leagueId, `%${trimmed}%`];
  let teamClause = "";
  if (input.teamId) {
    params.push(input.teamId);
    teamClause = ` and team_id = $${params.length}`;
  }
  const { rows } = await getPgPool().query<{
    id: string; full_name: string | null; position: string | null; jersey_number: number | null;
    overall_rating: number | null; madden_player_id: string | null; team_id: string | null;
  }>(
    `select id, full_name, position, jersey_number, overall_rating, madden_player_id, team_id
     from rec_players
     where league_id = $1 and roster_status = 'active' and full_name ilike $2${teamClause}
     order by full_name asc
     limit 25`,
    params,
  );
  return rows.map((row) => ({
    id: String(row.id),
    fullName: row.full_name ?? "",
    position: row.position ?? "",
    jerseyNumber: row.jersey_number ?? null,
    overallRating: row.overall_rating ?? null,
    maddenPlayerId: row.madden_player_id ?? null,
    teamId: row.team_id ? String(row.team_id) : null,
  }));
}

export async function linkProspectToPlayer(input: {
  guildId: string; leagueId: string; prospectId: string; playerId: string; reviewerDiscordId: string;
}): Promise<void> {
  const prospect = await supabase.from("rec_immortality_prospects")
    .select("id,player_id")
    .eq("id", input.prospectId)
    .maybeSingle();
  if (prospect.error) throw new ApiError(500, "Failed to load prospect.", prospect.error);
  if (!prospect.data) throw new ApiError(404, "Prospect not found.");

  const alreadyLinked = await supabase.from("rec_immortality_prospects")
    .select("id")
    .eq("player_id", input.playerId)
    .neq("id", input.prospectId)
    .maybeSingle();
  if (alreadyLinked.error) throw new ApiError(500, "Failed to check existing links.", alreadyLinked.error);
  if (alreadyLinked.data) throw new ApiError(400, "That player is already linked to a different prospect.");

  const player = await supabase.from("rec_players").select("id,league_id").eq("id", input.playerId).maybeSingle();
  if (player.error) throw new ApiError(500, "Failed to load target player.", player.error);
  if (!player.data) throw new ApiError(404, "Target player not found.");
  if (String(player.data.league_id) !== input.leagueId) throw new ApiError(400, "That player is not in this league.");

  const now = new Date().toISOString();
  const update = await supabase.from("rec_immortality_prospects").update({
    player_id: input.playerId,
    identity_status: "verified",
    identity_match_method: "manual",
    identity_verified_at: now,
    identity_checked_at: now,
    identity_note: null,
  }).eq("id", input.prospectId);
  if (update.error) throw new ApiError(500, "Failed to link prospect to player.", update.error);

  await resolveIdentityIssue(input.guildId, input.prospectId, input.reviewerDiscordId);
  await regradeProspectHistory({ leagueId: input.leagueId, prospectId: input.prospectId });
}

/** Re-runs weekly/season/career grading for every week this league has ever completed, for one
 * prospect, after a manual identity fix. Safe to call repeatedly -- every credit inside
 * gradeProspectForWeek is idempotent via its sourceId, so already-graded weeks no-op. */
export async function regradeProspectHistory(input: { leagueId: string; prospectId: string }): Promise<void> {
  const prospect = await supabase.from("rec_immortality_prospects")
    .select("id,position,player_id,user_id,side,identity_status")
    .eq("id", input.prospectId)
    .maybeSingle();
  if (prospect.error || !prospect.data || !prospect.data.player_id) return;

  const immortality = await loadImmortalityLeague(input.leagueId);
  if (!immortality) return;

  const { rows } = await getPgPool().query<{ season_number: number; week_number: number }>(
    `select distinct s.display_season_number as season_number, g.week_number
     from rec_games g
     join rec_seasons s on s.id = g.season_id
     where g.league_id = $1 and g.status = 'completed'
     order by season_number, week_number`,
    [input.leagueId],
  );
  if (!rows.length) return;

  const { gradeProspectForWeek } = await import("./xp-awards.service.js");
  for (const row of rows) {
    await gradeProspectForWeek(prospect.data, {
      leagueId: input.leagueId,
      immortalityLeagueId: String(immortality.id),
      seasonNumber: Number(row.season_number),
      weekNumber: Number(row.week_number),
    }).catch((error) => {
      console.error(`[ERROR] Regrade failed for prospect ${input.prospectId} season ${row.season_number} week ${row.week_number} (non-fatal):`, error);
    });
  }
}
