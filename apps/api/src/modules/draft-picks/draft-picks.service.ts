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
  const chains = await Promise.all(rows.map((r) => getDraftPickChain(r.id)));
  const relevantTeamIds = [...new Set(rows.flatMap((r, i) => [r.original_team_id, ...chains[i].flatMap((link) => [link.fromTeamId, link.toTeamId]).filter((id): id is string => Boolean(id))]))];
  const names = await teamNames(context.leagueId, relevantTeamIds);
  return rows.map((r, i) => ({
    id: r.id,
    seasonNumber: r.season_number,
    round: r.round,
    pickNumber: r.pick_number,
    originalTeamId: r.original_team_id,
    originalTeamName: names.get(r.original_team_id) ?? "Unknown",
    acquiredFromTeamName: chains[i].length ? names.get(chains[i][chains[i].length - 1].fromTeamId ?? "") ?? "Unknown" : null,
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
    asset_key: `${input.originalTeamId}:R${input.round}`,
    original_team_id: input.originalTeamId,
    current_team_id: input.currentTeamId ?? input.originalTeamId,
    pick_number: input.pickNumber ?? null,
    source: "manual",
    created_by_user_id: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "league_id,season_number,asset_key" }).select("*").single();
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
    change_type: input.currentTeamId !== undefined && input.currentTeamId !== existing.data.current_team_id ? "traded" : "manual_edit",
    previous_value: existing.data,
    new_value: updated.data,
    reason: input.currentTeamId !== undefined && input.currentTeamId !== existing.data.current_team_id ? "Commissioner moved pick" : "Commissioner correction",
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
  const userId = await userIdFromDiscord(input.discordId);
  return generateRollingDraftClass({
    leagueId: context.leagueId,
    targetSeasonNumber: input.seasonNumber,
    completedSeasonNumber: Math.max(1, input.seasonNumber - 3),
    createdByUserId: userId,
  });
}

