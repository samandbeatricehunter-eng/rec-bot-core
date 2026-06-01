import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueForGuild } from "../team-ownership/team-ownership.service.js";

export type SelectEaFranchiseInput = {
  guildId: string;
  eaFranchiseId: string;
  selectedByDiscordId: string;
  replacementReason?: string | null;
};

export async function listEaFranchisesForGuild(guildId: string) {
  const { server, league } = await getCurrentLeagueForGuild(guildId);

  const franchises = await supabase
    .from("rec_ea_franchises")
    .select("*")
    .order("updated_at", { ascending: false });

  if (franchises.error) {
    throw new ApiError(500, "Failed to load EA franchises.", franchises.error);
  }

  const activeLink = await supabase
    .from("rec_league_ea_franchise_links")
    .select("*, franchise:rec_ea_franchises(*)")
    .eq("league_id", league.id)
    .eq("server_id", server.id)
    .eq("is_active", true)
    .maybeSingle();

  if (activeLink.error) {
    throw new ApiError(500, "Failed to load active EA franchise selection.", activeLink.error);
  }

  return {
    server,
    league,
    activeLink: activeLink.data ?? null,
    franchises: franchises.data ?? []
  };
}

export async function selectEaFranchiseForGuild(input: SelectEaFranchiseInput) {
  const { server, league } = await getCurrentLeagueForGuild(input.guildId);

  const franchise = await supabase
    .from("rec_ea_franchises")
    .select("*")
    .eq("id", input.eaFranchiseId)
    .single();

  if (franchise.error) {
    throw new ApiError(404, "EA franchise was not found.", franchise.error);
  }

  const now = new Date().toISOString();

  const deactivated = await supabase
    .from("rec_league_ea_franchise_links")
    .update({
      is_active: false,
      deactivated_at: now,
      deactivated_by_discord_id: input.selectedByDiscordId,
      replacement_reason: input.replacementReason ?? "EA franchise selection changed."
    })
    .eq("league_id", league.id)
    .eq("server_id", server.id)
    .eq("is_active", true);

  if (deactivated.error) {
    throw new ApiError(500, "Failed to deactivate previous EA franchise selection.", deactivated.error);
  }

  const selected = await supabase
    .from("rec_league_ea_franchise_links")
    .insert({
      league_id: league.id,
      server_id: server.id,
      ea_franchise_id: input.eaFranchiseId,
      selected_by_discord_id: input.selectedByDiscordId,
      is_active: true
    })
    .select("*, franchise:rec_ea_franchises(*)")
    .single();

  if (selected.error) {
    throw new ApiError(500, "Failed to select EA franchise.", selected.error);
  }

  return {
    server,
    league,
    selected: selected.data,
    message: "EA franchise selected for future imports."
  };
}
