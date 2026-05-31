import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import type { CreateLeagueInput, RegisterServerInput, UpdateServerRoutesInput } from "./setup.schemas.js";

export async function registerServer(input: RegisterServerInput) {
  const existing = await supabase.from("rec_discord_servers").select("*").eq("guild_id", input.guildId).maybeSingle();
  if (existing.error) throw new ApiError(500, "Failed to check server registration", existing.error);
  if (existing.data) {
    const updated = await supabase.from("rec_discord_servers").update({ name: input.name, setup_mode: input.setupMode, setup_status: "registered" }).eq("guild_id", input.guildId).select("*").single();
    if (updated.error) throw new ApiError(500, "Failed to update server registration", updated.error);
    await writeAuditLog({ action:"server.registration.updated", entityType:"rec_discord_servers", entityId: updated.data.id, previousValue: existing.data, newValue: updated.data, reason:"Server Setup confirmed through Discord Admin Panel.", source:"manual_admin_entry" });
    return { server: updated.data, created: false };
  }
  const created = await supabase.from("rec_discord_servers").insert({ guild_id: input.guildId, name: input.name, setup_status: "registered", setup_mode: input.setupMode }).select("*").single();
  if (created.error) throw new ApiError(500, "Failed to register server", created.error);
  await writeAuditLog({ action:"server.registration.created", entityType:"rec_discord_servers", entityId: created.data.id, newValue: created.data, reason:"Server Setup confirmed through Discord Admin Panel.", source:"manual_admin_entry" });
  return { server: created.data, created: true };
}
export async function createLeagueForServer(input: CreateLeagueInput) {
  const serverResult = await registerServer({ guildId: input.guildId, name: input.guildId, setupMode:"manual_first", requestedByDiscordId: input.requestedByDiscordId });
  const league = await supabase.from("rec_leagues").insert({ name: input.name, league_type: input.leagueType, current_phase: input.currentPhase, current_week: input.currentWeek ?? null, trust_mode: input.trustMode, import_enabled: input.importEnabled, fantasy_draft_status: input.currentPhase === "fantasy_draft" ? "pending" : "not_applicable" }).select("*").single();
  if (league.error) throw new ApiError(500, "Failed to create REC league", league.error);
  const link = await supabase.from("rec_server_league_links").upsert({ server_id: serverResult.server.id, league_id: league.data.id, is_primary: true }, { onConflict: "server_id,league_id" }).select("*").single();
  if (link.error) throw new ApiError(500, "Failed to link league to server", link.error);
  await writeAuditLog({ action:"league.created_and_linked", entityType:"rec_leagues", entityId: league.data.id, newValue:{ league: league.data, serverLeagueLink: link.data }, reason:"League Setup confirmed through Discord Admin Panel.", source:"manual_admin_entry" });
  return { server: serverResult.server, league: league.data, serverLeagueLink: link.data };
}
export async function updateServerRoutes(input: UpdateServerRoutesInput) {
  const server = await supabase.from("rec_discord_servers").select("*").eq("guild_id", input.guildId).single();
  if (server.error) throw new ApiError(404, "Server must be registered before routes can be saved", server.error);
  const payload = { server_id: server.data.id, general_chat_channel_id: input.generalChatChannelId ?? null, admin_import_log_channel_id: input.adminImportLogChannelId ?? null, scheduling_channel_id: input.schedulingChannelId ?? null, media_channel_id: input.mediaChannelId ?? null, rules_channel_id: input.rulesChannelId ?? null, announcements_channel_id: input.announcementsChannelId ?? null, economy_channel_id: input.economyChannelId ?? null };
  const routes = await supabase.from("rec_server_routes").upsert(payload, { onConflict: "server_id" }).select("*").single();
  if (routes.error) throw new ApiError(500, "Failed to update server routes", routes.error);
  return routes.data;
}
