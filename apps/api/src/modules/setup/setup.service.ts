import { randomUUID } from "node:crypto";
import { LEAGUE_SLIDER_CATALOG_VERSION, REC_ROUTE_CHANNELS, getLeagueTemplatePreset, resolveLeagueSliderValues, type LeagueTemplateId } from "@rec/shared";
import { bestEffort } from "../../lib/best-effort.js";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { createDefaultTeamsForGuild, createDefaultTeamsForLeague } from "../team-ownership/team-ownership.service.js";
import { applyCfbBaselineToLeague } from "../cfb-baseline/cfb-baseline.service.js";
import { applyMaddenBaselineToLeague, getActiveMaddenDataset } from "../madden-baseline/madden-baseline.service.js";
import { seedMaddenDraftPicks } from "../draft-picks/madden-pick-seed.service.js";
import { ensureFantasyDraftSession } from "../fantasy-draft/fantasy-draft.service.js";
import { seedDefaultScheduleForLeague } from "../schedule/schedule.service.js";
import { deleteAllLeagueStreamHighlights } from "../media/media.service.js";
import { preserveGlobalContributionsBeforeLeagueDelete, preserveH2hHistoryBeforeLeagueDelete } from "../official-records/official-records.service.js";
import { snapshotLeagueHistory } from "../users/league-history.service.js";
import {
  assertCanCreateLeague,
  resolveRecUserIdByDiscordId,
} from "../subscriptions/entitlements.service.js";
import type {
  CreateLeagueInput,
  RegisterServerInput,
  UpdateServerRoutesInput
} from "./setup.schemas.js";

function normalizeLeagueSetupInput(input: CreateLeagueInput): CreateLeagueInput {
  const sliderSettings = resolveLeagueSliderValues(input.game, input.sliderPresetId, input.sliderSettings);
  const sliderCatalogVersion = LEAGUE_SLIDER_CATALOG_VERSION[input.game];
  if (input.game !== "cfb_27") return { ...input, sliderSettings, sliderCatalogVersion };

  const dynastyType = input.dynastyType ?? "real";
  return {
    ...input,
    sliderSettings,
    sliderCatalogVersion,
    dynastyType,
    teamBuilderAllowed: dynastyType === "mixed",
    ageResetsEnabled: false,
    contractAdjustmentPurchasesEnabled: false,
    // Campus Legends (CFB's Legends) supports its own season cap same as Madden — don't zero it.
    ageResetsSeasonCap: 0,
    contractPurchasesSeasonCap: 0,
    salaryCapEnabled: false,
    tradeDeadlineEnabled: false,
  };
}

function preserveWhenOmitted<T>(value: T | undefined, existing: T | null | undefined) {
  return value === undefined ? existing ?? null : value;
}

