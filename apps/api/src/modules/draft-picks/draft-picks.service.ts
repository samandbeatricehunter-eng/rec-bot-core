import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { resolveSeasonNumber } from "../league-context/season.service.js";

// The first 3 seasons of a league's draft classes have no prior-season standings to derive
// a pick order from — seasons before Madden's own franchise-mode history exists in this
// league — so commissioners enter them manually (ideally from a real-world/Madden-default
// seed, applied separately). Season 4+ is generated from the prior season's final record.
const MANUAL_SEASON_CEILING = 3;

async function userIdFromDiscord(discordId: string) {
  const account = await supabase.from("rec_discord_accounts").select("user_id").eq("discord_id", discordId).maybeSingle();
  if (account.error) throw new ApiError(500, "Failed to load your REC account.", account.error);
  return account.data?.user_id ?? null;
}

type DraftPickRow = {
  id: string; league_id: string; season_number: number; round: number;
  original_team_id: string; current_team_id: string; pick_number: number | null;
  source: string; manual_lock: boolean; admin_notes: string | null; created_at: string; updated_at: string;
};

async function teamNames(leagueId: string, teamIds: string[]) {
  if (!teamIds.length) return new Map<string, string>();
  const teams = await supabase.from("rec_teams").select("id,display_nick,display_abbr,name").eq("league_id", leagueId).in("id", teamIds);
  if (teams.error) throw new ApiError(500, "Failed to load teams.", teams.error);
  return new Map((teams.data ?? []).map((t: any) => [t.id, t.display_nick ?? t.display_abbr ?? t.name]));
}

// A pick's ownership chain — every "traded" audit entry, oldest first, so the UI can show
// "Original: Cowboys -> traded to Jets (Trade #123, 2026-08-04) -> traded to Browns (...)".
export async function getDraftPickChain(pickId: string) {
  const rows = await supabase.from("rec_draft_pick_audit").select("*").eq("draft_pick_id", pickId).eq("change_type", "traded").order("created_at", { ascending: true });
  if (rows.error) throw new ApiError(500, "Failed to load pick history.", rows.error);
  return (rows.data ?? []).map((row: any) => ({
    fromTeamId: row.previous_value?.currentTeamId ?? null,
    toTeamId: row.new_value?.currentTeamId ?? null,
    reason: row.reason,
    at: row.created_at,
  }));
}

export async function listDraftPicksForTeam(guildId: string, teamId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const picks = await supabase.from("rec_draft_picks").select("*")
    .eq("league_id", context.leagueId).eq("current_team_id", teamId)
    .order("season_number", { ascending: true }).order("round", { ascending: true });
  if (picks.error) throw new ApiError(500, "Failed to load draft picks.", picks.error);
  const rows = (picks.data ?? []) as DraftPickRow[];
  const originalTeamIds = [...new Set(rows.map((r) => r.original_team_id))];
  const names = await teamNames(context.leagueId, originalTeamIds);
  const chains = await Promise.all(rows.map((r) => getDraftPickChain(r.id)));
  return rows.map((r, i) => ({
    id: r.id,
    seasonNumber: r.season_number,
    round: r.round,
    pickNumber: r.pick_number,
    originalTeamId: r.original_team_id,
    originalTeamName: names.get(r.original_team_id) ?? "Unknown",
    isOwnPick: r.original_team_id === r.current_team_id,
    manualLock: r.manual_lock,
    adminNotes: r.admin_notes,
    tradeChain: chains[i],
  }));
}

export async function listDraftPicksForLeague(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const picks = await supabase.from("rec_draft_picks").select("*")
    .eq("league_id", context.leagueId).order("season_number", { ascending: true }).order("round", { ascending: true });
  if (picks.error) throw new ApiError(500, "Failed to load draft picks.", picks.error);
  return picks.data ?? [];
}

