import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { createDefaultTeamsForGuild } from "../team-ownership/team-ownership.service.js";
import type {
  CreateLeagueInput,
  RegisterServerInput,
  UpdateServerRoutesInput
} from "./setup.schemas.js";

function normalizeLeagueSetupInput(input: CreateLeagueInput): CreateLeagueInput {
  if (input.game !== "cfb_27") return input;

  const dynastyType = input.dynastyType ?? "real";
  return {
    ...input,
    dynastyType,
    teamBuilderAllowed: dynastyType === "mixed",
    legendsEnabled: false,
    ageResetsEnabled: false,
    contractAdjustmentPurchasesEnabled: false,
    legendsSeasonCap: 0,
    ageResetsSeasonCap: 0,
    contractPurchasesSeasonCap: 0,
    legendsAllTimeCap: null,
    ageResetsAllTimeCap: null,
    contractPurchasesAllTimeCap: null,
    salaryCapEnabled: false,
    tradeDeadlineEnabled: false,
  };
}

function buildCfbSettings(input: CreateLeagueInput) {
  return {
    recruitingRestrictions: input.recruitingRestrictions ?? null,
    coachCarouselEnabled: input.coachCarouselEnabled ?? true,
    stadiumPulseEnabled: input.stadiumPulseEnabled ?? true,
  };
}

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