function buildRoutePayload(input: Record<string, unknown>, existing: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {};
  for (const config of Object.values(REC_ROUTE_CHANNELS)) {
    payload[config.dbField] = preserveWhenOmitted(input[config.inputField], existing[config.dbField]);
  }
  return payload;
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
    throw new ApiError(500, "We couldn't check server registration. Please try again.", existing.error);
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
      throw new ApiError(500, "We couldn't update server registration. Please try again.", updated.error);
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
    throw new ApiError(500, "We couldn't register that server. Please try again.", created.error);
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

  let ownerUserId: string | null = null;
  if (input.requestedByDiscordId) {
    ownerUserId = await resolveRecUserIdByDiscordId(input.requestedByDiscordId);
    if (ownerUserId) {
      await assertCanCreateLeague(ownerUserId, input.game);
    }
  }

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
    throw new ApiError(500, "We couldn't look up the existing primary league. Please try again.", existingPrimaryLink.error);
  }

  if (existingPrimaryLink.data?.league_id) {
    const deleted = await supabase.rpc("rec_delete_league", { p_league_id: existingPrimaryLink.data.league_id });
    if (deleted.error) {
      throw new ApiError(500, "We couldn't clear existing league data before setup. Please try again.", deleted.error);
    }
  }

  const leagueFields = {
    name: input.name,
    game: input.game,
    league_type: input.leagueType,
    ...(ownerUserId ? { owner_user_id: ownerUserId } : {}),
    current_phase: "preseason",
    // CFB has no training-camp period and starts at Preseason; Madden starts at Training Camp.
    // The bot immediately calls setLeagueWeek() right after creation to confirm this, but set it
    // correctly here too so the league is never briefly mislabeled if that follow-up call fails.
    season_stage: input.game === "cfb_27" ? "preseason" : "preseason_training_camp",
    season_number: input.seasonNumber ?? 1,
    current_week: 1,
    trust_mode: "manual",
    fantasy_draft_status: input.leagueType === "fantasy_draft" ? "pending" : "not_applicable",
    is_online: input.isOnline ?? true,
  };

  const league = await supabase.from("rec_leagues").insert(leagueFields).select("*").single();

  if (league.error) {
    throw new ApiError(500, "We couldn't save that league. Please try again.", league.error);
  }

  const configurationPayload = {
    league_id: league.data.id,
    league_password: input.leaguePassword ?? null,
    roster_type: input.leagueType,
    dynasty_type: input.game === "cfb_27" ? input.dynastyType : null,
    recruiting_difficulty: input.game === "cfb_27" ? input.recruitingDifficulty : null,
    active_rosters_enabled: input.game === "cfb_27" ? true : null,
    track_rosters_enabled: input.game === "cfb_27" ? true : null,
    transfer_portal_enabled: input.game === "cfb_27" ? input.transferPortalEnabled : null,
    coach_carousel_enabled: input.game === "cfb_27" ? input.coachCarouselEnabled : null,
    conference_realignment: input.game === "cfb_27" ? input.conferenceRealignment : null,
    home_field_advantage_enabled: input.game === "cfb_27" ? input.homeFieldAdvantageEnabled : null,
    stadium_pulse_enabled: input.game === "cfb_27" ? input.stadiumPulseEnabled : null,
    team_builder_allowed: input.game === "cfb_27" ? input.teamBuilderAllowed : null,
    player_edit_permission: input.game === "cfb_27" ? (input.playerEditPermission ?? "commish_only") : null,
    manual_xp_progression_penalty_pct: input.game === "cfb_27" ? (input.manualXpProgressionPenaltyPct ?? 25) : null,
    verbal_commit_influence_pct: input.game === "cfb_27" ? (input.verbalCommitInfluencePct ?? 25) : null,
    user_transfer_chance_pct: input.game === "cfb_27" ? (input.userTransferChancePct ?? 55) : null,
    cpu_transfer_chance_pct: input.game === "cfb_27" ? (input.cpuTransferChancePct ?? 55) : null,
    transfer_portal_max_per_team: input.game === "cfb_27" ? (input.transferPortalMaxPerTeam ?? 20) : null,
    minimum_play_clock_seconds: input.game === "cfb_27" ? (input.minimumPlayClockSeconds ?? 15) : null,
    season_experience: input.game === "cfb_27" ? (input.seasonExperience ?? "customized") : null,

    cross_play_enabled: input.crossPlayEnabled ?? true,
    required_console: input.crossPlayEnabled === false ? (input.requiredConsole ?? null) : null,
    coin_economy_enabled: input.coinEconomyEnabled,
    coin_economy_minimum_linked_users: input.coinEconomyMinimumLinkedUsers ?? 8,
    custom_players_enabled: input.customPlayersEnabled,
    legends_enabled: input.legendsEnabled,
    dev_upgrades_enabled: input.game === "cfb_27" ? false : input.devUpgradesEnabled,
    age_resets_enabled: input.game === "cfb_27" ? false : input.ageResetsEnabled,
    attribute_purchases_enabled: input.game === "cfb_27" ? false : input.attributePurchasesEnabled,
    player_trait_purchases_enabled: false,
    contract_adjustment_purchases_enabled: input.game === "cfb_27" ? false : input.contractAdjustmentPurchasesEnabled,
    media_features_enabled: input.mediaFeaturesEnabled,
    custom_players_season_cap: input.customPlayersSeasonCap ?? 0,
    legends_season_cap: input.legendsSeasonCap ?? 0,
    dev_upgrade_cap_mode: input.devUpgradeCapMode ?? "total_purchases",
    dev_upgrades_season_cap: input.devUpgradesSeasonCap ?? 0,
    dev_upgrades_player_cap: input.devUpgradesPlayerCap ?? 0,
    age_resets_season_cap: input.ageResetsSeasonCap ?? 0,
    player_trait_purchases_season_cap: input.playerTraitPurchasesSeasonCap ?? 0,
    contract_purchases_season_cap: input.contractPurchasesSeasonCap ?? 0,
    core_attribute_purchases_season_cap: input.coreAttributePurchasesSeasonCap ?? 0,
    core_attribute_group_cap: 0,
    non_core_attribute_purchases_season_cap: input.nonCoreAttributeCapMode === "individual" ? 0 : (input.nonCoreAttributePurchasesSeasonCap ?? 0),
    non_core_attribute_cap_mode: input.nonCoreAttributeCapMode ?? "group",
    core_attributes: input.coreAttributes ?? [],
    core_attribute_cap_overrides: input.coreAttributeCapOverrides ?? {},
    non_core_attribute_cap_overrides: input.nonCoreAttributeCapMode === "individual" ? (input.nonCoreAttributeCapOverrides ?? {}) : {},
    purchase_deadlines: input.purchaseDeadlines ?? {},

    streaming_requirement: input.regularSeasonStreamingRequirement,
    regular_season_streaming_requirement: input.regularSeasonStreamingRequirement,
    postseason_streaming_requirement: input.postseasonStreamingRequirement,
    gotw_streaming_requirement: input.gotwStreamingRequirement,
    streaming_scope: input.streamingScope,
    streaming_side: input.regularSeasonStreamingSide ?? input.streamingSide,
    regular_season_streaming_side: input.regularSeasonStreamingSide ?? input.streamingSide,
    postseason_streaming_side: input.postseasonStreamingSide ?? input.streamingSide,
    gotw_streaming_side: input.gotwStreamingSide ?? input.streamingSide,

    fourth_down_rule_type: input.fourthDownRuleTypeRegular ?? input.fourthDownRuleType,
    custom_fourth_down_rule: input.customFourthDownRuleRegular ?? input.customFourthDownRule ?? null,
    fourth_down_rule_type_regular: input.fourthDownRuleTypeRegular ?? input.fourthDownRuleType,
    fourth_down_rule_type_playoff: input.fourthDownRuleTypePlayoff ?? input.fourthDownRuleType,
    custom_fourth_down_rule_regular: input.customFourthDownRuleRegular ?? null,
    custom_fourth_down_rule_playoff: input.customFourthDownRulePlayoff ?? null,
    custom_rules: input.customRules ?? [],

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
    cpu_trades_season_cap: input.cpuTradingPolicy === "not_allowed" ? 0 : (input.cpuTradesSeasonCap ?? 0),
    cpu_free_agency_policy: "disabled",

    injury_policy: input.injuryPolicy,
    difficulty: input.difficulty,
    cfb_difficulty: input.game === "cfb_27" ? input.cfbDifficulty : null,
    trade_difficulty: input.game === "cfb_27" ? null : (input.tradeDifficulty ?? "normal"),
    free_agent_motivation_impact: input.game === "madden_26" ? (input.freeAgentMotivationImpact ?? "normal") : null,
    sliders_adjusted: input.slidersAdjusted ?? Boolean(input.sliderPresetId || Object.keys(input.sliderSettings ?? {}).length),
    slider_preset_id: input.sliderPresetId ?? null,
    slider_catalog_version: input.sliderCatalogVersion ?? LEAGUE_SLIDER_CATALOG_VERSION[input.game],
    slider_settings: resolveLeagueSliderValues(input.game, input.sliderPresetId, input.sliderSettings),
    difficulty_custom_settings: input.difficultyCustomSettings ?? null,
    coach_xp_setting: input.game === "cfb_27" ? (input.coachXpSetting ?? "casual") : null,
    quarter_length_minutes: input.quarterLengthMinutes,
    accelerated_clock_enabled: input.acceleratedClockEnabled,
    accelerated_clock_minimum_seconds: input.acceleratedClockMinimumSeconds,
    salary_cap_enabled: input.salaryCapEnabled,
    trade_deadline_enabled: input.tradeDeadlineEnabled,
    abilities_enabled: input.abilitiesEnabled,
    wear_and_tear_enabled: input.wearAndTearEnabled,
    advance_timing: input.advanceTiming ?? "24hr",
    advance_timing_other:
      (input.advanceTiming ?? "24hr") === "other" ? (input.advanceTimingOther ?? null) : null,

    coach_firing_policy: input.coachFiringPolicy,
    preorder_bonuses_enabled: input.preorderBonusesEnabled,
    coach_mode_enabled: input.coachModeEnabled,
    coach_mode_auto_pass_enabled: input.coachModeAutoPassEnabled,
    coach_mode_auto_snap_enabled: input.coachModeAutoSnapEnabled,
    coach_mode_coach_suggestions_enabled: input.coachModeCoachSuggestionsEnabled,
    coach_mode_recruit_flipping_enabled: input.game === "cfb_27" ? input.coachModeRecruitFlippingEnabled : null,
    coach_mode_auto_recruiting_enabled: input.game === "cfb_27" ? input.coachModeAutoRecruitingEnabled : null,
    coach_mode_auto_progress_players_enabled: input.game === "cfb_27" ? input.coachModeAutoProgressPlayersEnabled : null,
    coach_mode_user_auto_progression_enabled: input.game === "cfb_27" ? input.coachModeUserAutoProgressionEnabled : null,
    coach_mode_cpu_manage_budget_enabled: input.game === "cfb_27" ? input.coachModeCpuManageBudgetEnabled : null,
    coach_mode_cpu_manage_staff_enabled: input.game === "cfb_27" ? input.coachModeCpuManageStaffEnabled : null,
    coach_mode_cpu_manage_facilities_enabled: input.game === "cfb_27" ? input.coachModeCpuManageFacilitiesEnabled : null,
    ball_hawk: input.ballHawk,
    heat_seeker: input.heatSeeker,
    switch_assist: input.switchAssist,

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
    throw new ApiError(500, "We couldn't save the league configuration. Please try again.", configuration.error);
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
    throw new ApiError(500, "We couldn't link that league to the server. Please try again.", link.error);
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
    conferenceOverrides: input.game === "cfb_27" ? input.conferenceAssignments : undefined,
  });

  // Draft capital is independent of roster/template selection. Every Madden league starts
  // with the game-version-specific first three draft classes, including traded ownership.
  const maddenDraftPickSeed = input.game === "madden_26" || input.game === "madden_27"
    ? await seedMaddenDraftPicks(league.data.id, input.game)
    : null;

  // CFB 27 only: when "seed active rosters" is on, seed the league's initial rosters from the
  // active, approved baseline dataset. Runs after default teams exist — applyCfbBaselineToLeague
  // matches baseline teams to them by abbreviation, so no duplicate teams are created.
  // activeRostersEnabled (this toggle) and trackRostersEnabled (ongoing dynasty tracking —
  // recruiting/portal/progression) are independent settings; seeding must key off the former.
  let baselineSeed: Awaited<ReturnType<typeof applyCfbBaselineToLeague>> | null = null;
  if (input.game === "cfb_27" && input.activeRostersEnabled) {
    const activeDataset = await supabase
      .from("rec_cfb_roster_datasets")
      .select("id")
      .eq("game_title", "cfb_27")
      .eq("is_active", true)
      .eq("legal_review_status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeDataset.error) {
      throw new ApiError(500, "We couldn't load the active CFB baseline. Please try again.", activeDataset.error);
    }
    if (activeDataset.data) {
      baselineSeed = await applyCfbBaselineToLeague({
        league_id: league.data.id,
        dataset_id: activeDataset.data.id,
        requested_by_user_id: input.requestedByDiscordId ?? "system",
      });
    }
  }

  // Madden: leagueType drives whether/how the baseline roster gets applied.
  // - regular_rosters: real team assignments.
  // - fantasy_draft: every player starts unassigned (team_id null), forming the draft pool
  //   — see docs/madden-fantasy-draft-plan.md for the (not-yet-built) draft tracker that
  //   consumes this pool.
  // - custom_rosters: no preseed unless customRostersPreseedRequested is explicitly set
  //   (a wizard-step confirmation asked right after picking "custom rosters" — see plan
  //   doc §3), in which case it behaves exactly like regular_rosters.
  let maddenBaselineSeed: Awaited<ReturnType<typeof applyMaddenBaselineToLeague>> | null = null;
  if ((input.game === "madden_26" || input.game === "madden_27") &&
      (input.leagueType === "regular_rosters" || input.leagueType === "fantasy_draft" ||
        (input.leagueType === "custom_rosters" && input.customRostersPreseedRequested))) {
    const activeMaddenDataset = await getActiveMaddenDataset();
    if (activeMaddenDataset) {
      maddenBaselineSeed = await applyMaddenBaselineToLeague({
        league_id: league.data.id,
        dataset_id: activeMaddenDataset.id,
        fantasyDraftMode: input.leagueType === "fantasy_draft",
      });
    }
  }

  // Fantasy-draft leagues get a not_scheduled draft session alongside their unassigned pool
  // (the draft tracker's initial state — see docs/madden-fantasy-draft-plan.md §4).
  if (input.leagueType === "fantasy_draft") {
    await ensureFantasyDraftSession(league.data.id);
  }

  await upsertConferenceRules(league.data.id, input.conferenceRules);

  return {
    server: serverResult.server,
    league: league.data,
    configuration: configuration.data,
    serverLeagueLink: link.data,
    defaultTeams: defaultTeams.teams,
    defaultScheduleSeed: defaultTeams.defaultScheduleSeed,
    baselineSeed,
    maddenDraftPickSeed,
  };
}

/**
 * Site-first league creation, no Discord server required — the league lands in the same
 * "not yet connected" state the pre-existing ConnectDiscordCard flow (apps/site's My Leagues
 * list) already handles for leagues that predate Discord linking: owner_user_id set,
 * discord_bot_enabled false, no rec_server_league_links row at all. Only the minimal set of
 * fields FirstTimeSetupHome.tsx (the web hub's own minimal wizard) already treats as
 * genuinely required — name, game, and the game-appropriate roster-type flags — everything
 * else rides on rec_league_configuration's column defaults and is one Settings edit away
 * once the commissioner is ready, same as any other league.
 */