export async function upsertManualDraftPick(input: {
  guildId: string; discordId: string; seasonNumber: number; round: number;
  originalTeamId: string; currentTeamId?: string; pickNumber?: number | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (input.seasonNumber < 1 || input.seasonNumber > MANUAL_SEASON_CEILING) {
    throw new ApiError(400, `Manual pick entry is only for seasons 1-${MANUAL_SEASON_CEILING}. Use generation for later seasons.`);
  }
  if (input.round < 1 || input.round > 7) throw new ApiError(400, "Round must be 1-7.");
  const userId = await userIdFromDiscord(input.discordId);

  const upsert = await supabase.from("rec_draft_picks").upsert({
    league_id: context.leagueId,
    season_number: input.seasonNumber,
    round: input.round,
    original_team_id: input.originalTeamId,
    current_team_id: input.currentTeamId ?? input.originalTeamId,
    pick_number: input.pickNumber ?? null,
    source: "manual",
    created_by_user_id: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "league_id,season_number,round,original_team_id" }).select("*").single();
  if (upsert.error) throw new ApiError(500, "Failed to save draft pick.", upsert.error);
  return upsert.data;
}

export async function updateDraftPick(input: {
  guildId: string; discordId: string; pickId: string;
  pickNumber?: number | null; currentTeamId?: string; adminNotes?: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const userId = await userIdFromDiscord(input.discordId);
  const existing = await supabase.from("rec_draft_picks").select("*").eq("id", input.pickId).eq("league_id", context.leagueId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load draft pick.", existing.error);
  if (!existing.data) throw new ApiError(404, "Draft pick not found.");

  const patch: Record<string, unknown> = { manual_lock: true, updated_at: new Date().toISOString() };
  if (input.pickNumber !== undefined) patch.pick_number = input.pickNumber;
  if (input.currentTeamId !== undefined) patch.current_team_id = input.currentTeamId;
  if (input.adminNotes !== undefined) patch.admin_notes = input.adminNotes;

  const updated = await supabase.from("rec_draft_picks").update(patch).eq("id", input.pickId).select("*").single();
  if (updated.error) throw new ApiError(500, "Failed to update draft pick.", updated.error);

  await supabase.from("rec_draft_pick_audit").insert({
    draft_pick_id: input.pickId,
    changed_by_user_id: userId,
    change_type: "manual_edit",
    previous_value: existing.data,
    new_value: updated.data,
    reason: "Commissioner correction",
  });

  return updated.data;
}

export async function deleteDraftPick(input: { guildId: string; pickId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const deleted = await supabase.from("rec_draft_picks").delete().eq("id", input.pickId).eq("league_id", context.leagueId).select("id").maybeSingle();
  if (deleted.error) throw new ApiError(500, "Failed to delete draft pick.", deleted.error);
  if (!deleted.data) throw new ApiError(404, "Draft pick not found.");
  return { deleted: true };
}

// Season 4+: 7 rounds x every team, pick order = worst record first from the PRIOR season's
// final rec_season_user_records (own-pick order only — traded picks from earlier seasons
// keep their current_team_id, this only (re)builds original ownership + a fresh pick_number
// for that season's class). Rows a commissioner already hand-edited (manual_lock) are left
// alone so this can be safely re-run.
export async function generateSeasonDraftPicks(input: { guildId: string; discordId: string; seasonNumber: number }) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (input.seasonNumber <= MANUAL_SEASON_CEILING) {
    throw new ApiError(400, `Season ${input.seasonNumber} picks are entered manually, not generated.`);
  }
  const priorSeason = input.seasonNumber - 1;
  const userId = await userIdFromDiscord(input.discordId);

  const records = await supabase.from("rec_season_user_records").select("user_id,wins,losses,ties,point_differential")
    .eq("league_id", context.leagueId).eq("season_number", priorSeason);
  if (records.error) throw new ApiError(500, "Failed to load prior-season standings.", records.error);
  if (!records.data?.length) throw new ApiError(409, `No final standings found for season ${priorSeason} yet.`);

  const assignments = await supabase.from("rec_team_assignments").select("user_id,team_id")
    .eq("league_id", context.leagueId).eq("assignment_status", "active").is("ended_at", null);
  if (assignments.error) throw new ApiError(500, "Failed to load team assignments.", assignments.error);
  const teamByUser = new Map((assignments.data ?? []).map((a: any) => [a.user_id, a.team_id]));

  // Worst record first: fewest wins, then worst point differential as the tiebreak.
  const ordered = [...records.data]
    .filter((r: any) => teamByUser.has(r.user_id))
    .sort((a: any, b: any) => {
      const winPctA = (a.wins + a.ties * 0.5) / Math.max(1, a.wins + a.losses + a.ties);
      const winPctB = (b.wins + b.ties * 0.5) / Math.max(1, b.wins + b.losses + b.ties);
      if (winPctA !== winPctB) return winPctA - winPctB;
      return Number(a.point_differential ?? 0) - Number(b.point_differential ?? 0);
    });

  // Re-running this (e.g. after a standings correction) must never reset a pick that's
  // already been traded away — only pick_number is safe to recompute on an existing row;
  // current_team_id is only set for genuinely new rows. manual_lock rows are skipped
  // entirely either way.
  const existing = await supabase.from("rec_draft_picks").select("id,original_team_id,round,manual_lock")
    .eq("league_id", context.leagueId).eq("season_number", input.seasonNumber);
  if (existing.error) throw new ApiError(500, "Failed to check existing picks.", existing.error);
  const existingByKey = new Map<string, { id: string; manual_lock: boolean }>(
    (existing.data ?? []).map((r: any) => [`${r.original_team_id}:${r.round}`, r]),
  );

  const newRows: Record<string, unknown>[] = [];
  const pickNumberUpdates: Array<{ id: string; pick_number: number }> = [];
  for (let round = 1; round <= 7; round++) {
    ordered.forEach((record: any, index: number) => {
      const teamId = teamByUser.get(record.user_id);
      const key = `${teamId}:${round}`;
      const found = existingByKey.get(key);
      if (found?.manual_lock) return;
      if (found) {
        pickNumberUpdates.push({ id: found.id, pick_number: index + 1 });
      } else {
        newRows.push({
          league_id: context.leagueId,
          season_number: input.seasonNumber,
          round,
          original_team_id: teamId,
          current_team_id: teamId,
          pick_number: index + 1,
          source: "generated",
          created_by_user_id: userId,
          updated_at: new Date().toISOString(),
        });
      }
    });
  }

  if (newRows.length) {
    const insert = await supabase.from("rec_draft_picks").insert(newRows);
    if (insert.error) throw new ApiError(500, "Failed to generate draft picks.", insert.error);
  }
  for (const update of pickNumberUpdates) {
    const result = await supabase.from("rec_draft_picks").update({ pick_number: update.pick_number, updated_at: new Date().toISOString() }).eq("id", update.id);
    if (result.error) throw new ApiError(500, "Failed to update draft pick order.", result.error);
  }
  return { generated: newRows.length, reordered: pickNumberUpdates.length };
}