export async function createLeagueForServer(input: CreateLeagueInput) {
  input = normalizeLeagueSetupInput(input);

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

  if (existingPrimaryLink.data?.league_id) {
    const deleted = await supabase.rpc("rec_delete_league", { p_league_id: existingPrimaryLink.data.league_id });
    if (deleted.error) {
      throw new ApiError(500, "Failed to clear existing league data before setup", deleted.error);
    }
  }

  const leagueFields = {
    name: input.name,
    game: input.game,
    league_type: input.leagueType,
    current_phase: "preseason",
    season_stage: "preseason_training_camp",
    season_number: input.seasonNumber ?? 1,
    current_week: 1,
    trust_mode: "manual",
    fantasy_draft_status: input.leagueType === "fantasy_draft" ? "pending" : "not_applicable"
  };

  const league = await supabase.from("rec_leagues").insert(leagueFields).select("*").single();

  if (league.error) {
    throw new ApiError(500, "Failed to save REC league", league.error);
  }

  const configurationPayload = {
    league_id: league.data.id,
    league_password: input.leaguePassword ?? null,
    roster_type: input.leagueType,
    dynasty_type: input.game === "cfb_27" ? input.dynastyType : null,
    recruiting_difficulty: input.game === "cfb_27" ? input.recruitingDifficulty : null,
    transfer_portal_enabled: input.game === "cfb_27" ? input.transferPortalEnabled : null,
    coach_carousel_enabled: input.game === "cfb_27" ? input.coachCarouselEnabled : null,
    conference_realignment: input.game === "cfb_27" ? input.conferenceRealignment : null,
    home_field_advantage_enabled: input.game === "cfb_27" ? input.homeFieldAdvantageEnabled : null,
    stadium_pulse_enabled: input.game === "cfb_27" ? input.stadiumPulseEnabled : null,
    team_builder_allowed: input.game === "cfb_27" ? input.teamBuilderAllowed : null,
    cfb_settings: input.game === "cfb_27" ? buildCfbSettings(input) : {},

    coin_economy_enabled: input.coinEconomyEnabled,
    custom_players_enabled: input.customPlayersEnabled,
    legends_enabled: input.legendsEnabled,
    dev_upgrades_enabled: input.devUpgradesEnabled,
    age_resets_enabled: input.ageResetsEnabled,
    attribute_purchases_enabled: input.attributePurchasesEnabled,
    player_trait_purchases_enabled: input.playerTraitPurchasesEnabled,
    contract_adjustment_purchases_enabled: input.contractAdjustmentPurchasesEnabled,
    media_features_enabled: input.mediaFeaturesEnabled,
    custom_players_season_cap: input.customPlayersSeasonCap ?? 0,
    legends_season_cap: input.legendsSeasonCap ?? 0,
    dev_upgrades_season_cap: input.devUpgradesSeasonCap ?? 0,
    age_resets_season_cap: input.ageResetsSeasonCap ?? 0,
    player_trait_purchases_season_cap: input.playerTraitPurchasesSeasonCap ?? 0,
    contract_purchases_season_cap: input.contractPurchasesSeasonCap ?? 0,
    core_attribute_purchases_season_cap: input.coreAttributePurchasesSeasonCap ?? 0,
    non_core_attribute_purchases_season_cap: input.nonCoreAttributePurchasesSeasonCap ?? 0,
    core_attributes: input.coreAttributes ?? [],
    custom_players_all_time_cap: input.customPlayersAllTimeCap ?? null,
    legends_all_time_cap: input.legendsAllTimeCap ?? null,
    dev_upgrades_all_time_cap: input.devUpgradesAllTimeCap ?? null,
    age_resets_all_time_cap: input.ageResetsAllTimeCap ?? null,
    player_trait_purchases_all_time_cap: input.playerTraitPurchasesAllTimeCap ?? null,
    contract_purchases_all_time_cap: input.contractPurchasesAllTimeCap ?? null,
    core_attribute_purchases_all_time_cap: input.coreAttributePurchasesAllTimeCap ?? null,
    non_core_attribute_purchases_all_time_cap: input.nonCoreAttributePurchasesAllTimeCap ?? null,

    streaming_requirement: input.regularSeasonStreamingRequirement,
    regular_season_streaming_requirement: input.regularSeasonStreamingRequirement,
    postseason_streaming_requirement: input.postseasonStreamingRequirement,
    streaming_scope: input.streamingScope,
    streaming_side: input.regularSeasonStreamingSide ?? input.streamingSide,
    regular_season_streaming_side: input.regularSeasonStreamingSide ?? input.streamingSide,
    postseason_streaming_side: input.postseasonStreamingSide ?? input.streamingSide,

    fourth_down_rule_type: input.fourthDownRuleTypeRegular ?? input.fourthDownRuleType,
    custom_fourth_down_rule: input.customFourthDownRuleRegular ?? input.customFourthDownRule ?? null,
    fourth_down_rule_type_regular: input.fourthDownRuleTypeRegular ?? input.fourthDownRuleType,
    fourth_down_rule_type_playoff: input.fourthDownRuleTypePlayoff ?? input.fourthDownRuleType,
    custom_fourth_down_rule_regular: input.customFourthDownRuleRegular ?? null,
    custom_fourth_down_rule_playoff: input.customFourthDownRulePlayoff ?? null,

    position_change_policy: input.positionChangePolicy,
    position_change_policy_description:
      input.positionChangePolicyDescription ??
      "Position changes must remain realistic. Major body-type changes are prohibited unless approved by commissioners.",

    custom_coaches_required: input.customCoachesRequired ?? false,
    custom_playbooks_allowed: input.customPlaybooksAllowed,
    coach_abilities_restricted: input.coachAbilitiesRestricted ?? false,
    coach_abilities_restriction_notes: input.coachAbilitiesRestrictionNotes ?? null,
    trade_approval_policy: input.tradeApprovalPolicy,
    cpu_trading_allowed: input.cpuTradingPolicy ? input.cpuTradingPolicy === "allowed" : input.cpuTradingAllowed,
    cpu_trading_policy: input.cpuTradingPolicy,
    cpu_trading_restriction: input.cpuTradingRestriction ?? null,
    cpu_free_agency_policy: "disabled",

    injury_policy: input.injuryPolicy,
    difficulty: input.difficulty,
    difficulty_custom_settings: input.difficultyCustomSettings ?? null,
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
    ...(input.forceWinRequirements != null ? { force_win_requirements: input.forceWinRequirements } : {}),
    default_schedule_seed_requested: input.seedDefaultSchedule ?? false,
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
      reused: false
    },
    reason: "League Setup Wizard completed through Discord Admin Panel.",
    source: "manual_admin_entry"
  });

  const defaultTeams = await createDefaultTeamsForGuild({
    guildId: input.guildId,
    requestedByDiscordId: input.requestedByDiscordId ?? null,
  });

  return {
    server: serverResult.server,
    league: league.data,
    configuration: configuration.data,
    serverLeagueLink: link.data,
    defaultTeams: defaultTeams.teams,
    defaultScheduleSeed: defaultTeams.defaultScheduleSeed,
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
    scheduling_channel_id: input.schedulingChannelId ?? null,
    media_channel_id: input.mediaChannelId ?? null,
    rules_channel_id: input.rulesChannelId ?? null,
    announcements_channel_id: input.announcementsChannelId ?? null,
    streams_channel_id: input.streamsChannelId ?? null,
    highlights_channel_id: input.highlightsChannelId ?? null,
    pending_payouts_channel_id: input.pendingPayoutsChannelId ?? null,
    pending_purchases_channel_id: input.pendingPurchasesChannelId ?? null,
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
  input = normalizeLeagueSetupInput(input);
  const context = await getCurrentLeagueContext(input.guildId);

  const configurationPayload = {
    league_id: context.leagueId,
    league_password: input.leaguePassword ?? null,
    roster_type: input.leagueType,
    dynasty_type: input.game === "cfb_27" ? input.dynastyType : null,
    recruiting_difficulty: input.game === "cfb_27" ? input.recruitingDifficulty : null,
    transfer_portal_enabled: input.game === "cfb_27" ? input.transferPortalEnabled : null,
    coach_carousel_enabled: input.game === "cfb_27" ? input.coachCarouselEnabled : null,
    conference_realignment: input.game === "cfb_27" ? input.conferenceRealignment : null,
    home_field_advantage_enabled: input.game === "cfb_27" ? input.homeFieldAdvantageEnabled : null,
    stadium_pulse_enabled: input.game === "cfb_27" ? input.stadiumPulseEnabled : null,
    team_builder_allowed: input.game === "cfb_27" ? input.teamBuilderAllowed : null,
    cfb_settings: input.game === "cfb_27" ? buildCfbSettings(input) : {},
    coin_economy_enabled: input.coinEconomyEnabled,
    custom_players_enabled: input.customPlayersEnabled,
    legends_enabled: input.legendsEnabled,
    dev_upgrades_enabled: input.devUpgradesEnabled,
    age_resets_enabled: input.ageResetsEnabled,
    attribute_purchases_enabled: input.attributePurchasesEnabled,
    player_trait_purchases_enabled: input.playerTraitPurchasesEnabled,
    contract_adjustment_purchases_enabled: input.contractAdjustmentPurchasesEnabled,
    media_features_enabled: input.mediaFeaturesEnabled,
    custom_players_season_cap: input.customPlayersSeasonCap ?? 0,
    legends_season_cap: input.legendsSeasonCap ?? 0,
    dev_upgrades_season_cap: input.devUpgradesSeasonCap ?? 0,
    age_resets_season_cap: input.ageResetsSeasonCap ?? 0,
    player_trait_purchases_season_cap: input.playerTraitPurchasesSeasonCap ?? 0,
    contract_purchases_season_cap: input.contractPurchasesSeasonCap ?? 0,
    core_attribute_purchases_season_cap: input.coreAttributePurchasesSeasonCap ?? 0,
    non_core_attribute_purchases_season_cap: input.nonCoreAttributePurchasesSeasonCap ?? 0,
    core_attributes: input.coreAttributes ?? [],
    custom_players_all_time_cap: input.customPlayersAllTimeCap ?? null,
    legends_all_time_cap: input.legendsAllTimeCap ?? null,
    dev_upgrades_all_time_cap: input.devUpgradesAllTimeCap ?? null,
    age_resets_all_time_cap: input.ageResetsAllTimeCap ?? null,
    player_trait_purchases_all_time_cap: input.playerTraitPurchasesAllTimeCap ?? null,
    contract_purchases_all_time_cap: input.contractPurchasesAllTimeCap ?? null,
    core_attribute_purchases_all_time_cap: input.coreAttributePurchasesAllTimeCap ?? null,
    non_core_attribute_purchases_all_time_cap: input.nonCoreAttributePurchasesAllTimeCap ?? null,
    streaming_requirement: input.regularSeasonStreamingRequirement,
    regular_season_streaming_requirement: input.regularSeasonStreamingRequirement,
    postseason_streaming_requirement: input.postseasonStreamingRequirement,
    streaming_scope: input.streamingScope,
    streaming_side: input.regularSeasonStreamingSide ?? input.streamingSide,
    regular_season_streaming_side: input.regularSeasonStreamingSide ?? input.streamingSide,
    postseason_streaming_side: input.postseasonStreamingSide ?? input.streamingSide,
    fourth_down_rule_type: input.fourthDownRuleTypeRegular ?? input.fourthDownRuleType,
    custom_fourth_down_rule: input.customFourthDownRuleRegular ?? input.customFourthDownRule ?? null,
    fourth_down_rule_type_regular: input.fourthDownRuleTypeRegular ?? input.fourthDownRuleType,
    fourth_down_rule_type_playoff: input.fourthDownRuleTypePlayoff ?? input.fourthDownRuleType,
    custom_fourth_down_rule_regular: input.customFourthDownRuleRegular ?? null,
    custom_fourth_down_rule_playoff: input.customFourthDownRulePlayoff ?? null,
    position_change_policy: input.positionChangePolicy,
    position_change_policy_description: input.positionChangePolicyDescription ?? "Position changes must remain realistic. Major body-type changes are prohibited unless approved by commissioners.",
    custom_coaches_required: input.customCoachesRequired ?? false,
    custom_playbooks_allowed: input.customPlaybooksAllowed,
    coach_abilities_restricted: input.coachAbilitiesRestricted ?? false,
    coach_abilities_restriction_notes: input.coachAbilitiesRestrictionNotes ?? null,
    trade_approval_policy: input.tradeApprovalPolicy,
    cpu_trading_allowed: input.cpuTradingPolicy ? input.cpuTradingPolicy === "allowed" : input.cpuTradingAllowed,
    cpu_trading_policy: input.cpuTradingPolicy,
    cpu_trading_restriction: input.cpuTradingRestriction ?? null,
    cpu_free_agency_policy: "disabled",
    injury_policy: input.injuryPolicy,
    difficulty: input.difficulty,
    difficulty_custom_settings: input.difficultyCustomSettings ?? null,
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
    ...(input.forceWinRequirements != null ? { force_win_requirements: input.forceWinRequirements } : {}),
    default_schedule_seed_requested: input.seedDefaultSchedule ?? false,
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
    supabase.from("rec_leagues").select("name,game").eq("id", context.leagueId).single(),
    supabase.from("rec_league_configuration").select("*").eq("league_id", context.leagueId).maybeSingle()
  ]);
  if (league.error) throw new ApiError(500, "Failed to load league", league.error);
  const c = config.data ?? {};
  const cfbSettings = c.cfb_settings && typeof c.cfb_settings === "object" && !Array.isArray(c.cfb_settings) ? c.cfb_settings : {};
  const r = context.routes ?? {};
  const draft = {
    name: league.data.name ?? "League",
    game: league.data.game ?? "madden_26",
    leaguePassword: c.league_password ?? null,
    leagueType: c.roster_type ?? "regular_rosters",
    dynastyType: c.dynasty_type ?? "real",
    recruitingDifficulty: c.recruiting_difficulty ?? "normal",
    transferPortalEnabled: c.transfer_portal_enabled ?? true,
    recruitingRestrictions: typeof cfbSettings.recruitingRestrictions === "string" ? cfbSettings.recruitingRestrictions : "",
    coachCarouselEnabled: c.coach_carousel_enabled ?? true,
    conferenceRealignment: c.conference_realignment ?? "locked",
    homeFieldAdvantageEnabled: c.home_field_advantage_enabled ?? true,
    stadiumPulseEnabled: c.stadium_pulse_enabled ?? true,
    teamBuilderAllowed: c.team_builder_allowed ?? (c.dynasty_type === "mixed"),
    seasonWeek: "week_1",
    coinEconomyEnabled: c.coin_economy_enabled ?? false,
    customPlayersEnabled: c.custom_players_enabled ?? false,
    legendsEnabled: c.legends_enabled ?? false,
    devUpgradesEnabled: c.dev_upgrades_enabled ?? false,
    ageResetsEnabled: c.age_resets_enabled ?? false,
    attributePurchasesEnabled: c.attribute_purchases_enabled ?? false,
    playerTraitPurchasesEnabled: c.player_trait_purchases_enabled ?? false,
    contractAdjustmentPurchasesEnabled: c.contract_adjustment_purchases_enabled ?? false,
    mediaFeaturesEnabled: c.media_features_enabled ?? true,
    customPlayersSeasonCap: c.custom_players_season_cap ?? 0,
    legendsSeasonCap: c.legends_season_cap ?? 0,
    devUpgradesSeasonCap: c.dev_upgrades_season_cap ?? 0,
    ageResetsSeasonCap: c.age_resets_season_cap ?? 0,
    playerTraitPurchasesSeasonCap: c.player_trait_purchases_season_cap ?? 0,
    contractPurchasesSeasonCap: c.contract_purchases_season_cap ?? 0,
    coreAttributePurchasesSeasonCap: c.core_attribute_purchases_season_cap ?? 0,
    nonCoreAttributePurchasesSeasonCap: c.non_core_attribute_purchases_season_cap ?? 0,
    coreAttributes: Array.isArray(c.core_attributes) ? c.core_attributes.filter((code: unknown) => typeof code === "string") : [],
    customPlayersAllTimeCap: c.custom_players_all_time_cap ?? null,
    legendsAllTimeCap: c.legends_all_time_cap ?? null,
    devUpgradesAllTimeCap: c.dev_upgrades_all_time_cap ?? null,
    ageResetsAllTimeCap: c.age_resets_all_time_cap ?? null,
    playerTraitPurchasesAllTimeCap: c.player_trait_purchases_all_time_cap ?? null,
    contractPurchasesAllTimeCap: c.contract_purchases_all_time_cap ?? null,
    coreAttributePurchasesAllTimeCap: c.core_attribute_purchases_all_time_cap ?? null,
    nonCoreAttributePurchasesAllTimeCap: c.non_core_attribute_purchases_all_time_cap ?? null,
    streamingRequirement: c.streaming_requirement ?? "recommended",
    regularSeasonStreamingRequirement: c.regular_season_streaming_requirement ?? "recommended",
    postseasonStreamingRequirement: c.postseason_streaming_requirement ?? "required",
    streamingScope: c.streaming_scope ?? "every_game",
    streamingSide: c.regular_season_streaming_side ?? c.streaming_side ?? "either",
    regularSeasonStreamingSide: c.regular_season_streaming_side ?? c.streaming_side ?? "either",
    postseasonStreamingSide: c.postseason_streaming_side ?? c.streaming_side ?? "either",
    fourthDownRuleTypeRegular: c.fourth_down_rule_type_regular ?? c.fourth_down_rule_type ?? "standard_rec",
    fourthDownRuleTypePlayoff: c.fourth_down_rule_type_playoff ?? c.fourth_down_rule_type ?? "standard_rec",
    customFourthDownRuleRegular: c.custom_fourth_down_rule_regular ?? c.custom_fourth_down_rule ?? "",
    customFourthDownRulePlayoff: c.custom_fourth_down_rule_playoff ?? "",
    positionChangePolicy: c.position_change_policy ?? "restricted",
    positionChangePolicyDescription: c.position_change_policy_description ?? "Position changes must remain realistic. Major body-type changes are prohibited unless approved by commissioners.",
    customCoachesRequired: c.custom_coaches_required ?? false,
    customPlaybooksAllowed: c.custom_playbooks_allowed ?? false,
    coachAbilitiesRestricted: c.coach_abilities_restricted ?? false,
    coachAbilitiesRestrictionNotes: c.coach_abilities_restriction_notes ?? "",
    tradeApprovalPolicy: c.trade_approval_policy ?? "competition_committee_review",
    cpuTradingAllowed: c.cpu_trading_policy ? c.cpu_trading_policy === "allowed" : c.cpu_trading_allowed ?? true,
    cpuTradingPolicy: c.cpu_trading_policy ?? (c.cpu_trading_allowed === false ? "not_allowed" : "allowed"),
    cpuTradingRestriction: c.cpu_trading_restriction ?? "",
    cpuFreeAgencyPolicy: "disabled",
    injuryPolicy: c.injury_policy ?? "on_standard",
    difficulty: c.difficulty ?? "all_madden",
    difficultyCustomSettings: c.difficulty_custom_settings ?? "",
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
    fairSimRequirements: c.fair_sim_requirements || "Fair Sims are the default for any game where users fail to schedule their game prior to advance time.",
    forceWinRequirements: c.force_win_requirements || "Force Wins can be requested if users agree to a scheduled time and one fails to appear within 1 hour of the elapsed game time.",
    commissionerOfficeChannelId: r.commissioner_office_channel_id ?? null,
    announcementsChannelId: r.announcements_channel_id ?? null,
    votingPollsChannelId: r.voting_polls_channel_id ?? null,
    streamsChannelId: r.streams_channel_id ?? null,
    highlightsChannelId: r.highlights_channel_id ?? null,
    pendingPayoutsChannelId: r.pending_payouts_channel_id ?? null,
    pendingPurchasesChannelId: r.pending_purchases_channel_id ?? null,
    boxScoresChannelId: r.box_scores_channel_id ?? null,
    gameChannelsCategoryId: r.game_channels_category_id ?? null,
    seedDefaultSchedule: c.default_schedule_seed_requested ?? false,
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