function buildConfigurationPayload(leagueId: string, input: Record<string, unknown>, isCfbGame: boolean) {
  const sliderGame = input.game === "cfb_27" || input.game === "madden_27" ? input.game : "madden_26";
  return {
    league_id: leagueId,
    league_password: input.leaguePassword ?? null,
    roster_type: input.leagueType ?? (isCfbGame ? "dynasty" : "madden_cfm"),
    dynasty_type: isCfbGame ? (input.dynastyType ?? "real") : null,
    recruiting_difficulty: isCfbGame ? (input.recruitingDifficulty ?? "normal") : null,
    active_rosters_enabled: isCfbGame ? true : null,
    track_rosters_enabled: isCfbGame ? true : null,
    transfer_portal_enabled: isCfbGame ? (input.transferPortalEnabled ?? true) : null,
    coach_carousel_enabled: isCfbGame ? (input.coachCarouselEnabled ?? true) : null,
    conference_realignment: isCfbGame ? (input.conferenceRealignment ?? "locked") : null,
    home_field_advantage_enabled: isCfbGame ? (input.homeFieldAdvantageEnabled ?? true) : null,
    stadium_pulse_enabled: isCfbGame ? (input.stadiumPulseEnabled ?? true) : null,
    team_builder_allowed: isCfbGame ? (input.teamBuilderAllowed ?? false) : null,
    player_edit_permission: isCfbGame ? (input.playerEditPermission ?? "commish_only") : null,
    manual_xp_progression_penalty_pct: isCfbGame ? (input.manualXpProgressionPenaltyPct ?? 25) : null,
    verbal_commit_influence_pct: isCfbGame ? (input.verbalCommitInfluencePct ?? 25) : null,
    user_transfer_chance_pct: isCfbGame ? (input.userTransferChancePct ?? 55) : null,
    cpu_transfer_chance_pct: isCfbGame ? (input.cpuTransferChancePct ?? 55) : null,
    transfer_portal_max_per_team: isCfbGame ? (input.transferPortalMaxPerTeam ?? 20) : null,
    minimum_play_clock_seconds: isCfbGame ? (input.minimumPlayClockSeconds ?? 15) : null,
    season_experience: isCfbGame ? (input.seasonExperience ?? "customized") : null,
    cross_play_enabled: input.crossPlayEnabled ?? true,
    required_console: input.crossPlayEnabled === false ? (input.requiredConsole ?? null) : null,
    coin_economy_enabled: input.coinEconomyEnabled ?? false,
    coin_economy_minimum_linked_users: input.coinEconomyMinimumLinkedUsers ?? 8,
    custom_players_enabled: input.customPlayersEnabled ?? false,
    legends_enabled: input.legendsEnabled ?? false,
    dev_upgrades_enabled: isCfbGame ? false : (input.devUpgradesEnabled ?? false),
    age_resets_enabled: isCfbGame ? false : (input.ageResetsEnabled ?? false),
    attribute_purchases_enabled: isCfbGame ? false : (input.attributePurchasesEnabled ?? false),
    player_trait_purchases_enabled: false,
    contract_adjustment_purchases_enabled: isCfbGame ? false : (input.contractAdjustmentPurchasesEnabled ?? false),
    media_features_enabled: input.mediaFeaturesEnabled ?? true,
    custom_players_season_cap: input.customPlayersSeasonCap ?? 0,
    legends_season_cap: input.legendsSeasonCap ?? 0,
    dev_upgrade_cap_mode: input.devUpgradeCapMode ?? "total_purchases",
    dev_upgrades_season_cap: input.devUpgradesSeasonCap ?? 0,
    dev_upgrades_player_cap: input.devUpgradesPlayerCap ?? 0,
    age_resets_season_cap: input.ageResetsSeasonCap ?? 0,
    player_trait_purchases_season_cap: input.playerTraitPurchasesSeasonCap ?? 0,
    contract_purchases_season_cap: input.contractPurchasesSeasonCap ?? 0,
    core_attribute_purchases_season_cap: input.coreAttributePurchasesSeasonCap ?? 0,
    core_attribute_group_cap: 0,
    non_core_attribute_purchases_season_cap: input.nonCoreAttributeCapMode === "individual" ? 0 : (input.nonCoreAttributePurchasesSeasonCap ?? 0),
    non_core_attribute_cap_mode: input.nonCoreAttributeCapMode ?? "group",
    core_attributes: input.coreAttributes ?? [],
    core_attribute_cap_overrides: input.coreAttributeCapOverrides ?? {},
    non_core_attribute_cap_overrides: input.nonCoreAttributeCapMode === "individual" ? (input.nonCoreAttributeCapOverrides ?? {}) : {},
    purchase_deadlines: input.purchaseDeadlines ?? {},
    streaming_requirement: input.regularSeasonStreamingRequirement ?? "recommended",
    regular_season_streaming_requirement: input.regularSeasonStreamingRequirement ?? "recommended",
    postseason_streaming_requirement: input.postseasonStreamingRequirement ?? "required",
    gotw_streaming_requirement: input.gotwStreamingRequirement ?? "recommended",
    streaming_scope: input.streamingScope ?? "every_game",
    streaming_side: input.regularSeasonStreamingSide ?? "either",
    regular_season_streaming_side: input.regularSeasonStreamingSide ?? "either",
    postseason_streaming_side: input.postseasonStreamingSide ?? "either",
    gotw_streaming_side: input.gotwStreamingSide ?? "either",
    fourth_down_rule_type: input.fourthDownRuleTypeRegular ?? "standard_rec",
    custom_fourth_down_rule: input.customFourthDownRuleRegular ?? null,
    fourth_down_rule_type_regular: input.fourthDownRuleTypeRegular ?? "standard_rec",
    fourth_down_rule_type_playoff: input.fourthDownRuleTypePlayoff ?? "standard_rec",
    custom_fourth_down_rule_regular: input.customFourthDownRuleRegular ?? null,
    custom_fourth_down_rule_playoff: input.customFourthDownRulePlayoff ?? null,
    custom_rules: input.customRules ?? [],
    position_change_policy: input.positionChangePolicy ?? "restricted",
    position_change_policy_description: input.positionChangePolicyDescription ?? "Position changes must remain realistic. Major body-type changes are prohibited unless approved by commissioners.",
    custom_coaches_required: input.customCoachesRequired ?? false,
    custom_playbooks_allowed: input.customPlaybooksAllowed ?? false,
    coach_abilities_restricted: input.coachAbilitiesRestricted ?? false,
    coach_abilities_restriction_notes: input.coachAbilitiesRestrictionNotes ?? null,
    trade_approval_policy: input.tradeApprovalPolicy ?? "competition_committee_review",
    cpu_trading_policy: input.cpuTradingPolicy ?? "allowed",
    cpu_trading_allowed: input.cpuTradingPolicy ? input.cpuTradingPolicy === "allowed" : (input.cpuTradingAllowed ?? true),
    cpu_trading_restriction: input.cpuTradingRestriction ?? null,
    cpu_trades_season_cap: input.cpuTradingPolicy === "not_allowed" ? 0 : (input.cpuTradesSeasonCap ?? 0),
    cpu_free_agency_policy: "disabled",
    injury_policy: input.injuryPolicy ?? "on_standard",
    difficulty: isCfbGame ? null : (input.difficulty ?? "all_madden"),
    cfb_difficulty: isCfbGame ? (input.cfbDifficulty ?? "heisman") : null,
    trade_difficulty: isCfbGame ? null : (input.tradeDifficulty ?? "normal"),
    free_agent_motivation_impact: input.game === "madden_26" ? (input.freeAgentMotivationImpact ?? "normal") : null,
    sliders_adjusted: input.slidersAdjusted ?? Boolean(input.sliderPresetId || Object.keys(input.sliderSettings ?? {}).length),
    slider_preset_id: input.sliderPresetId ?? null,
    slider_catalog_version: input.sliderCatalogVersion ?? LEAGUE_SLIDER_CATALOG_VERSION[sliderGame],
    slider_settings: resolveLeagueSliderValues(
      sliderGame,
      typeof input.sliderPresetId === "string" ? input.sliderPresetId : null,
      input.sliderSettings && typeof input.sliderSettings === "object" ? input.sliderSettings as Record<string, number> : {},
    ),
    difficulty_custom_settings: input.difficultyCustomSettings ?? null,
    coach_xp_setting: isCfbGame ? (input.coachXpSetting ?? "casual") : null,
    quarter_length_minutes: input.quarterLengthMinutes ?? 8,
    accelerated_clock_enabled: input.acceleratedClockEnabled ?? true,
    accelerated_clock_minimum_seconds: input.acceleratedClockMinimumSeconds ?? 20,
    salary_cap_enabled: input.salaryCapEnabled ?? false,
    trade_deadline_enabled: input.tradeDeadlineEnabled ?? false,
    abilities_enabled: input.abilitiesEnabled ?? true,
    wear_and_tear_enabled: input.wearAndTearEnabled ?? true,
    advance_timing: input.advanceTiming ?? "24hr",
    advance_timing_other: (input.advanceTiming ?? "24hr") === "other" ? (input.advanceTimingOther ?? null) : null,
    coach_firing_policy: input.coachFiringPolicy ?? "on",
    preorder_bonuses_enabled: input.preorderBonusesEnabled ?? true,
    coach_mode_enabled: input.coachModeEnabled ?? false,
    coach_mode_auto_pass_enabled: input.coachModeAutoPassEnabled ?? false,
    coach_mode_auto_snap_enabled: input.coachModeAutoSnapEnabled ?? false,
    coach_mode_coach_suggestions_enabled: input.coachModeCoachSuggestionsEnabled ?? false,
    coach_mode_recruit_flipping_enabled: isCfbGame ? (input.coachModeRecruitFlippingEnabled ?? false) : null,
    coach_mode_auto_recruiting_enabled: isCfbGame ? (input.coachModeAutoRecruitingEnabled ?? false) : null,
    coach_mode_auto_progress_players_enabled: isCfbGame ? (input.coachModeAutoProgressPlayersEnabled ?? false) : null,
    coach_mode_user_auto_progression_enabled: isCfbGame ? (input.coachModeUserAutoProgressionEnabled ?? false) : null,
    coach_mode_cpu_manage_budget_enabled: isCfbGame ? (input.coachModeCpuManageBudgetEnabled ?? false) : null,
    coach_mode_cpu_manage_staff_enabled: isCfbGame ? (input.coachModeCpuManageStaffEnabled ?? false) : null,
    coach_mode_cpu_manage_facilities_enabled: isCfbGame ? (input.coachModeCpuManageFacilitiesEnabled ?? false) : null,
    ball_hawk: input.ballHawk ?? "keep_individual",
    heat_seeker: input.heatSeeker ?? "keep_individual",
    switch_assist: input.switchAssist ?? "keep_individual",
    offensive_play_call_limits_enabled: input.offensivePlayCallLimitsEnabled ?? false,
    offensive_play_call_limit: input.offensivePlayCallLimit ?? null,
    offensive_play_call_cooldown_enabled: input.offensivePlayCallCooldownEnabled ?? false,
    offensive_play_call_cooldown: input.offensivePlayCallCooldown ?? null,
    defensive_play_call_limits_enabled: input.defensivePlayCallLimitsEnabled ?? false,
    defensive_play_call_limit: input.defensivePlayCallLimit ?? null,
    defensive_play_call_cooldown_enabled: input.defensivePlayCallCooldownEnabled ?? false,
    defensive_play_call_cooldown: input.defensivePlayCallCooldown ?? null,
    fair_sim_requirements: input.fairSimRequirements ?? null,
    force_win_requirements: input.forceWinRequirements ?? null,
    // Madden season-1 leagues auto-seed the NFL schedule once linked to Discord (see
    // schedule.service.ts's default_schedule_seed_requested gate); CFB schedules are always
    // manual. Wizard-created leagues always start at season 1, so this can key off game alone.
    default_schedule_seed_requested: isCfbGame ? false : true,
  };
}

