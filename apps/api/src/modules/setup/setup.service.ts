import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
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
    name: input.serverName ?? input.guildId,
    setupMode: "manual_first",
    requestedByDiscordId: input.requestedByDiscordId
  });

  // Reuse the server's existing primary league if one exists so that re-running League Setup
  // updates the league in place instead of creating duplicate leagues for the same server.
  const existingPrimaryLink = await supabase
    .from("rec_server_league_links")
    .select("league_id")
    .eq("server_id", serverResult.server.id)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();

  if (existingPrimaryLink.error) {
    throw new ApiError(500, "Failed to look up existing primary league", existingPrimaryLink.error);
  }

  const leagueFields = {
    name: input.name,
    league_type: input.leagueType,
    current_phase: "preseason",
    season_stage: "preseason_training_camp",
    season_number: input.seasonNumber ?? 1,
    current_week: 1,
    trust_mode: mapImportModeToTrustMode(input.importMode),
    import_enabled: input.importMode !== "manual",
    fantasy_draft_status: input.leagueType === "fantasy_draft" ? "pending" : "not_applicable"
  };

  const league = existingPrimaryLink.data?.league_id
    ? await supabase.from("rec_leagues").update(leagueFields).eq("id", existingPrimaryLink.data.league_id).select("*").single()
    : await supabase.from("rec_leagues").insert(leagueFields).select("*").single();

  if (league.error) {
    throw new ApiError(500, "Failed to save REC league", league.error);
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

    custom_coaches_required: input.customCoachesRequired ?? false,
    custom_playbooks_allowed: input.customPlaybooksAllowed,
    coach_abilities_restricted: input.coachAbilitiesRestricted ?? false,
    coach_abilities_restriction_notes: input.coachAbilitiesRestrictionNotes ?? null,
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
    defensive_play_call_cooldown: input.defensivePlayCallCooldown ?? null,

    ...(input.fairSimRequirements != null ? { fair_sim_requirements: input.fairSimRequirements } : {}),
    ...(input.forceWinRequirements != null ? { force_win_requirements: input.forceWinRequirements } : {})
  };

  const configuration = await supabase
    .from("rec_league_configuration")
    .upsert(configurationPayload, { onConflict: "league_id" })
    .select("*")
    .single();

  if (configuration.error) {
    throw new ApiError(500, "Failed to save REC league configuration", configuration.error);
  }

  const link = existingPrimaryLink.data?.league_id
    ? await supabase
        .from("rec_server_league_links")
        .select("*")
        .eq("server_id", serverResult.server.id)
        .eq("league_id", league.data.id)
        .limit(1)
        .single()
    : await supabase
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
      reused: Boolean(existingPrimaryLink.data?.league_id)
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
    streams_channel_id: input.streamsChannelId ?? null,
    highlights_channel_id: input.highlightsChannelId ?? null,
    pending_payouts_channel_id: input.pendingPayoutsChannelId ?? null,
    game_channels_category_id: input.gameChannelsCategoryId ?? null,
    commissioner_office_channel_id: input.commissionerOfficeChannelId ?? null,
    voting_polls_channel_id: input.votingPollsChannelId ?? null
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

export async function updateLeagueConfig(input: CreateLeagueInput) {
  const context = await getCurrentLeagueContext(input.guildId);

  const configurationPayload = {
    league_id: context.leagueId,
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
    position_change_policy_description: input.positionChangePolicyDescription ?? "Position changes must remain realistic. Major body-type changes are prohibited unless approved by commissioners.",
    custom_coaches_required: input.customCoachesRequired ?? false,
    custom_playbooks_allowed: input.customPlaybooksAllowed,
    coach_abilities_restricted: input.coachAbilitiesRestricted ?? false,
    coach_abilities_restriction_notes: input.coachAbilitiesRestrictionNotes ?? null,
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
    defensive_play_call_cooldown: input.defensivePlayCallCooldown ?? null,
    ...(input.fairSimRequirements != null ? { fair_sim_requirements: input.fairSimRequirements } : {}),
    ...(input.forceWinRequirements != null ? { force_win_requirements: input.forceWinRequirements } : {})
  };

  const { data, error } = await supabase
    .from("rec_league_configuration")
    .upsert(configurationPayload, { onConflict: "league_id" })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "Failed to update league configuration", error);
  return { configuration: data };
}

