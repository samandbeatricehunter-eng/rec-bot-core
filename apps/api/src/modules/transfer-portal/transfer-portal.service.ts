import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { publishTransitionStory } from "../hub/story-publishing.js";

export type TransferStatus = "entered_portal" | "transferred" | "withdrawn";
export type TransferEntry = {
  id: string; playerName: string; position: string; classYear: string | null;
  originTeamId: string; status: TransferStatus; destinationTeamId: string | null; destinationTeamExternal: string | null;
  entryDate: string | null; storyId: string | null;
};

function mapRow(row: any): TransferEntry {
  return {
    id: row.id, playerName: row.player_name, position: row.position, classYear: row.class_year ?? null,
    originTeamId: row.origin_team_id, status: row.status, destinationTeamId: row.destination_team_id ?? null,
    destinationTeamExternal: row.destination_team_external ?? null, entryDate: row.entry_date ?? null, storyId: row.story_id ?? null,
  };
}

const SELECT_COLUMNS = "id,player_name,position,class_year,origin_team_id,status,destination_team_id,destination_team_external,entry_date,story_id";

export async function listTransferEntries(guildId: string): Promise<{ entries: TransferEntry[] }> {
  const context = await getCurrentLeagueContext(guildId);
  const result = await supabase.from("rec_transfer_portal_entries").select(SELECT_COLUMNS).eq("league_id", context.leagueId).order("created_at", { ascending: false });
  if (result.error) throw new ApiError(500, "Failed to load transfer portal entries.", result.error);
  return { entries: (result.data ?? []).map(mapRow) };
}

export async function createTransferEntry(input: { guildId: string; discordId: string; playerName: string; position: string; classYear?: string | null; originTeamId: string; entryDate?: string | null }): Promise<{ entry: TransferEntry }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const seasonNumber = Number(context.rec_leagues.season_number ?? 1);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(), league_id: context.leagueId, season_number: seasonNumber,
    player_name: input.playerName.trim(), position: input.position.trim(), class_year: input.classYear ?? null,
    origin_team_id: input.originTeamId, status: "entered_portal", entry_date: input.entryDate ?? now.slice(0, 10),
    created_by_discord_id: input.discordId, created_at: now, updated_at: now,
  };
  const result = await supabase.from("rec_transfer_portal_entries").insert(row).select(SELECT_COLUMNS).single();
  if (result.error) throw new ApiError(500, "Failed to add the transfer portal entry.", result.error);

  const origin = await supabase.from("rec_teams").select("name").eq("id", input.originTeamId).maybeSingle();
  await publishTransitionStory({
    guildId: input.guildId,
    headline: `${input.playerName.trim()} Enters the Transfer Portal`,
    body: `${input.playerName.trim()} (${input.position.trim()}) has entered the transfer portal after departing ${origin.data?.name ?? "their program"}.`,
    primaryAngle: "transfer_portal_entry",
  }).catch(() => {});

  return { entry: mapRow(result.data) };
}

export async function updateTransferStatus(input: { guildId: string; id: string; status: TransferStatus; destinationTeamId?: string | null; destinationTeamExternal?: string | null }): Promise<{ entry: TransferEntry }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_transfer_portal_entries").select("id,league_id,player_name,position,status").eq("id", input.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load the transfer portal entry.", existing.error);
  if (!existing.data || existing.data.league_id !== context.leagueId) throw new ApiError(404, "Transfer portal entry not found.");

  const patch: Record<string, unknown> = { status: input.status, updated_at: new Date().toISOString() };
  if (input.status === "transferred") {
    patch.destination_team_id = input.destinationTeamId ?? null;
    patch.destination_team_external = input.destinationTeamExternal ?? null;
  }

  // Only the moment status transitions INTO "transferred" (landing spot confirmed) fires
  // the richer article — re-saving an already-landed entry shouldn't republish.
  const justLanded = input.status === "transferred" && existing.data.status !== "transferred";
  if (justLanded) {
    let teamName = input.destinationTeamExternal?.trim() || "a new program";
    if (input.destinationTeamId) {
      const team = await supabase.from("rec_teams").select("name").eq("id", input.destinationTeamId).maybeSingle();
      teamName = team.data?.name ?? teamName;
    }
    const headline = `${existing.data.player_name} Lands at ${teamName}`;
    const body = `${existing.data.player_name} (${existing.data.position}) has found a new home at ${teamName} after entering the transfer portal.`;
    const story = await publishTransitionStory({ guildId: input.guildId, headline, body, primaryAngle: "transfer_portal_landing", storyType: "article" });
    patch.story_id = story.storyId;
  }

  const result = await supabase.from("rec_transfer_portal_entries").update(patch).eq("id", input.id).select(SELECT_COLUMNS).single();
  if (result.error) throw new ApiError(500, "Failed to update the transfer portal entry.", result.error);
  return { entry: mapRow(result.data) };
}

export async function deleteTransferEntry(input: { guildId: string; id: string }): Promise<{ deleted: true }> {
  const context = await getCurrentLeagueContext(input.guildId);
  const existing = await supabase.from("rec_transfer_portal_entries").select("id,league_id").eq("id", input.id).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to load the transfer portal entry.", existing.error);
  if (!existing.data || existing.data.league_id !== context.leagueId) throw new ApiError(404, "Transfer portal entry not found.");
  const result = await supabase.from("rec_transfer_portal_entries").delete().eq("id", input.id);
  if (result.error) throw new ApiError(500, "Failed to delete the transfer portal entry.", result.error);
  return { deleted: true };
}