/**
 * Replaces a league's per-conference rule rows. Called with an empty array to clear them,
 * or left untouched when the wizard didn't customize any conferences (undefined).
 */
async function upsertConferenceRules(leagueId: string, rules: Record<string, unknown>[] | undefined) {
  if (!Array.isArray(rules)) return;
  if (rules.length === 0) {
    await supabase.from("rec_conference_rules").delete().eq("league_id", leagueId);
    return;
  }
  const rows = rules.map((rule) => ({
    league_id: leagueId,
    conference_name: String(rule.conferenceName ?? ""),
    divisions_enabled: Boolean(rule.divisionsEnabled),
    division_1_name: rule.division1Name ?? null,
    division_2_name: rule.division2Name ?? null,
    conference_games: rule.conferenceGames ?? null,
    conf_champ_game_enabled: Boolean(rule.confChampGameEnabled),
    champ_game_location: rule.champGameLocation ?? null,
    champ_game_selection_criteria: rule.champGameSelectionCriteria ?? null,
    protected_opponents_enabled: Boolean(rule.protectedOpponentsEnabled),
    protected_opponents_count: rule.protectedOpponentsCount ?? 1,
  })).filter((row) => row.conference_name);
  if (rows.length === 0) {
    await supabase.from("rec_conference_rules").delete().eq("league_id", leagueId);
    return;
  }
  await supabase.from("rec_conference_rules").delete().eq("league_id", leagueId);
  const { error } = await supabase.from("rec_conference_rules").insert(rows);
  if (error) throw new ApiError(500, "We couldn't save conference rules. Please try again.", error);
}

export async function createUnclaimedLeague(input: {
  requestedByUserId: string;
  name: string;
  game: "madden_26" | "madden_27" | "cfb_27";
  leaguePassword?: string | null;
  leagueType?: string;
  templateId?: string | null;
  initialTeamAbbreviation: string;
  maxMembers?: number;
  customRostersPreseedRequested?: boolean;
  isOnline?: boolean;
  crossPlayEnabled?: boolean;
  requiredConsole?: "ps5" | "xbox" | "pc" | null;
  activeRostersEnabled?: boolean;
  trackRostersEnabled?: boolean;
  dynastyType?: string;
  recruitingDifficulty?: string;
  transferPortalEnabled?: boolean;
  coachCarouselEnabled?: boolean;
  homeFieldAdvantageEnabled?: boolean;
  stadiumPulseEnabled?: boolean;
  conferenceRealignment?: string;
  teamBuilderAllowed?: boolean;
  playerEditPermission?: string;
  manualXpProgressionPenaltyPct?: number;
  verbalCommitInfluencePct?: number;
  userTransferChancePct?: number;
  cpuTransferChancePct?: number;
  transferPortalMaxPerTeam?: number;
  minimumPlayClockSeconds?: number;
  seasonExperience?: string;
  conferenceRules?: Array<{
    conferenceName: string;
    divisionsEnabled: boolean;
    division1Name?: string | null;
    division2Name?: string | null;
    conferenceGames: number;
    confChampGameEnabled: boolean;
    champGameLocation?: string | null;
    champGameSelectionCriteria?: string | null;
    protectedOpponentsEnabled: boolean;
    protectedOpponentsCount: number;
  }>;
  seasonNumber?: number;
  seasonStage?: string;
  currentWeek?: number;
  currentPhase?: string;
  regularSeasonStreamingRequirement?: string;
  postseasonStreamingRequirement?: string;
  gotwStreamingRequirement?: string;
  streamingScope?: string;
  regularSeasonStreamingSide?: string;
  postseasonStreamingSide?: string;
  gotwStreamingSide?: string;
  fourthDownRuleTypeRegular?: string;
  fourthDownRuleTypePlayoff?: string;
  customFourthDownRuleRegular?: string | null;
  customFourthDownRulePlayoff?: string | null;
  customRules?: Array<{ id: string; category: string; title: string; text: string; sortOrder?: number; createdAt?: string; updatedAt?: string }>;
  coinEconomyEnabled?: boolean;
  customPlayersEnabled?: boolean;
  legendsEnabled?: boolean;
  devUpgradesEnabled?: boolean;
  ageResetsEnabled?: boolean;
  attributePurchasesEnabled?: boolean;
  playerTraitPurchasesEnabled?: boolean;
  contractAdjustmentPurchasesEnabled?: boolean;
  customPlayersSeasonCap?: number;
  legendsSeasonCap?: number;
  devUpgradeCapMode?: string;
  devUpgradesSeasonCap?: number;
  devUpgradesPlayerCap?: number;
  ageResetsSeasonCap?: number;
  playerTraitPurchasesSeasonCap?: number;
  contractPurchasesSeasonCap?: number;
  coreAttributePurchasesSeasonCap?: number;
  coreAttributeGroupCap?: number;
  nonCoreAttributePurchasesSeasonCap?: number;
  nonCoreAttributeCapMode?: "group" | "individual";
  coreAttributes?: string[];
  coreAttributeCapOverrides?: Record<string, number>;
  nonCoreAttributeCapOverrides?: Record<string, number>;
  purchaseDeadlines?: Record<string, { stage: string; week: number }>;
  customCoachesRequired?: boolean;
  customPlaybooksAllowed?: boolean;
  coachAbilitiesRestricted?: boolean;
  coachAbilitiesRestrictionNotes?: string | null;
  positionChangePolicy?: string;
  positionChangePolicyDescription?: string | null;
  tradeApprovalPolicy?: string;
  cpuTradingPolicy?: string;
  cpuTradingRestriction?: string | null;
  cpuTradesSeasonCap?: number;
  injuryPolicy?: string;
  difficulty?: string;
  cfbDifficulty?: string;
  slidersAdjusted?: boolean;
  difficultyCustomSettings?: string | null;
  coachXpSetting?: string | null;
  quarterLengthMinutes?: number;
  acceleratedClockEnabled?: boolean;
  acceleratedClockMinimumSeconds?: number;
  salaryCapEnabled?: boolean;
  tradeDeadlineEnabled?: boolean;
  abilitiesEnabled?: boolean;
  wearAndTearEnabled?: boolean;
  advanceTiming?: string;
  advanceTimingOther?: string | null;
  coachFiringPolicy?: string;
  preorderBonusesEnabled?: boolean;
  coachModeEnabled?: boolean;
  coachModeAutoPassEnabled?: boolean;
  coachModeAutoSnapEnabled?: boolean;
  coachModeCoachSuggestionsEnabled?: boolean;
  coachModeRecruitFlippingEnabled?: boolean;
  coachModeAutoRecruitingEnabled?: boolean;
  coachModeAutoProgressPlayersEnabled?: boolean;
  coachModeUserAutoProgressionEnabled?: boolean;
  coachModeCpuManageBudgetEnabled?: boolean;
  coachModeCpuManageStaffEnabled?: boolean;
  coachModeCpuManageFacilitiesEnabled?: boolean;
  ballHawk?: string;
  heatSeeker?: string;
  switchAssist?: string;
  offensivePlayCallLimitsEnabled?: boolean;
  offensivePlayCallLimit?: number | null;
  offensivePlayCallCooldownEnabled?: boolean;
  offensivePlayCallCooldown?: number | null;
  defensivePlayCallLimitsEnabled?: boolean;
  defensivePlayCallLimit?: number | null;
  defensivePlayCallCooldownEnabled?: boolean;
  defensivePlayCallCooldown?: number | null;
  fairSimRequirements?: string | null;
  forceWinRequirements?: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "Enter a league name.");
  await assertCanCreateLeague(input.requestedByUserId, input.game);

  const isCfbGame = input.game === "cfb_27";
  if (input.templateId && !getLeagueTemplatePreset(input.game, input.templateId as LeagueTemplateId)) {
    throw new ApiError(400, "That template is not available for the selected game.");
  }
  const leagueType = input.leagueType ?? (isCfbGame ? "dynasty" : "madden_cfm");
  const seasonNumber = input.seasonNumber ?? 1;

  const leagueFields = {
    name,
    game: input.game,
    league_type: leagueType,
    owner_user_id: input.requestedByUserId,
    discord_bot_enabled: false,
    current_phase: input.currentPhase ?? (seasonNumber > 1 ? "regular_season" : "preseason"),
    season_stage: input.seasonStage ?? (isCfbGame ? "preseason" : "preseason_training_camp"),
    season_number: seasonNumber,
    current_week: input.currentWeek ?? 1,
    trust_mode: "manual",
    fantasy_draft_status: leagueType === "fantasy_draft" ? "pending" : "not_applicable",
    is_online: input.isOnline ?? true,
    advertisement_eligible: input.isOnline ?? true,
    max_members: input.maxMembers ?? 32,
    template_id: input.templateId ?? null,
  };

  const league = await supabase.from("rec_leagues").insert(leagueFields).select("*").single();
  if (league.error) throw new ApiError(500, "We couldn't create that league. Please try again.", league.error);

  // Everything below writes rows keyed to this league. The Supabase JS client can't wrap
  // these in one DB transaction, so on any failure in the required (non-fatal-catch) steps we
  // roll back via rec_delete_league instead of leaving a half-configured league behind for the
  // commissioner to find (and instead of leaving them unable to retry without hitting a
  // duplicate — see CreateLeagueWizard.finishWizard, which only reuses an id it got back here).
  try {
    const configurationPayload = buildConfigurationPayload(league.data.id, input, isCfbGame);
    const configuration = await supabase.from("rec_league_configuration").upsert(configurationPayload, { onConflict: "league_id" }).select("*").single();
    if (configuration.error) throw new ApiError(500, "We couldn't save league configuration. Please try again.", configuration.error);

    await upsertConferenceRules(league.data.id, input.conferenceRules);

    const defaultTeams = await createDefaultTeamsForLeague(league.data.id, input.game);

    if (input.game === "madden_26" || input.game === "madden_27") {
      await seedMaddenDraftPicks(league.data.id, input.game);
    }

    const initialTeam = defaultTeams.teams.find((team) =>
      String(team.abbreviation).toUpperCase() === input.initialTeamAbbreviation.trim().toUpperCase());
    if (!initialTeam) throw new ApiError(400, "The selected team is not available for this game.");

    const membership = await supabase.from("rec_league_memberships").upsert(
      { league_id: league.data.id, user_id: input.requestedByUserId, status: "active", role: "commissioner" },
      { onConflict: "league_id,user_id" },
    );
    if (membership.error) throw new ApiError(500, "We couldn't create the commissioner membership. Please try again.", membership.error);

    const assignment = await supabase.from("rec_team_assignments").insert({
      league_id: league.data.id,
      team_id: initialTeam.id,
      user_id: input.requestedByUserId,
      assignment_status: "active",
      source: "manual_admin_entry",
      notes: "Authority: commissioner; assigned atomically during league creation",
    }).select("*").single();
    if (assignment.error) throw new ApiError(500, "We couldn't assign the commissioner's team. Please try again.", assignment.error);

    // Same Madden baseline-roster logic as createLeagueForServer (Discord-first flow) — see
    // that function's comment above its own applyMaddenBaselineToLeague call for the full
    // leagueType decision table.
    if ((input.game === "madden_26" || input.game === "madden_27") &&
        (input.leagueType === "regular_rosters" || input.leagueType === "fantasy_draft" ||
          (input.leagueType === "custom_rosters" && input.customRostersPreseedRequested))) {
      const activeMaddenDataset = await getActiveMaddenDataset();
      if (activeMaddenDataset) {
        // Non-fatal (a roster-seed hiccup shouldn't block league creation), but retried once
        // and — if it still fails — written to the audit log instead of only ever existing as
        // a Railway console line nobody's watching. Without this a league can silently end up
        // with zero pool players and no visible sign anything went wrong.
        await applyMaddenBaselineToLeague({
          league_id: league.data.id,
          dataset_id: activeMaddenDataset.id,
          fantasyDraftMode: input.leagueType === "fantasy_draft",
        }).catch(async (err) => {
          console.error("[ERROR] Failed to apply Madden baseline roster to new league, retrying once:", err);
          try {
            await applyMaddenBaselineToLeague({
              league_id: league.data.id,
              dataset_id: activeMaddenDataset.id,
              fantasyDraftMode: input.leagueType === "fantasy_draft",
            });
          } catch (retryErr) {
            console.error("[ERROR] Failed to apply Madden baseline roster again after retry:", retryErr);
            await bestEffort("audit.madden_baseline_seed_failed", () => writeAuditLog({
              action: "league.madden_baseline_seed_failed",
              entityType: "rec_leagues",
              entityId: league.data.id,
              reason: retryErr instanceof Error ? retryErr.message : String(retryErr),
              newValue: { game: input.game, leagueType: input.leagueType },
            }), { leagueId: league.data.id });
          }
        });
      }
    }

    // Fantasy-draft leagues get a not_scheduled draft session alongside their unassigned pool.
    if (input.leagueType === "fantasy_draft") {
      await ensureFantasyDraftSession(league.data.id).catch((err) => {
        console.error("[ERROR] Failed to create fantasy draft session for new league (non-fatal):", err);
      });
    }

    // Madden season-1 leagues get their default NFL schedule immediately, regardless of whether
    // this league ever gets linked to Discord — Discord is an optional add-on, not a
    // prerequisite for core site functionality. CFB schedules are always manual (no default to
    // seed). Non-fatal: a schedule-seed hiccup shouldn't block league creation.
    if (!isCfbGame && seasonNumber === 1) {
      await seedDefaultScheduleForLeague({
        leagueId: league.data.id,
        game: input.game,
        seasonNumber: 1,
      }).catch((err) => {
        console.error("[ERROR] Failed to seed default schedule for new league (non-fatal):", err);
      });
    }

    await writeAuditLog({
      action: "league.created_unclaimed",
      entityType: "rec_leagues",
      entityId: league.data.id,
      newValue: { league: league.data, configuration: configuration.data },
      reason: "League created from the site, before any Discord server was connected.",
      source: "manual_admin_entry",
    });

    return { league: league.data, configuration: configuration.data, defaultTeams: defaultTeams.teams, assignment: assignment.data };
  } catch (err) {
    const rollback = await supabase.rpc("rec_delete_league", { p_league_id: league.data.id });
    if (rollback.error) {
      console.error("[ERROR] Failed to roll back a partially-created league after setup failure:", rollback.error);
    }
    throw err;
  }
}