export async function getLeagueConfigAsDraft(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const [league, config] = await Promise.all([
    supabase.from("rec_leagues").select("name").eq("id", context.leagueId).single(),
    supabase.from("rec_league_configuration").select("*").eq("league_id", context.leagueId).maybeSingle()
  ]);
  if (league.error) throw new ApiError(500, "Failed to load league", league.error);
  const c = config.data ?? {};
  const draft = {
    name: league.data.name ?? "League",
    leagueType: c.roster_type ?? "regular_rosters",
    importMode: c.import_mode ?? "manual",
    seasonWeek: "week_1",
    coinEconomyEnabled: c.coin_economy_enabled ?? false,
    customPlayersEnabled: c.custom_players_enabled ?? false,
    legendsEnabled: c.legends_enabled ?? false,
    devUpgradesEnabled: c.dev_upgrades_enabled ?? false,
    ageResetsEnabled: c.age_resets_enabled ?? false,
    trainingPackagesEnabled: c.training_packages_enabled ?? false,
    contractAdjustmentPurchasesEnabled: c.contract_adjustment_purchases_enabled ?? false,
    capManagementAssistantEnabled: c.cap_management_assistant_enabled ?? false,
    draftClassFeaturesEnabled: c.draft_class_features_enabled ?? false,
    draftClassType: c.draft_class_type ?? "auto_gen",
    scoutingPurchasesEnabled: c.scouting_purchases_enabled ?? false,
    mediaFeaturesEnabled: c.media_features_enabled ?? true,
    streamingRequirement: c.streaming_requirement ?? "recommended",
    regularSeasonStreamingRequirement: c.regular_season_streaming_requirement ?? "recommended",
    postseasonStreamingRequirement: c.postseason_streaming_requirement ?? "required",
    streamingScope: c.streaming_scope ?? "every_game",
    streamingSide: c.streaming_side ?? "either",
    fourthDownRuleTypeRegular: c.fourth_down_rule_type ?? "standard_rec",
    fourthDownRuleTypePlayoff: c.fourth_down_rule_type ?? "standard_rec",
    positionChangePolicy: c.position_change_policy ?? "restricted",
    customCoachesRequired: c.custom_coaches_required ?? false,
    customPlaybooksAllowed: c.custom_playbooks_allowed ?? false,
    coachAbilitiesRestricted: c.coach_abilities_restricted ?? false,
    coachAbilitiesRestrictionNotes: c.coach_abilities_restriction_notes ?? "",
    tradeApprovalPolicy: c.trade_approval_policy ?? "competition_committee_review",
    cpuTradingAllowed: c.cpu_trading_allowed ?? true,
    cpuFreeAgencyPolicy: c.cpu_free_agency_policy ?? "open",
    injuryPolicy: c.injury_policy ?? "on_standard",
    difficulty: c.difficulty ?? "all_madden",
    quarterLengthMinutes: c.quarter_length_minutes ?? 8,
    acceleratedClockEnabled: c.accelerated_clock_enabled ?? true,
    acceleratedClockMinimumSeconds: c.accelerated_clock_minimum_seconds ?? 20,
    salaryCapEnabled: c.salary_cap_enabled ?? false,
    tradeDeadlineEnabled: c.trade_deadline_enabled ?? false,
    abilitiesEnabled: c.abilities_enabled ?? true,
    wearAndTearEnabled: c.wear_and_tear_enabled ?? true,
    offensivePlayCallLimitsEnabled: c.offensive_play_call_limits_enabled ?? false,
    offensivePlayCallLimit: c.offensive_play_call_limit ?? null,
    offensivePlayCallCooldownEnabled: !!c.offensive_play_call_cooldown,
    offensivePlayCallCooldown: c.offensive_play_call_cooldown ?? null,
    defensivePlayCallLimitsEnabled: c.defensive_play_call_limits_enabled ?? false,
    defensivePlayCallLimit: c.defensive_play_call_limit ?? null,
    defensivePlayCallCooldownEnabled: !!c.defensive_play_call_cooldown,
    defensivePlayCallCooldown: c.defensive_play_call_cooldown ?? null,
    fairSimRequirements: c.fair_sim_requirements ?? "",
    forceWinRequirements: c.force_win_requirements ?? "",
    linkTeamsAfterSetup: false,
    editMode: true
  };
  return { draft };
}

/**
 * Permanently deletes the guild's current league and every row scoped to it (records, links,
 * imports, teams, players, settings, etc.). Global user identity/economy and the Discord server
 * row are preserved. Requires the caller to type the league name exactly as confirmation.
 */
export async function deleteLeagueData(input: { guildId: string; requestedByDiscordId?: string; confirmationText: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  if (!context?.leagueId) throw new ApiError(404, "No league is set up for this server.");
  const leagueName = String(context.rec_leagues?.name ?? "").trim();
  const confirmation = String(input.confirmationText ?? "").trim();
  if (!confirmation || confirmation.toLowerCase() !== leagueName.toLowerCase()) {
    throw new ApiError(400, `Confirmation did not match. Type the league name exactly ("${leagueName}") to delete it.`);
  }

  const { data, error } = await supabase.rpc("rec_delete_league", { p_league_id: context.leagueId });
  if (error) throw new ApiError(500, "Failed to delete league data.", error);

  await writeAuditLog({
    action: "league.data.deleted",
    entityType: "rec_leagues",
    entityId: context.leagueId,
    reason: input.requestedByDiscordId ? `Deleted by discord:${input.requestedByDiscordId}` : null,
    newValue: { leagueName, result: data }
  }).catch(() => undefined);

  return { ok: true, leagueName, result: data };
}