export async function generateRollingDraftClass(input: {
  leagueId: string;
  targetSeasonNumber: number;
  completedSeasonNumber: number;
  createdByUserId?: string | null;
}) {
  const teamsResult = await supabase.from("rec_teams").select("id,name,abbreviation").eq("league_id", input.leagueId);
  if (teamsResult.error) throw new ApiError(500, "Failed to load teams for the future draft class.", teamsResult.error);
  const teams = teamsResult.data ?? [];
  if (teams.length !== 32) throw new ApiError(409, `Madden future-pick generation requires all 32 teams; found ${teams.length}.`);

  const [snapshots, games] = await Promise.all([
    supabase.from("rec_team_standings_snapshots").select("team_id,total_wins,total_losses,total_ties,win_pct,week_number,created_at")
      .eq("league_id", input.leagueId).eq("season_number", input.completedSeasonNumber)
      .order("week_number", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("rec_game_results").select("home_team_id,away_team_id,winning_team_id,losing_team_id,week_number,is_playoff")
      .eq("league_id", input.leagueId).eq("season_number", input.completedSeasonNumber),
  ]);
  if (snapshots.error) throw new ApiError(500, "Failed to load final team standings.", snapshots.error);
  if (games.error) throw new ApiError(500, "Failed to load completed-season results.", games.error);
  const latest = new Map<string, any>();
  for (const row of snapshots.data ?? []) if (!latest.has(String(row.team_id))) latest.set(String(row.team_id), row);
  const record = new Map<string, { wins: number; losses: number; ties: number }>(teams.map((team: any) => {
    const row = latest.get(String(team.id));
    return [String(team.id), { wins: Number(row?.total_wins ?? 0), losses: Number(row?.total_losses ?? 0), ties: Number(row?.total_ties ?? 0) }];
  }));
  const opponents = new Map<string, string[]>();
  const playoffTeams = new Set<string>();
  const eliminatedAt = new Map<string, number>();
  let championId: string | null = null;
  let latestPlayoffWeek = -1;
  for (const game of games.data ?? []) {
    const home = game.home_team_id ? String(game.home_team_id) : null;
    const away = game.away_team_id ? String(game.away_team_id) : null;
    if (home && away) { (opponents.get(home) ?? opponents.set(home, []).get(home)!).push(away); (opponents.get(away) ?? opponents.set(away, []).get(away)!).push(home); }
    if (game.is_playoff) {
      if (home) playoffTeams.add(home); if (away) playoffTeams.add(away);
      if (game.losing_team_id) eliminatedAt.set(String(game.losing_team_id), Number(game.week_number ?? 0));
      if (game.winning_team_id && Number(game.week_number ?? 0) >= latestPlayoffWeek) { latestPlayoffWeek = Number(game.week_number ?? 0); championId = String(game.winning_team_id); }
    }
  }
  const winPct = (teamId: string) => { const r = record.get(teamId)!; return (r.wins + r.ties * 0.5) / Math.max(1, r.wins + r.losses + r.ties); };
  const sos = (teamId: string) => { const list = opponents.get(teamId) ?? []; return list.length ? list.reduce((sum, id) => sum + winPct(id), 0) / list.length : 0; };
  const ordered = [...teams].sort((a: any, b: any) => {
    const aId = String(a.id), bId = String(b.id), aPlayoff = playoffTeams.has(aId), bPlayoff = playoffTeams.has(bId);
    if (aPlayoff !== bPlayoff) return aPlayoff ? 1 : -1;
    if (aPlayoff) {
      if (aId === championId) return 1; if (bId === championId) return -1;
      const roundDifference = (eliminatedAt.get(aId) ?? latestPlayoffWeek) - (eliminatedAt.get(bId) ?? latestPlayoffWeek);
      if (roundDifference) return roundDifference;
    }
    const pctDifference = winPct(aId) - winPct(bId); if (pctDifference) return pctDifference;
    const sosDifference = sos(aId) - sos(bId); if (sosDifference) return sosDifference;
    return String(a.abbreviation).localeCompare(String(b.abbreviation));
  });

  // Re-running this (e.g. after a standings correction) must never reset a pick that's
  // already been traded away — only pick_number is safe to recompute on an existing row;
  // current_team_id is only set for genuinely new rows. manual_lock rows are skipped
  // entirely either way.
  const existing = await supabase.from("rec_draft_picks").select("*")
    .eq("league_id", input.leagueId).eq("season_number", input.targetSeasonNumber);
  if (existing.error) throw new ApiError(500, "Failed to check existing picks.", existing.error);
  const existingByKey = new Map<string, Record<string, any>>(
    (existing.data ?? []).map((r: any) => [`${r.original_team_id}:${r.round}`, r]),
  );

  const newRows: Record<string, unknown>[] = [];
  const pickNumberUpdates: Array<Record<string, any>> = [];
  for (let round = 1; round <= 7; round++) {
    ordered.forEach((record: any, index: number) => {
      const teamId = record.id;
      const key = `${teamId}:${round}`;
      const found = existingByKey.get(key);
      if (found?.manual_lock) return;
      if (found) {
        pickNumberUpdates.push({ ...found, pick_number: index + 1 });
      } else {
        newRows.push({
          league_id: input.leagueId,
          season_number: input.targetSeasonNumber,
          asset_key: `${teamId}:R${round}`,
          round,
          original_team_id: teamId,
          current_team_id: teamId,
          pick_number: index + 1,
          source: "generated",
          created_by_user_id: input.createdByUserId ?? null,
          updated_at: new Date().toISOString(),
        });
      }
    });
  }

  if (newRows.length) {
    const insert = await supabase.from("rec_draft_picks").insert(newRows);
    if (insert.error) throw new ApiError(500, "Failed to generate draft picks.", insert.error);
  }
  if (pickNumberUpdates.length) {
    const now = new Date().toISOString();
    // Single batched upsert-on-conflict instead of one UPDATE per pick — only the listed
    // columns (id, pick_number, updated_at) get touched for existing rows.
    const result = await supabase
      .from("rec_draft_picks")
      .upsert(
        pickNumberUpdates.map((update) => ({ id: update.id, pick_number: update.pick_number, updated_at: now })),
        { onConflict: "id" },
      );
    if (result.error) throw new ApiError(500, "Failed to update draft pick order.", result.error);
  }
  return { generated: newRows.length, reordered: pickNumberUpdates.length };
}

/**
 * Recompute pick_number for a draft class from a season's results (worst record first,
 * playoff finish breaking ties — same formula as generateRollingDraftClass). Skips
 * manual_lock and compensatory rows. Used so year-1 order starts from the real-life
 * baseline at seed, then shifts as this league's rankings change once games are played.
 */
export async function syncDraftOrderFromLeagueStandings(input: {
  leagueId: string;
  draftSeasonNumber: number;
  standingsSeasonNumber: number;
}) {
  const teamsResult = await supabase.from("rec_teams").select("id,name,abbreviation").eq("league_id", input.leagueId);
  if (teamsResult.error) throw new ApiError(500, "Failed to load teams for draft-order sync.", teamsResult.error);
  const teams = teamsResult.data ?? [];
  if (teams.length !== 32) return { reordered: 0, skipped: "incomplete_teams" as const };

  const games = await supabase.from("rec_game_results").select("home_team_id,away_team_id,winning_team_id,losing_team_id,week_number,is_playoff,is_tie")
    .eq("league_id", input.leagueId).eq("season_number", input.standingsSeasonNumber);
  if (games.error) throw new ApiError(500, "Failed to load results for draft-order sync.", games.error);
  if (!(games.data ?? []).length) return { reordered: 0, skipped: "no_results" as const };

  const snapshots = await supabase.from("rec_team_standings_snapshots").select("team_id,total_wins,total_losses,total_ties,win_pct,week_number,created_at")
    .eq("league_id", input.leagueId).eq("season_number", input.standingsSeasonNumber)
    .order("week_number", { ascending: false }).order("created_at", { ascending: false });
  if (snapshots.error) throw new ApiError(500, "Failed to load standings for draft-order sync.", snapshots.error);
  const latest = new Map<string, any>();
  for (const row of snapshots.data ?? []) if (!latest.has(String(row.team_id))) latest.set(String(row.team_id), row);

  const record = new Map<string, { wins: number; losses: number; ties: number }>(teams.map((team: any) => {
    const row = latest.get(String(team.id));
    if (row) return [String(team.id), { wins: Number(row.total_wins ?? 0), losses: Number(row.total_losses ?? 0), ties: Number(row.total_ties ?? 0) }];
    return [String(team.id), { wins: 0, losses: 0, ties: 0 }];
  }));
  // Fall back to summing results when snapshots are missing (common mid-season before first advance snapshot).
  if (!latest.size) {
    for (const game of games.data ?? []) {
      const home = game.home_team_id ? String(game.home_team_id) : null;
      const away = game.away_team_id ? String(game.away_team_id) : null;
      if (game.is_tie) {
        if (home) record.get(home)!.ties += 1;
        if (away) record.get(away)!.ties += 1;
      } else {
        if (game.winning_team_id) record.get(String(game.winning_team_id))!.wins += 1;
        if (game.losing_team_id) record.get(String(game.losing_team_id))!.losses += 1;
      }
    }
  }

  const opponents = new Map<string, string[]>();
  const playoffTeams = new Set<string>();
  const eliminatedAt = new Map<string, number>();
  let championId: string | null = null;
  let latestPlayoffWeek = -1;
  for (const game of games.data ?? []) {
    const home = game.home_team_id ? String(game.home_team_id) : null;
    const away = game.away_team_id ? String(game.away_team_id) : null;
    if (home && away) {
      (opponents.get(home) ?? opponents.set(home, []).get(home)!).push(away);
      (opponents.get(away) ?? opponents.set(away, []).get(away)!).push(home);
    }
    if (game.is_playoff) {
      if (home) playoffTeams.add(home); if (away) playoffTeams.add(away);
      if (game.losing_team_id) eliminatedAt.set(String(game.losing_team_id), Number(game.week_number ?? 0));
      if (game.winning_team_id && Number(game.week_number ?? 0) >= latestPlayoffWeek) {
        latestPlayoffWeek = Number(game.week_number ?? 0);
        championId = String(game.winning_team_id);
      }
    }
  }
  const winPct = (teamId: string) => {
    const r = record.get(teamId)!;
    return (r.wins + r.ties * 0.5) / Math.max(1, r.wins + r.losses + r.ties);
  };
  const sos = (teamId: string) => {
    const list = opponents.get(teamId) ?? [];
    return list.length ? list.reduce((sum, id) => sum + winPct(id), 0) / list.length : 0;
  };
  const ordered = [...teams].sort((a: any, b: any) => {
    const aId = String(a.id), bId = String(b.id);
    const aPlayoff = playoffTeams.has(aId), bPlayoff = playoffTeams.has(bId);
    if (aPlayoff !== bPlayoff) return aPlayoff ? 1 : -1;
    if (aPlayoff) {
      if (aId === championId) return 1; if (bId === championId) return -1;
      const roundDifference = (eliminatedAt.get(aId) ?? latestPlayoffWeek) - (eliminatedAt.get(bId) ?? latestPlayoffWeek);
      if (roundDifference) return roundDifference;
    }
    const pctDifference = winPct(aId) - winPct(bId); if (pctDifference) return pctDifference;
    const sosDifference = sos(aId) - sos(bId); if (sosDifference) return sosDifference;
    return String(a.abbreviation).localeCompare(String(b.abbreviation));
  });
  const slot = new Map(ordered.map((team: any, index) => [String(team.id), index + 1]));

  const picks = await supabase.from("rec_draft_picks").select("id,original_team_id,asset_key,manual_lock")
    .eq("league_id", input.leagueId).eq("season_number", input.draftSeasonNumber);
  if (picks.error) throw new ApiError(500, "Failed to load draft picks for order sync.", picks.error);
  const now = new Date().toISOString();
  const updates = (picks.data ?? [])
    .filter((pick: any) => !pick.manual_lock && !String(pick.asset_key ?? "").endsWith(":COMP"))
    .map((pick: any) => ({
      id: pick.id,
      pick_number: slot.get(String(pick.original_team_id)) ?? null,
      updated_at: now,
    }))
    .filter((row) => row.pick_number != null);
  if (!updates.length) return { reordered: 0 };
  const result = await supabase.from("rec_draft_picks").upsert(updates, { onConflict: "id" });
  if (result.error) throw new ApiError(500, "Failed to sync draft pick order from standings.", result.error);
  return { reordered: updates.length };
}

export async function setUpcomingDraftOrder(input: {
  guildId: string;
  discordId: string;
  seasonNumber: number;
  orderedTeamIds: string[];
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (context.rec_leagues.game !== "madden_26" && context.rec_leagues.game !== "madden_27") {
    throw new ApiError(400, "Draft order is only available for Madden leagues.");
  }
  if (input.orderedTeamIds.length !== 32 || new Set(input.orderedTeamIds).size !== 32) {
    throw new ApiError(400, "Draft order must assign every team exactly once from 1 through 32.");
  }
  const teams = await supabase.from("rec_teams").select("id").eq("league_id", context.leagueId);
  if (teams.error) throw new ApiError(500, "Failed to validate draft-order teams.", teams.error);
  const validTeamIds = new Set((teams.data ?? []).map((team: any) => String(team.id)));
  if (validTeamIds.size !== 32 || input.orderedTeamIds.some((id) => !validTeamIds.has(id))) {
    throw new ApiError(400, "Draft order contains a team outside this league.");
  }
  const picks = await supabase.from("rec_draft_picks").select("*")
    .eq("league_id", context.leagueId).eq("season_number", input.seasonNumber);
  if (picks.error) throw new ApiError(500, "Failed to load the upcoming draft class.", picks.error);
  const slot = new Map(input.orderedTeamIds.map((teamId, index) => [teamId, index + 1]));
  const now = new Date().toISOString();
  const standardPicks = (picks.data ?? []).filter((pick: any) => !String(pick.asset_key ?? "").endsWith(":COMP"));
  const update = await supabase.from("rec_draft_picks").upsert(standardPicks.map((pick: any) => ({
    ...pick,
    pick_number: slot.get(String(pick.original_team_id)),
    manual_lock: true,
    updated_at: now,
  })), { onConflict: "id" });
  if (update.error) throw new ApiError(500, "Failed to save the upcoming draft order.", update.error);
  return { seasonNumber: input.seasonNumber, updated: standardPicks.length };
}