export async function updateSiteLeagueConfig(input: { requestedByUserId: string; leagueId: string; [key: string]: unknown }) {
  const league = await supabase.from("rec_leagues").select("*").eq("id", input.leagueId).maybeSingle();
  if (league.error) throw new ApiError(500, "We couldn't load that league. Please try again.", league.error);
  if (!league.data) throw new ApiError(404, "League not found.");
  if (league.data.owner_user_id !== input.requestedByUserId) throw new ApiError(403, "Only the league creator can update settings.");

  const isCfbGame = league.data.game === "cfb_27";
  input.game = league.data.game;
  const configurationPayload = buildConfigurationPayload(input.leagueId, input, isCfbGame);

  const previous = await supabase.from("rec_league_configuration").select("*").eq("league_id", input.leagueId).maybeSingle();

  const { data, error } = await supabase.from("rec_league_configuration").upsert(configurationPayload, { onConflict: "league_id" }).select("*").single();
  if (error) throw new ApiError(500, "We couldn't update the league configuration. Please try again.", error);

  await upsertConferenceRules(input.leagueId, input.conferenceRules as Record<string, unknown>[] | undefined);

  await writeAuditLog({
    action: "league.configuration.updated",
    entityType: "rec_league_configuration",
    entityId: input.leagueId,
    previousValue: previous.data ?? undefined,
    newValue: data,
    reason: "League configuration updated from site wizard.",
    source: "manual_admin_entry",
  });

  return { configuration: data };
}

export async function checkLeagueLinked(leagueId: string) {
  const link = await supabase
    .from("rec_server_league_links")
    .select("id, server_id, is_primary")
    .eq("league_id", leagueId)
    .eq("is_primary", true)
    .maybeSingle();
  if (link.error) throw new ApiError(500, "We couldn't check the league link status. Please try again.", link.error);
  if (!link.data?.server_id) return { linked: false, guildId: null, serverName: null };

  // Was a single embedded-relation select (`rec_discord_servers:server_id(guild_id, name)`)
  // — apps/api/src/lib/supabase.ts's minimal Postgres shim only resolves that shorthand when
  // the FK column name literally matches `${alias}_id`; `server_id` doesn't match
  // `rec_discord_servers_id`, so it always generated invalid SQL and threw here (every call,
  // not data-dependent — this is what "Request Team" on the recruiting board was hitting).
  const server = await supabase.from("rec_discord_servers").select("guild_id, name").eq("id", link.data.server_id).maybeSingle();
  if (server.error) throw new ApiError(500, "We couldn't check the league link status. Please try again.", server.error);
  return {
    linked: Boolean(server.data),
    guildId: server.data?.guild_id ?? null,
    serverName: server.data?.name ?? null,
  };
}

async function storeLeagueLogo(input: { leagueId: string; buffer: Buffer; contentType: string }) {
  if (input.buffer.byteLength > 5 * 1024 * 1024) throw new ApiError(400, "League logos must be 5 MB or smaller.");
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(input.contentType)) throw new ApiError(400, "League logos must be PNG, JPEG, or WebP. Animated GIFs are not accepted.");
  const extension = input.contentType === "image/jpeg" ? "jpg" : input.contentType.split("/")[1];
  const path = `${input.leagueId}/league-logo-${randomUUID()}.${extension}`;
  const stored = await supabase.storage.from("rec-media").upload(path, input.buffer, { contentType: input.contentType, cacheControl: "31536000", upsert: false });
  if (stored.error) throw new ApiError(500, "We couldn't upload the league logo. Please try again.", stored.error);
  const logoUrl = supabase.storage.from("rec-media").getPublicUrl(path).data.publicUrl;
  const updated = await supabase.from("rec_leagues").update({ logo_url: logoUrl }).eq("id", input.leagueId).select("id,logo_url").single();
  if (updated.error) {
    await supabase.storage.from("rec-media").remove([path]);
    throw new ApiError(500, "We couldn't save the league logo. Please try again.", updated.error);
  }
  return { logoUrl: updated.data.logo_url };
}

export async function uploadLeagueLogo(input: { leagueId: string; requestedByUserId: string; buffer: Buffer; contentType: string }) {
  const league = await supabase.from("rec_leagues").select("id,owner_user_id").eq("id", input.leagueId).maybeSingle();
  if (league.error) throw new ApiError(500, "We couldn't load that league. Please try again.", league.error);
  if (!league.data || league.data.owner_user_id !== input.requestedByUserId) throw new ApiError(403, "Only the league owner can change its logo.");
  return storeLeagueLogo(input);
}

