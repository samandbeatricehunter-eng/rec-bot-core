import { AFC_TEAMS, NFC_TEAMS, getTeamByAbbreviation } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import type { CreateDefaultTeamsInput, CustomTeamReplacementInput, LinkUserToTeamInput } from "./team-ownership.schemas.js";

export async function getCurrentLeagueForGuild(guildId: string) {
 const server = await supabase.from("rec_discord_servers").select("id,guild_id,name").eq("guild_id", guildId).single();
 if (server.error) throw new ApiError(404, "This Discord server is not registered in REC Core yet.", server.error);
 const link = await supabase.from("rec_server_league_links").select("league_id,is_primary").eq("server_id", server.data.id).eq("is_primary", true).single();
 if (link.error) throw new ApiError(404, "This Discord server does not have a current REC league linked yet.", link.error);
 const league = await supabase.from("rec_leagues").select("*").eq("id", link.data.league_id).single();
 if (league.error) throw new ApiError(404, "Linked REC league could not be loaded.", league.error);
 return { server: server.data, league: league.data };
}

export async function createDefaultTeamsForGuild(input: CreateDefaultTeamsInput) {
 const { league } = await getCurrentLeagueForGuild(input.guildId);
 const rows = [...AFC_TEAMS, ...NFC_TEAMS].map(t => ({ league_id: league.id, name: t.name, abbreviation: t.abbreviation, conference: t.conference, division: t.division, source: "manual_admin_entry" }));
 const result = await supabase.from("rec_teams").upsert(rows, { onConflict: "league_id,name" }).select("*");
 if (result.error) throw new ApiError(500, "Failed to create default league teams.", result.error);
 await writeAuditLog({ action:"teams.default_nfl.upserted", entityType:"rec_teams", newValue:{ guildId: input.guildId, leagueId: league.id, teamCount: rows.length }, reason:"Default teams created for Team Ownership setup.", source:"manual_admin_entry" });
 return { league, teams: result.data };
}

export async function createCustomTeamReplacement(input: CustomTeamReplacementInput) {
 const { league } = await getCurrentLeagueForGuild(input.guildId);
 const replaced = getTeamByAbbreviation(input.replacementTeamAbbreviation);
 if (!replaced) throw new ApiError(400, "Replacement NFL team abbreviation was not recognized.");
 const result = await supabase.from("rec_teams").upsert({ league_id: league.id, name: input.customTeamName, abbreviation: `CUSTOM_${replaced.abbreviation}`, conference: replaced.conference, division: replaced.division, source: "manual_admin_entry" }, { onConflict: "league_id,name" }).select("*").single();
 if (result.error) throw new ApiError(500, "Failed to create custom team replacement.", result.error);
 await writeAuditLog({ action:"team.custom_replacement.created", entityType:"rec_teams", entityId: result.data.id, newValue:{ guildId: input.guildId, leagueId: league.id, customTeamName: input.customTeamName, replacementTeam: replaced }, reason:"Custom team replacement created through Team Ownership setup.", source:"manual_admin_entry" });
 return { league, replacedTeam: replaced, customTeam: result.data };
}

export async function linkUserToTeam(input: LinkUserToTeamInput) {
 const { league } = await getCurrentLeagueForGuild(input.guildId);
 let account = await supabase.from("rec_discord_accounts").select("user_id,discord_id").eq("discord_id", input.discordId).maybeSingle();
 if (account.error) throw new ApiError(500, "Failed to check Discord account.", account.error);
 let userId = account.data?.user_id;
 if (!userId) {
  const user = await supabase.from("rec_users").insert({ display_name: input.discordId, status:"active" }).select("id").single();
  if (user.error) throw new ApiError(500, "Failed to create REC user for Discord account.", user.error);
  const created = await supabase.from("rec_discord_accounts").insert({ user_id:user.data.id, discord_id:input.discordId, username:input.discordId, global_name:input.discordId }).select("user_id").single();
  if (created.error) throw new ApiError(500, "Failed to create Discord account link.", created.error);
  userId = created.data.user_id;
 }
 const team = await supabase.from("rec_teams").select("*").eq("id", input.teamId).eq("league_id", league.id).single();
 if (team.error) throw new ApiError(404, "Team was not found in the current league.", team.error);
 await supabase.from("rec_league_memberships").upsert({ league_id: league.id, user_id: userId, status:"active", role: input.authority }, { onConflict:"league_id,user_id" });
 const assignment = await supabase.from("rec_team_assignments").insert({ league_id: league.id, team_id: input.teamId, user_id: userId, assignment_status:"active", source:"manual_admin_entry", notes:`Authority: ${input.authority}` }).select("*").single();
 if (assignment.error) throw new ApiError(500, "Failed to create team assignment.", assignment.error);
 await writeAuditLog({ action:"team.user_linked", entityType:"rec_team_assignments", entityId:assignment.data.id, newValue:{ guildId:input.guildId, leagueId:league.id, discordId:input.discordId, teamId:input.teamId, teamName:team.data.name, authority:input.authority }, reason:"User linked to team through Team Ownership setup.", source:"manual_admin_entry" });
 return { league, team: team.data, assignment: assignment.data, discordId: input.discordId, authority: input.authority };
}

export async function listLinkedUsersTeams(guildId: string) {
 const { league } = await getCurrentLeagueForGuild(guildId);
 const result = await supabase.from("rec_team_assignments").select("id,assignment_status,notes,user_id,team:rec_teams(id,name,abbreviation,conference,division),user:rec_users(id,display_name),created_at").eq("league_id", league.id).is("ended_at", null).order("created_at", { ascending:false });
 if (result.error) throw new ApiError(500, "Failed to load linked users/teams.", result.error);
 return { league, linked: result.data };
}

export async function listOpenTeams(guildId: string) {
 const { league } = await getCurrentLeagueForGuild(guildId);
 const teams = await supabase.from("rec_teams").select("*").eq("league_id", league.id).order("conference").order("name");
 if (teams.error) throw new ApiError(500, "Failed to load league teams.", teams.error);
 const assignments = await supabase.from("rec_team_assignments").select("team_id").eq("league_id", league.id).is("ended_at", null);
 if (assignments.error) throw new ApiError(500, "Failed to load team assignments.", assignments.error);
 const assigned = new Set(assignments.data.map(r => r.team_id));
 return { league, openTeams: teams.data.filter(t => !assigned.has(t.id)) };
}
