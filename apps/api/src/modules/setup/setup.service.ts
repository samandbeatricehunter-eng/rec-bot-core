import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import type {
  CreateLeagueInput,
  RegisterServerInput,
  UpdateServerRoutesInput
} from "./setup.schemas.js";

/**
 * Registers or updates a Discord guild in REC Core.
 *
 * All league setup and team linking flows resolve the active league through the
 * guild ID, so this server record is the root of server-scoped configuration.
 */
export async function registerServer(input: RegisterServerInput) {
  const existing = await supabase
    .from("rec_discord_servers")
    .select("*")
    .eq("guild_id", input.guildId)
    .maybeSingle();

  if (existing.error) {
    throw new ApiError(500, "Failed to check server registration", existing.error);
  }

  if (existing.data) {
    const updated = await supabase
      .from("rec_discord_servers")
      .update({
        name: input.name,
        setup_mode: input.setupMode,
        setup_status: "registered"
      })
      .eq("guild_id", input.guildId)
      .select("*")
      .single();

    if (updated.error) {
      throw new ApiError(500, "Failed to update server registration", updated.error);
    }

    await writeAuditLog({
      action: "server.registration.updated",
      entityType: "rec_discord_servers",
      entityId: updated.data.id,
      previousValue: existing.data,
      newValue: updated.data,
      reason: "Server Setup confirmed through Discord Admin Panel.",
      source: "manual_admin_entry"
    });

    return { server: updated.data, created: false };
  }

  const created = await supabase
    .from("rec_discord_servers")
    .insert({
      guild_id: input.guildId,
      name: input.name,
      setup_status: "registered",
      setup_mode: input.setupMode
    })
    .select("*")
    .single();

  if (created.error) {
    throw new ApiError(500, "Failed to register server", created.error);
  }

  await writeAuditLog({
    action: "server.registration.created",
    entityType: "rec_discord_servers",
    entityId: created.data.id,
    newValue: created.data,
    reason: "Server Setup confirmed through Discord Admin Panel.",
    source: "manual_admin_entry"
  });

  return { server: created.data, created: true };
}

function mapImportModeToTrustMode(importMode: CreateLeagueInput["importMode"]) {
  if (importMode === "manual") return "manual";
  return "imported";
}