export async function uploadGuildLeagueLogo(input: { guildId: string; buffer: Buffer; contentType: string }) {
  const server = await supabase.from("rec_discord_servers").select("id").eq("guild_id", input.guildId).maybeSingle();
  if (server.error || !server.data) throw new ApiError(404, "This Discord server is not linked to REC.", server.error ?? undefined);
  const link = await supabase.from("rec_server_league_links").select("league_id").eq("server_id", server.data.id).eq("is_primary", true).maybeSingle();
  if (link.error || !link.data?.league_id) throw new ApiError(404, "No league is linked to this server.", link.error ?? undefined);
  return storeLeagueLogo({ leagueId: link.data.league_id, buffer: input.buffer, contentType: input.contentType });
}

export async function completeWizard(input: {
  requestedByUserId: string;
  leagueId: string;
  teamId?: string;
  guildId?: string;
  discordId?: string;
}) {
  const league = await supabase.from("rec_leagues").select("*").eq("id", input.leagueId).maybeSingle();
  if (league.error) throw new ApiError(500, "We couldn't load that league. Please try again.", league.error);
  if (!league.data) throw new ApiError(404, "League not found.");

  // Assign team if provided
  if (input.teamId) {
    const team = await supabase.from("rec_teams").select("*").eq("id", input.teamId).eq("league_id", input.leagueId).maybeSingle();
    if (team.error || !team.data) throw new ApiError(404, "Team not found in this league.");

    // Upsert league membership as commissioner
    await supabase.from("rec_league_memberships").upsert(
      { league_id: input.leagueId, user_id: input.requestedByUserId, status: "active", role: "commissioner" },
      { onConflict: "league_id,user_id" },
    );

    // Deactivate any existing assignment for this user in this league
    await supabase.from("rec_team_assignments")
      .update({ assignment_status: "replaced", ended_at: new Date().toISOString() })
      .eq("league_id", input.leagueId)
      .eq("user_id", input.requestedByUserId)
      .is("ended_at", null);

    // Create new team assignment
    const assignment = await supabase.from("rec_team_assignments").insert({
      league_id: input.leagueId,
      team_id: input.teamId,
      user_id: input.requestedByUserId,
      assignment_status: "active",
      source: "manual_admin_entry",
      notes: "Authority: commissioner",
      discord_joined_at: new Date().toISOString(),
    }).select("*").single();
    if (assignment.error) throw new ApiError(500, "We couldn't assign that team. Please try again.", assignment.error);

    // Update Discord nickname if guild + discord ID provided
    if (input.guildId && input.discordId) {
      const teamName = team.data.name ?? team.data.abbreviation ?? "";
      const nickname = `${teamName} (Commish)`;
      const guildId = input.guildId;
      const discordId = input.discordId;
      const { setGuildMemberNickname } = await import("../../lib/discord-guild.js");
      await bestEffort("discord.set_commissioner_nickname", () => setGuildMemberNickname(guildId, discordId, nickname, "REC league wizard — head commissioner assignment"), { guildId, userId: discordId });

      // Also ensure commissioner role is granted
      const { ensureManagedRoleId, addMemberRole } = await import("../../lib/discord-guild.js");
      try {
        const roleId = await ensureManagedRoleId(guildId, "commissioner");
        await addMemberRole(guildId, discordId, roleId, "REC league wizard — head commissioner assignment");
      } catch { /* role hierarchy may block — non-fatal */ }
    }

    return { ok: true, team: team.data, assignment: assignment.data };
  }

  return { ok: true, team: null, assignment: null };
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

  const existingRoutes = await supabase
    .from("rec_server_routes")
    .select("*")
    .eq("server_id", server.data.id)
    .maybeSingle();

  if (existingRoutes.error) {
    throw new ApiError(500, "We couldn't load existing server routes. Please try again.", existingRoutes.error);
  }

  const existing = existingRoutes.data ?? {};
  const payload = {
    server_id: server.data.id,
    general_chat_channel_id: preserveWhenOmitted(input.generalChatChannelId, existing.general_chat_channel_id),
    scheduling_channel_id: preserveWhenOmitted(input.schedulingChannelId, existing.scheduling_channel_id),
    media_channel_id: preserveWhenOmitted(input.mediaChannelId, existing.media_channel_id),
    rules_channel_id: preserveWhenOmitted(input.rulesChannelId, existing.rules_channel_id),
    ...buildRoutePayload(input, existing)
  };

  const routes = existingRoutes.data
    ? await supabase
        .from("rec_server_routes")
        .update(payload)
        .eq("server_id", server.data.id)
        .select("*")
        .single()
    : await supabase
        .from("rec_server_routes")
        .insert(payload)
        .select("*")
        .single();

  if (routes.error) {
    throw new ApiError(500, "We couldn't update server routes. Please try again.", routes.error);
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

  const previous = await supabase
    .from("rec_league_configuration")
    .select("*")
    .eq("league_id", context.leagueId)
    .maybeSingle();

  const configurationPayload = {
    league_id: context.leagueId,
    league_password: input.leaguePassword ?? null,
    roster_type: input.leagueType,
    dynasty_type: input.game === "cfb_27" ? input.dynastyType : null,
    recruiting_difficulty: input.game === "cfb_27" ? input.recruitingDifficulty : null,
    active_rosters_enabled: input.game === "cfb_27" ? true : null,
    track_rosters_enabled: input.game === "cfb_27" ? true : null,
    transfer_portal_enabled: input.game === "cfb_27" ? input.transferPortalEnabled : null,
    coach_carousel_enabled: input.game === "cfb_27" ? input.coachCarouselEnabled : null,
    conference_realignment: input.game === "cfb_27" ? input.conferenceRealignment : null,
    home_field_advantage_enabled: input.game === "cfb_27" ? input.homeFieldAdvantageEnabled : null,
    stadium_pulse_enabled: input.game === "cfb_27" ? input.stadiumPulseEnabled : null,
    team_builder_allowed: input.game === "cfb_27" ? input.teamBuilderAllowed : null,
    player_edit_permission: input.game === "cfb_27" ? (input.playerEditPermission ?? "commish_only") : null,
    manual_xp_progression_penalty_pct: input.game === "cfb_27" ? (input.manualXpProgressionPenaltyPct ?? 25) : null,
    verbal_commit_influence_pct: input.game === "cfb_27" ? (input.verbalCommitInfluencePct ?? 25) : null,
    user_transfer_chance_pct: input.game === "cfb_27" ? (input.userTransferChancePct ?? 55) : null,
    cpu_transfer_chance_pct: input.game === "cfb_27" ? (input.cpuTransferChancePct ?? 55) : null,
    transfer_portal_max_per_team: input.game === "cfb_27" ? (input.transferPortalMaxPerTeam ?? 20) : null,
    minimum_play_clock_seconds: input.game === "cfb_27" ? (input.minimumPlayClockSeconds ?? 15) : null,
    season_experience: input.game === "cfb_27" ? (input.seasonExperience ?? "customized") : null,
    cross_play_enabled: input.crossPlayEnabled ?? true,
    required_console: input.crossPlayEnabled === false ? (input.requiredConsole ?? null) : null,
    coin_economy_enabled: input.coinEconomyEnabled,
    coin_economy_minimum_linked_users: input.coinEconomyMinimumLinkedUsers ?? 8,
    custom_players_enabled: input.customPlayersEnabled,
    legends_enabled: input.legendsEnabled,
    dev_upgrades_enabled: input.game === "cfb_27" ? false : input.devUpgradesEnabled,
    age_resets_enabled: input.game === "cfb_27" ? false : input.ageResetsEnabled,
    attribute_purchases_enabled: input.game === "cfb_27" ? false : input.attributePurchasesEnabled,
    player_trait_purchases_enabled: false,
    contract_adjustment_purchases_enabled: input.game === "cfb_27" ? false : input.contractAdjustmentPurchasesEnabled,
    media_features_enabled: input.mediaFeaturesEnabled,
    custom_players_season_cap: input.customPlayersSeasonCap ?? 0,
    legends_season_cap: input.legendsSeasonCap ?? 0,
    dev_upgrade_cap_mode: input.devUpgradeCapMode ?? "total_purchases",
    dev_upgrades_season_cap: input.devUpgradesSeasonCap ?? 0,
    dev_upgrades_player_cap: input.devUpgradesPlayerCap ?? 0,
    age_resets_season_cap: input.ageResetsSeasonCap ?? 0,
    player_trait_purchases_season_cap: input.playerTraitPurchasesSeasonCap ?? 0,
    contract_purchases_season_cap: input.contractPurchasesSeasonCap ?? 0,
    core_attribute_purchases_season_cap: input.coreAttributePurchasesSeasonCap ?? 0,
    core_attribute_group_cap: 0,
    non_core_attribute_purchases_season_cap: input.nonCoreAttributeCapMode === "individual" ? 0 : (input.nonCoreAttributePurchasesSeasonCap ?? 0),
    non_core_attribute_cap_mode: input.nonCoreAttributeCapMode ?? "group",
    core_attributes: input.coreAttributes ?? [],
    core_attribute_cap_overrides: input.coreAttributeCapOverrides ?? {},
    non_core_attribute_cap_overrides: input.nonCoreAttributeCapMode === "individual" ? (input.nonCoreAttributeCapOverrides ?? {}) : {},
    purchase_deadlines: input.purchaseDeadlines ?? {},
    streaming_requirement: input.regularSeasonStreamingRequirement,
    regular_season_streaming_requirement: input.regularSeasonStreamingRequirement,
    postseason_streaming_requirement: input.postseasonStreamingRequirement,
    gotw_streaming_requirement: input.gotwStreamingRequirement,
    streaming_scope: input.streamingScope,
    streaming_side: input.regularSeasonStreamingSide ?? input.streamingSide,
    regular_season_streaming_side: input.regularSeasonStreamingSide ?? input.streamingSide,
    postseason_streaming_side: input.postseasonStreamingSide ?? input.streamingSide,
    gotw_streaming_side: input.gotwStreamingSide ?? input.streamingSide,
    fourth_down_rule_type: input.fourthDownRuleTypeRegular ?? input.fourthDownRuleType,
    custom_fourth_down_rule: input.customFourthDownRuleRegular ?? input.customFourthDownRule ?? null,
    fourth_down_rule_type_regular: input.fourthDownRuleTypeRegular ?? input.fourthDownRuleType,
    fourth_down_rule_type_playoff: input.fourthDownRuleTypePlayoff ?? input.fourthDownRuleType,
    custom_fourth_down_rule_regular: input.customFourthDownRuleRegular ?? null,
    custom_fourth_down_rule_playoff: input.customFourthDownRulePlayoff ?? null,
    custom_rules: input.customRules ?? [],
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
    cpu_trades_season_cap: input.cpuTradingPolicy === "not_allowed" ? 0 : (input.cpuTradesSeasonCap ?? 0),
    cpu_free_agency_policy: "disabled",
    injury_policy: input.injuryPolicy,
    difficulty: input.difficulty,
    cfb_difficulty: input.game === "cfb_27" ? input.cfbDifficulty : null,
    trade_difficulty: input.game === "cfb_27" ? null : (input.tradeDifficulty ?? "normal"),
    free_agent_motivation_impact: input.game === "madden_26" ? (input.freeAgentMotivationImpact ?? "normal") : null,
    sliders_adjusted: input.slidersAdjusted ?? Boolean(input.sliderPresetId || Object.keys(input.sliderSettings ?? {}).length),
    slider_preset_id: input.sliderPresetId ?? null,
    slider_catalog_version: input.sliderCatalogVersion ?? LEAGUE_SLIDER_CATALOG_VERSION[input.game],
    slider_settings: resolveLeagueSliderValues(input.game, input.sliderPresetId, input.sliderSettings),
    difficulty_custom_settings: input.difficultyCustomSettings ?? null,
    coach_xp_setting: input.game === "cfb_27" ? (input.coachXpSetting ?? "casual") : null,
    quarter_length_minutes: input.quarterLengthMinutes,
    accelerated_clock_enabled: input.acceleratedClockEnabled,
    accelerated_clock_minimum_seconds: input.acceleratedClockMinimumSeconds,
    salary_cap_enabled: input.salaryCapEnabled,
    trade_deadline_enabled: input.tradeDeadlineEnabled,
    abilities_enabled: input.abilitiesEnabled,
    wear_and_tear_enabled: input.wearAndTearEnabled,
    advance_timing: input.advanceTiming ?? "24hr",
    advance_timing_other:
      (input.advanceTiming ?? "24hr") === "other" ? (input.advanceTimingOther ?? null) : null,
    coach_firing_policy: input.coachFiringPolicy,
    preorder_bonuses_enabled: input.preorderBonusesEnabled,
    coach_mode_enabled: input.coachModeEnabled,
    coach_mode_auto_pass_enabled: input.coachModeAutoPassEnabled,
    coach_mode_auto_snap_enabled: input.coachModeAutoSnapEnabled,
    coach_mode_coach_suggestions_enabled: input.coachModeCoachSuggestionsEnabled,
    coach_mode_recruit_flipping_enabled: input.game === "cfb_27" ? input.coachModeRecruitFlippingEnabled : null,
    coach_mode_auto_recruiting_enabled: input.game === "cfb_27" ? input.coachModeAutoRecruitingEnabled : null,
    coach_mode_auto_progress_players_enabled: input.game === "cfb_27" ? input.coachModeAutoProgressPlayersEnabled : null,
    coach_mode_user_auto_progression_enabled: input.game === "cfb_27" ? input.coachModeUserAutoProgressionEnabled : null,
    coach_mode_cpu_manage_budget_enabled: input.game === "cfb_27" ? input.coachModeCpuManageBudgetEnabled : null,
    coach_mode_cpu_manage_staff_enabled: input.game === "cfb_27" ? input.coachModeCpuManageStaffEnabled : null,
    coach_mode_cpu_manage_facilities_enabled: input.game === "cfb_27" ? input.coachModeCpuManageFacilitiesEnabled : null,
    ball_hawk: input.ballHawk,
    heat_seeker: input.heatSeeker,
    switch_assist: input.switchAssist,
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
  if (error) throw new ApiError(500, "We couldn't update the league configuration. Please try again.", error);

  await upsertConferenceRules(context.leagueId, input.conferenceRules);

  await writeAuditLog({
    action: "league.configuration.updated",
    entityType: "rec_league_configuration",
    entityId: context.leagueId,
    previousValue: previous.data ?? undefined,
    newValue: data,
    reason: input.requestedByDiscordId
      ? `League Setup edited through Discord Admin Panel by discord:${input.requestedByDiscordId}.`
      : "League Setup edited through Discord Admin Panel.",
    source: "manual_admin_entry"
  });

  return { configuration: data };
}

export async function getLeagueConfigAsDraft(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const [league, config, conferenceRulesResult] = await Promise.all([
    supabase.from("rec_leagues").select("name,game").eq("id", context.leagueId).single(),
    supabase.from("rec_league_configuration").select("*").eq("league_id", context.leagueId).maybeSingle(),
    supabase.from("rec_conference_rules").select("*").eq("league_id", context.leagueId)
  ]);
  if (league.error) throw new ApiError(500, "We couldn't load that league. Please try again.", league.error);
  const c = config.data ?? {};
  const r = context.routes ?? {};
  const conferenceRules = (conferenceRulesResult.data ?? []).map((row) => ({
    conferenceName: row.conference_name,
    divisionsEnabled: row.divisions_enabled,
    division1Name: row.division_1_name,
    division2Name: row.division_2_name,
    conferenceGames: row.conference_games,
    confChampGameEnabled: row.conf_champ_game_enabled,
    champGameLocation: row.champ_game_location,
    champGameSelectionCriteria: row.champ_game_selection_criteria,
    protectedOpponentsEnabled: row.protected_opponents_enabled,
    protectedOpponentsCount: row.protected_opponents_count,
  }));
  const draft = {
    leagueId: context.leagueId,
    name: league.data.name ?? "League",
    game: league.data.game ?? "madden_26",
    leaguePassword: c.league_password ?? null,
    leagueType: c.roster_type ?? "regular_rosters",
    activeRostersEnabled: c.active_rosters_enabled ?? true,
    trackRostersEnabled: c.track_rosters_enabled ?? false,
    dynastyType: c.dynasty_type ?? "real",
    recruitingDifficulty: c.recruiting_difficulty ?? "normal",
    transferPortalEnabled: c.transfer_portal_enabled ?? true,
    coachCarouselEnabled: c.coach_carousel_enabled ?? true,
    conferenceRealignment: c.conference_realignment ?? "locked",
    conferenceAssignments: {},
    crossPlayEnabled: c.cross_play_enabled ?? true,
    requiredConsole: c.required_console ?? null,
    homeFieldAdvantageEnabled: c.home_field_advantage_enabled ?? true,
    stadiumPulseEnabled: c.stadium_pulse_enabled ?? true,
    teamBuilderAllowed: c.team_builder_allowed ?? (c.dynasty_type === "mixed"),
    playerEditPermission: c.player_edit_permission ?? "commish_only",
    manualXpProgressionPenaltyPct: c.manual_xp_progression_penalty_pct ?? 25,
    verbalCommitInfluencePct: c.verbal_commit_influence_pct ?? 25,
    userTransferChancePct: c.user_transfer_chance_pct ?? 55,
    cpuTransferChancePct: c.cpu_transfer_chance_pct ?? 55,
    transferPortalMaxPerTeam: c.transfer_portal_max_per_team ?? 20,
    minimumPlayClockSeconds: c.minimum_play_clock_seconds ?? 15,
    seasonExperience: c.season_experience ?? "customized",
    conferenceRules,
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
    devUpgradeCapMode: c.dev_upgrade_cap_mode ?? "total_purchases",
    devUpgradesSeasonCap: c.dev_upgrades_season_cap ?? 0,
    devUpgradesPlayerCap: c.dev_upgrades_player_cap ?? 0,
    ageResetsSeasonCap: c.age_resets_season_cap ?? 0,
    playerTraitPurchasesSeasonCap: c.player_trait_purchases_season_cap ?? 0,
    contractPurchasesSeasonCap: c.contract_purchases_season_cap ?? 0,
    coreAttributePurchasesSeasonCap: c.core_attribute_purchases_season_cap ?? 0,
    coreAttributeGroupCap: c.core_attribute_group_cap ?? 0,
    nonCoreAttributePurchasesSeasonCap: c.non_core_attribute_purchases_season_cap ?? 0,
    nonCoreAttributeCapMode: c.non_core_attribute_cap_mode === "individual" ? "individual" : "group",
    coreAttributes: Array.isArray(c.core_attributes) ? c.core_attributes.filter((code: unknown) => typeof code === "string") : [],
    coreAttributeCapOverrides: c.core_attribute_cap_overrides && typeof c.core_attribute_cap_overrides === "object" && !Array.isArray(c.core_attribute_cap_overrides) ? c.core_attribute_cap_overrides : {},
    nonCoreAttributeCapOverrides: c.non_core_attribute_cap_overrides && typeof c.non_core_attribute_cap_overrides === "object" && !Array.isArray(c.non_core_attribute_cap_overrides) ? c.non_core_attribute_cap_overrides : {},
    purchaseDeadlines: c.purchase_deadlines && typeof c.purchase_deadlines === "object" && !Array.isArray(c.purchase_deadlines) ? c.purchase_deadlines : {},
    streamingRequirement: c.streaming_requirement ?? "recommended",
    regularSeasonStreamingRequirement: c.regular_season_streaming_requirement ?? "recommended",
    postseasonStreamingRequirement: c.postseason_streaming_requirement ?? "required",
    gotwStreamingRequirement: c.gotw_streaming_requirement ?? "recommended",
    streamingScope: c.streaming_scope ?? "every_game",
    streamingSide: c.regular_season_streaming_side ?? c.streaming_side ?? "either",
    regularSeasonStreamingSide: c.regular_season_streaming_side ?? c.streaming_side ?? "either",
    postseasonStreamingSide: c.postseason_streaming_side ?? c.streaming_side ?? "either",
    gotwStreamingSide: c.gotw_streaming_side ?? c.streaming_side ?? "either",
    fourthDownRuleTypeRegular: c.fourth_down_rule_type_regular ?? c.fourth_down_rule_type ?? "standard_rec",
    fourthDownRuleTypePlayoff: c.fourth_down_rule_type_playoff ?? c.fourth_down_rule_type ?? "standard_rec",
    customFourthDownRuleRegular: c.custom_fourth_down_rule_regular ?? c.custom_fourth_down_rule ?? "",
    customFourthDownRulePlayoff: c.custom_fourth_down_rule_playoff ?? "",
    customRules: Array.isArray(c.custom_rules) ? c.custom_rules : [],
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
    cpuTradesSeasonCap: c.cpu_trades_season_cap ?? 0,
    cpuFreeAgencyPolicy: "disabled",
    injuryPolicy: c.injury_policy ?? "on_standard",
    difficulty: c.difficulty === "custom" ? "all_madden" : (c.difficulty ?? "all_madden"),
    cfbDifficulty: c.cfb_difficulty ?? (c.difficulty === "all_pro" ? "all_american" : c.difficulty === "pro" ? "varsity" : c.difficulty === "rookie" ? "freshman" : "heisman"),
    tradeDifficulty: c.trade_difficulty ?? "normal",
    freeAgentMotivationImpact: c.free_agent_motivation_impact ?? "normal",
    slidersAdjusted: c.sliders_adjusted ?? Boolean(String(c.difficulty_custom_settings ?? "").trim()),
    sliderPresetId: c.slider_preset_id ?? null,
    sliderCatalogVersion: c.slider_catalog_version ?? null,
    sliderSettings: c.slider_settings ?? {},
    difficultyCustomSettings: c.difficulty_custom_settings ?? "",
    coachXpSetting: c.coach_xp_setting ?? "casual",
    quarterLengthMinutes: c.quarter_length_minutes ?? 8,
    acceleratedClockEnabled: c.accelerated_clock_enabled ?? true,
    acceleratedClockMinimumSeconds: c.accelerated_clock_minimum_seconds ?? 20,
    salaryCapEnabled: c.salary_cap_enabled ?? false,
    tradeDeadlineEnabled: c.trade_deadline_enabled ?? false,
    abilitiesEnabled: c.abilities_enabled ?? true,
    wearAndTearEnabled: c.wear_and_tear_enabled ?? true,
    advanceTiming: c.advance_timing ?? "24hr",
    advanceTimingOther: c.advance_timing_other ?? "",
    coachFiringPolicy: c.coach_firing_policy ?? "on",
    preorderBonusesEnabled: c.preorder_bonuses_enabled ?? true,
    coachModeEnabled: c.coach_mode_enabled ?? false,
    coachModeAutoPassEnabled: c.coach_mode_auto_pass_enabled ?? false,
    coachModeAutoSnapEnabled: c.coach_mode_auto_snap_enabled ?? false,
    coachModeCoachSuggestionsEnabled: c.coach_mode_coach_suggestions_enabled ?? false,
    coachModeRecruitFlippingEnabled: c.coach_mode_recruit_flipping_enabled ?? false,
    coachModeAutoRecruitingEnabled: c.coach_mode_auto_recruiting_enabled ?? false,
    coachModeAutoProgressPlayersEnabled: c.coach_mode_auto_progress_players_enabled ?? false,
    coachModeUserAutoProgressionEnabled: c.coach_mode_user_auto_progression_enabled ?? false,
    coachModeCpuManageBudgetEnabled: c.coach_mode_cpu_manage_budget_enabled ?? false,
    coachModeCpuManageStaffEnabled: c.coach_mode_cpu_manage_staff_enabled ?? false,
    coachModeCpuManageFacilitiesEnabled: c.coach_mode_cpu_manage_facilities_enabled ?? false,
    ballHawk: c.ball_hawk ?? "keep_individual",
    heatSeeker: c.heat_seeker ?? "keep_individual",
    switchAssist: c.switch_assist ?? "keep_individual",
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
    announcementsChannelId: r.announcements_channel_id ?? null,
    powerRankingsChannelId: r.power_rankings_channel_id ?? null,
    streamsChannelId: r.streams_channel_id ?? null,
    highlightsChannelId: r.highlights_channel_id ?? null,
    mainChatChannelId: r.main_chat_channel_id ?? null,
    weeklySubmissionsChannelId: r.weekly_submissions_channel_id ?? r.box_scores_channel_id ?? null,
    recGuideChannelId: r.rec_guide_channel_id ?? null,
    boxScoresChannelId: r.box_scores_channel_id ?? r.weekly_submissions_channel_id ?? null,
    gameChannelsCategoryId: r.game_channels_category_id ?? null,
    seedDefaultSchedule: c.default_schedule_seed_requested ?? false,
    linkTeamsAfterSetup: false,
    editMode: true
  };
  return { draft };
}

/**
 * Current conference for every team on the guild's league — used to seed the CFB conference
 * assignment editor with live data instead of the static default catalog once a league exists.
 */
export async function getLeagueTeamConferences(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const { data, error } = await supabase
    .from("rec_teams")
    .select("abbreviation,name,conference")
    .eq("league_id", context.leagueId);
  if (error) throw new ApiError(500, "We couldn't load team conferences. Please try again.", error);
  return { teams: data ?? [] };
}

/**
 * Updates a single team's conference. Used by the CFB conference-assignment editor when editing
 * an existing league (new leagues apply overrides at team-creation time instead, see
 * createDefaultTeamsForGuild's conferenceOverrides param).
 */
export async function updateTeamConference(input: { guildId: string; abbreviation: string; conference: string; requestedByDiscordId?: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const previous = await supabase
    .from("rec_teams")
    .select("id,abbreviation,conference")
    .eq("league_id", context.leagueId)
    .eq("abbreviation", input.abbreviation)
    .maybeSingle();

  const { error } = await supabase
    .from("rec_teams")
    .update({ conference: input.conference })
    .eq("league_id", context.leagueId)
    .eq("abbreviation", input.abbreviation);
  if (error) throw new ApiError(500, "We couldn't update that team conference. Please try again.", error);

  await writeAuditLog({
    action: "team.conference.updated",
    entityType: "rec_teams",
    entityId: previous.data?.id ?? input.abbreviation,
    previousValue: previous.data ?? undefined,
    newValue: { abbreviation: input.abbreviation, conference: input.conference },
    reason: input.requestedByDiscordId
      ? `Conference realignment edited through Discord Admin Panel by discord:${input.requestedByDiscordId}.`
      : "Conference realignment edited through Discord Admin Panel.",
    source: "manual_admin_entry"
  });

  return { ok: true };
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

  // Delete Cloudflare Stream assets (including POTY winners) before the DB wipe —
  // rec_delete_league cascades highlight rows but cannot reach Stream.
  const preserve = async (process: string, operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "NonErrorThrown";
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack ?? null : null;
      const detail = `${errorName}: ${errorMessage}${errorStack ? `\n${errorStack}` : ""}`;
      const incident = await supabase.from("rec_admin_incidents").insert({
        league_id: context.leagueId,
        guild_id: input.guildId,
        process,
        severity: "critical",
        status: "open",
        title: `League deletion blocked: ${process}`,
        detail,
        error_name: errorName,
        error_message: errorMessage,
        error_stack: errorStack,
        context: { leagueName, requestedByDiscordId: input.requestedByDiscordId ?? null },
      });
      if (incident.error) console.error("[ERROR] Failed to record preservation incident:", incident.error);
      throw new ApiError(500, `League deletion was stopped because ${process} failed. The league remains intact and an admin incident was created.`, error);
    }
  };
  await preserve("preserve_global_career_contributions", () => preserveGlobalContributionsBeforeLeagueDelete(context.leagueId));
  await preserve("preserve_h2h_history", () => preserveH2hHistoryBeforeLeagueDelete(context.leagueId));
  await preserve("preserve_user_league_history", () => snapshotLeagueHistory(context.leagueId, true));

  await deleteAllLeagueStreamHighlights(context.leagueId).catch((error) => {
    console.error("[ERROR] Failed to delete league Stream highlights before league wipe:", error);
  });

  // Strip every REC managed role from this guild before the league data is gone — otherwise
  // members keep whatever Commissioner/Co-Commish/Member role they held here, and a future
  // league reusing this same Discord server inherits stale, meaningless role assignments.
  const { stripAllManagedRolesForGuild } = await import("../team-ownership/team-ownership.service.js");
  await stripAllManagedRolesForGuild(input.guildId).catch((error) => {
    console.error("[ERROR] Failed to clear managed Discord roles before league deletion:", error);
  });

  // Freeze this league's contribution to each member's global record and archive any awards
  // they won here — rec_delete_league hard-deletes the source rows, so a user's history in
  // this league must travel with them before it's gone, not disappear with the league.
  const { data, error } = await supabase.rpc("rec_delete_league", { p_league_id: context.leagueId });
  if (error) throw new ApiError(500, "We couldn't delete that league data. Please try again.", error);

  await bestEffort("audit.league_data_deleted", () => writeAuditLog({
    action: "league.data.deleted",
    entityType: "rec_leagues",
    entityId: context.leagueId,
    reason: input.requestedByDiscordId ? `Deleted by discord:${input.requestedByDiscordId}` : null,
    newValue: { leagueName, result: data }
  }), { leagueId: context.leagueId, guildId: input.guildId });

  return { ok: true, leagueName, result: data };
}
