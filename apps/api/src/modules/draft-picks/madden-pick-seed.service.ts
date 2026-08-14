import { supabase } from "../../lib/supabase.js";
import { ApiError } from "../../lib/errors.js";
import { MADDEN_PICK_BASELINE_META, supplementalPicksForMaddenGame, transfersForMaddenGame, year1PickNumberByAbbreviation } from "./madden-pick-baselines.js";

type Asset = { draftYear: number; round: number; original: string; owner: string; conditional: boolean; assetKey: string };

export async function seedMaddenDraftPicks(leagueId: string, game: "madden_26" | "madden_27") {
  const teams = await supabase.from("rec_teams").select("id,abbreviation").eq("league_id", leagueId);
  if (teams.error) throw new ApiError(500, "Failed to load teams for Madden draft-pick seeding.", teams.error);
  const teamId = new Map<string, string>((teams.data ?? []).map((team: any) => [String(team.abbreviation).toUpperCase(), String(team.id)]));
  if (teamId.size !== 32) throw new ApiError(409, `Madden draft-pick seeding requires all 32 teams; found ${teamId.size}.`);
  const meta = MADDEN_PICK_BASELINE_META[game];
  const year1Slots = year1PickNumberByAbbreviation(game);
  if (year1Slots.size !== 32) throw new ApiError(500, `Year-1 draft order baseline for ${game} must list all 32 franchises.`);
  const assets: Asset[] = [];
  for (let offset = 0; offset < 3; offset++) for (const abbreviation of teamId.keys()) for (let round = 1; round <= 7; round++) {
    const draftYear = meta.firstDraftYear + offset;
    assets.push({ draftYear, round, original: abbreviation, owner: abbreviation, conditional: false, assetKey: `${abbreviation}:${draftYear}:R${round}` });
  }
  for (const pick of supplementalPicksForMaddenGame(game)) assets.push({ ...pick, owner: pick.original, conditional: false });
  const unresolved: string[] = [];
  for (const [draftYear, round, from, to, conditional] of transfersForMaddenGame(game)) {
    if (!teamId.has(from) || !teamId.has(to)) { unresolved.push(`${draftYear} R${round} ${from}->${to}: unknown team`); continue; }
    const candidates = assets.filter((asset) => asset.draftYear === draftYear && asset.round === round && asset.owner === from);
    const asset = candidates.find((candidate) => candidate.original === from) ?? candidates[0];
    if (!asset) { unresolved.push(`${draftYear} R${round} ${from}->${to}: source no longer owns a matching pick`); continue; }
    asset.owner = to; asset.conditional ||= conditional === 1;
  }
  const rows = assets.map((asset) => {
    const seasonNumber = asset.draftYear - meta.firstDraftYear + 1;
    // Year-1 class gets real-life projected pick numbers at seed; seasons 2-3 stay TBD until
    // prior-season standings exist (or a commissioner sets order manually).
    const pickNumber = seasonNumber === 1 && !asset.assetKey.endsWith(":COMP")
      ? (year1Slots.get(asset.original) ?? null)
      : null;
    return {
      league_id: leagueId,
      season_number: seasonNumber,
      asset_key: asset.assetKey,
      round: asset.round,
      original_team_id: teamId.get(asset.original)!,
      current_team_id: teamId.get(asset.owner)!,
      pick_number: pickNumber,
      source: `baseline:${meta.version}`,
      manual_lock: false,
      admin_notes: `NFL Draft ${asset.draftYear}${asset.conditional ? " — conditional ownership at baseline snapshot" : ""}`,
    };
  });
  if (unresolved.length) throw new ApiError(500, `Madden pick baseline ${meta.version} has unresolved ownership transfers.`, { unresolved });
  const seeded = await supabase.from("rec_draft_picks").upsert(rows, { onConflict: "league_id,season_number,asset_key" });
  if (seeded.error) throw new ApiError(500, "Failed to seed Madden draft-pick ownership.", seeded.error);
  return { seeded: rows.length, version: meta.version, snapshotDate: meta.snapshotDate, unresolved };
}

/** Backfill year-1 pick_number from the real-life baseline for leagues seeded before order was stored. */
export async function backfillYear1DraftPickNumbers(leagueId: string, game: "madden_26" | "madden_27") {
  const teams = await supabase.from("rec_teams").select("id,abbreviation").eq("league_id", leagueId);
  if (teams.error) throw new ApiError(500, "Failed to load teams for draft-pick backfill.", teams.error);
  const abbrById = new Map<string, string>((teams.data ?? []).map((team: any) => [String(team.id), String(team.abbreviation).toUpperCase()]));
  const year1Slots = year1PickNumberByAbbreviation(game);
  const picks = await supabase.from("rec_draft_picks").select("id,original_team_id,asset_key,manual_lock,pick_number")
    .eq("league_id", leagueId).eq("season_number", 1);
  if (picks.error) throw new ApiError(500, "Failed to load year-1 draft picks for backfill.", picks.error);
  const now = new Date().toISOString();
  const updates: Array<{ id: string; pick_number: number; updated_at: string }> = [];
  for (const pick of picks.data ?? []) {
    if ((pick as any).manual_lock || String((pick as any).asset_key ?? "").endsWith(":COMP")) continue;
    const abbr = abbrById.get(String((pick as any).original_team_id));
    if (!abbr) continue;
    const pickNumber = year1Slots.get(abbr);
    if (pickNumber == null) continue;
    updates.push({ id: String((pick as any).id), pick_number: pickNumber, updated_at: now });
  }
  if (!updates.length) return { updated: 0 };
  const result = await supabase.from("rec_draft_picks").upsert(updates, { onConflict: "id" });
  if (result.error) throw new ApiError(500, "Failed to backfill year-1 draft pick numbers.", result.error);
  return { updated: updates.length };
}