export async function createLeagueForServer(input: CreateLeagueInput) {
  const serverResult = await registerServer({
    guildId: input.guildId,
    name: input.guildId,
    setupMode: "manual_first",
    requestedByDiscordId: input.requestedByDiscordId
  });

  const oldLinks = await supabase
    .from("rec_server_league_links")
    .update({ is_primary: false })
    .eq("server_id", serverResult.server.id)
    .eq("is_primary", true)
    .select("*");

  if (oldLinks.error) {
    throw new ApiError(500, "Failed to retire previous primary league link", oldLinks.error);
  }

  const league = await supabase
    .from("rec_leagues")
    .insert({
      name: input.name,
      league_type: input.leagueType,
      current_phase: input.currentPhase,
      current_week: input.currentWeek ?? null,
      trust_mode: mapImportModeToTrustMode(input.importMode),
      import_enabled: input.importMode !== "manual",
      fantasy_draft_status: input.leagueType === "fantasy_draft" ? "pending" : "not_applicable"
    })
    .select("*")
    .single();

  if (league.error) {
    throw new ApiError(500, "Failed to create REC league", league.error);
  }

  const configurationPayload = {
    league_id: league.data.id,
    roster_type: input.leagueType,
    import_mode: input.importMode,

    coin_economy_enabled: input.coinEconomyEnabled,
    custom_players_enabled: input.customPlayersEnabled,
    legends_enabled: input.legendsEnabled,
    dev_upgrades_enabled: input.devUpgradesEnabled,
    age_resets_enabled: input.ageResetsEnabled,
    training_packages_enabled: input.trainingPackagesEnabled,
    contract_adjustment_purchases_enabled: input.contractAdjustmentPurchasesEnabled,
    cap_management_assistant_enabled: input.capManagementAssistantEnabled,

    draft_class_features_enabled: input.draftClassFeaturesEnabled,
    draft_class_type: input.draftClassType,
    scouting_purchases_enabled: input.scoutingPurchasesEnabled,
    media_features_enabled: input.mediaFeaturesEnabled,

    streaming_requirement: input.regularSeasonStreamingRequirement,
    regular_season_streaming_requirement: input.regularSeasonStreamingRequirement,
    postseason_streaming_requirement: input.postseasonStreamingRequirement,
    streaming_scope: input.streamingScope,
    streaming_side: input.streamingSide,

    fourth_down_rule_type: input.fourthDownRuleType,
    custom_fourth_down_rule: input.customFourthDownRule ?? null,

    position_change_policy: input.positionChangePolicy,
    position_change_policy_description:
      input.positionChangePolicyDescription ??
      "Position changes must remain realistic. Major body-type changes are prohibited unless approved by commissioners.",

    custom_playbooks_allowed: input.customPlaybooksAllowed,
    trade_approval_policy: input.tradeApprovalPolicy,
    cpu_trading_allowed: input.cpuTradingAllowed,
    cpu_free_agency_policy: input.cpuFreeAgencyPolicy,

    injury_policy: input.injuryPolicy,
    difficulty: input.difficulty,
    quarter_length_minutes: input.quarterLengthMinutes,
    accelerated_clock_enabled: input.acceleratedClockEnabled,
    accelerated_clock_minimum_seconds: input.acceleratedClockMinimumSeconds,
    salary_cap_enabled: input.salaryCapEnabled,
    trade_deadline_enabled: input.tradeDeadlineEnabled,
    abilities_enabled: input.abilitiesEnabled,
    wear_and_tear_enabled: input.wearAndTearEnabled,

    offensive_play_call_limits_enabled: input.offensivePlayCallLimitsEnabled,
    offensive_play_call_limit: input.offensivePlayCallLimit ?? null,
    offensive_play_call_cooldown: input.offensivePlayCallCooldown ?? null,
    defensive_play_call_limits_enabled: input.defensivePlayCallLimitsEnabled,
    defensive_play_call_limit: input.defensivePlayCallLimit ?? null,
    defensive_play_call_cooldown: input.defensivePlayCallCooldown ?? null
  };

  const configuration = await supabase
    .from("rec_league_configuration")
    .upsert(configurationPayload, { onConflict: "league_id" })
    .select("*")
    .single();

  if (configuration.error) {
    throw new ApiError(500, "Failed to save REC league configuration", configuration.error);
  }

  const link = await supabase
    .from("rec_server_league_links")
    .insert({
      server_id: serverResult.server.id,
      league_id: league.data.id,
      is_primary: true
    })
    .select("*")
    .single();

  if (link.error) {
    throw new ApiError(500, "Failed to link league to server", link.error);
  }

  await writeAuditLog({
    action: "league.created_and_configured",
    entityType: "rec_leagues",
    entityId: league.data.id,
    newValue: {
      league: league.data,
      configuration: configuration.data,
      serverLeagueLink: link.data,
      retiredLinks: oldLinks.data ?? []
    },
    reason: "League Setup Wizard completed through Discord Admin Panel.",
    source: "manual_admin_entry"
  });

  return {
    server: serverResult.server,
    league: league.data,
    configuration: configuration.data,
    serverLeagueLink: link.data
  };
}

/**
 * Saves Discord routing configuration for a server.
 */
export async function updateServerRoutes(input: UpdateServerRoutesInput) {
  const server = await supabase
    .from("rec_discord_servers")
    .select("*")
    .eq("guild_id", input.guildId)
    .single();

  if (server.error) {
    throw new ApiError(404, "Server must be registered before routes can be saved", server.error);
  }

  const payload = {
    server_id: server.data.id,
    general_chat_channel_id: input.generalChatChannelId ?? null,
    admin_import_log_channel_id: input.adminImportLogChannelId ?? null,
    scheduling_channel_id: input.schedulingChannelId ?? null,
    media_channel_id: input.mediaChannelId ?? null,
    rules_channel_id: input.rulesChannelId ?? null,
    announcements_channel_id: input.announcementsChannelId ?? null,
    economy_channel_id: input.economyChannelId ?? null
  };

  const routes = await supabase
    .from("rec_server_routes")
    .upsert(payload, { onConflict: "server_id" })
    .select("*")
    .single();

  if (routes.error) {
    throw new ApiError(500, "Failed to update server routes", routes.error);
  }

  await writeAuditLog({
    action: "server.routes.updated",
    entityType: "rec_server_routes",
    entityId: routes.data.id,
    newValue: payload,
    reason: "Server routing updated through setup flow.",
    source: "manual_admin_entry"
  });

  return routes.data;
}
