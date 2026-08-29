import { NFL_TEAMS } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";

export type LeagueTeamIdentityOverride = {
  replacesAbbreviation: string;
  city: string;
  nick: string;
  abbreviation: string;
  primaryLogoUrl?: string | null;
  secondaryLogoUrl?: string | null;
  wordmarkUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
};

function defaultIdentityParts(name: string) {
  const parts = name.trim().split(/\s+/);
  return { city: parts.slice(0, -1).join(" "), nick: parts.at(-1) ?? name };
}

export async function seedLeagueTeamIdentities(leagueId: string) {
  const teams = await supabase.from("rec_teams")
    .select("id,name,abbreviation,madden_team_id,conference,division,logo_url,primary_color,display_city,display_abbr,is_relocated,original_abbreviation")
    .eq("league_id", leagueId);
  if (teams.error) throw new ApiError(500, "Could not load league teams for identity setup.", teams.error);

  const rows = (teams.data ?? []).flatMap((team) => {
    const abbreviation = String(team.abbreviation ?? "").trim().toUpperCase();
    const catalog = NFL_TEAMS.find((item) => item.abbreviation === abbreviation);
    if (!catalog) return [];
    const defaults = defaultIdentityParts(catalog.name);
    return [{
      league_id: leagueId,
      team_id: team.id,
      madden_team_id: String(team.madden_team_id ?? abbreviation),
      is_custom_identity: Boolean(team.is_relocated),
      default_team_name: catalog.name,
      default_city: defaults.city,
      default_abbreviation: abbreviation,
      display_team_name: team.name ?? catalog.name,
      display_city: team.display_city ?? defaults.city,
      display_abbreviation: team.display_abbr ?? abbreviation,
      primary_logo_url: team.logo_url ?? null,
      primary_color: team.primary_color ?? null,
      conference: team.conference ?? catalog.conference,
      division: team.division ?? catalog.division,
      updated_at: new Date().toISOString(),
    }];
  });
  if (!rows.length) return { identities: [] };
  const saved = await supabase.from("rec_league_team_identities")
    .upsert(rows, { onConflict: "league_id,team_id", ignoreDuplicates: true })
    .select("*");
  if (saved.error) throw new ApiError(500, "Could not initialize league team identities.", saved.error);
  return { identities: saved.data ?? [] };
}

export async function applyLeagueTeamIdentityOverrides(leagueId: string, overrides: LeagueTeamIdentityOverride[]) {
  await seedLeagueTeamIdentities(leagueId);
  if (!overrides.length) return { updated: 0 };

  const identities = await supabase.from("rec_league_team_identities")
    .select("id,team_id,default_team_name,default_city,default_abbreviation,conference,division")
    .eq("league_id", leagueId);
  if (identities.error) throw new ApiError(500, "Could not load the league identity map.", identities.error);

  const seenSlots = new Set<string>();
  const finalDisplayAbbreviations = new Map((identities.data ?? []).map((row) => [
    String(row.default_abbreviation).toUpperCase(),
    String(row.default_abbreviation).toUpperCase(),
  ]));
  for (const override of overrides) {
    finalDisplayAbbreviations.set(override.replacesAbbreviation.trim().toUpperCase(), override.abbreviation.trim().toUpperCase());
  }
  const allFinalAbbreviations = [...finalDisplayAbbreviations.values()];
  if (new Set(allFinalAbbreviations).size !== allFinalAbbreviations.length) {
    throw new ApiError(400, "Every final league-facing team abbreviation must be unique.");
  }
  let updated = 0;
  for (const override of overrides) {
    const slot = override.replacesAbbreviation.trim().toUpperCase();
    const displayAbbreviation = override.abbreviation.trim().toUpperCase();
    if (seenSlots.has(slot)) throw new ApiError(400, `NFL slot ${slot} was provided more than once.`);
    seenSlots.add(slot);

    const identity = (identities.data ?? []).find((row) => String(row.default_abbreviation).toUpperCase() === slot);
    if (!identity) throw new ApiError(400, `Unknown NFL identity slot ${slot}.`);
    const displayTeamName = `${override.city.trim()} ${override.nick.trim()}`.trim();
    const identityUpdate = await supabase.from("rec_league_team_identities").update({
      is_custom_identity: true,
      display_team_name: displayTeamName,
      display_city: override.city.trim(),
      display_abbreviation: displayAbbreviation,
      primary_logo_url: override.primaryLogoUrl?.trim() || null,
      secondary_logo_url: override.secondaryLogoUrl?.trim() || null,
      wordmark_url: override.wordmarkUrl?.trim() || null,
      primary_color: override.primaryColor?.trim() || null,
      secondary_color: override.secondaryColor?.trim() || null,
      tertiary_color: override.tertiaryColor?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", identity.id);
    if (identityUpdate.error) throw new ApiError(500, `Could not save the ${slot} identity.`, identityUpdate.error);

    // Compatibility projection: existing consumers already prefer these display fields, while
    // imports and schedules continue resolving through the unchanged team row / Madden ID.
    const teamUpdate = await supabase.from("rec_teams").update({
      name: displayTeamName,
      display_city: override.city.trim(),
      display_nick: override.nick.trim(),
      display_abbr: displayAbbreviation,
      is_relocated: true,
      original_abbreviation: slot,
      logo_url: override.primaryLogoUrl?.trim() || null,
      primary_color: override.primaryColor?.trim() || undefined,
      updated_at: new Date().toISOString(),
    }).eq("id", identity.team_id).eq("league_id", leagueId);
    if (teamUpdate.error) throw new ApiError(500, `Could not project the ${slot} display identity.`, teamUpdate.error);
    updated += 1;
  }
  return { updated };
}
