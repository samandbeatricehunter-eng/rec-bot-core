import { z } from "zod";

export const RegisterServerSchema = z.object({
  guildId: z.string().min(1),
  name: z.string().min(1),
  setupMode: z.string().default("manual_first"),
  requestedByDiscordId: z.string().min(1).optional()
});

const streamingRequirement = z.enum(["required", "recommended", "disabled"]);

export const SeasonStageSchema = z.enum([
  "preseason_training_camp",
  "preseason",
  "week_0",
  "regular_season",
  "wild_card",
  "divisional",
  "conference_championship",
  "super_bowl",
  "bowl_season",
  "cfp_first_round",
  "cfp_quarterfinal",
  "cfp_semifinal",
  "national_championship",
  "offseason",
  "coach_hiring",
  "final_resigning",
  "free_agency",
  "draft"
]);

export const CreateLeagueSchema = z.object({
  guildId: z.string().min(1),
  name: z.string().min(1),
  leaguePassword: z.string().optional().nullable(),
  customRules: z.array(z.object({ id: z.string().min(1).max(80), category: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(4000) })).max(200).default([]),
  // Offline dynasties/franchises are excluded from league search but still count toward the
  // owner's league cap.
  isOnline: z.boolean().default(true),
  crossPlayEnabled: z.boolean().default(true),
  requiredConsole: z.enum(["ps5", "xbox", "pc"]).optional().nullable(),

  game: z.enum(["madden_26", "madden_27", "cfb_27"]).default("madden_26"),
  // How this league's game results/stats/rosters get entered. No zod default keyed on `game`
  // here — league creation picks the game-aware default (see defaultDataModeForGame in
  // setup.service.ts) when this is omitted; settings saves always send it explicitly.
  dataMode: z.enum(["import", "box_scores", "manual"]).optional(),
  leagueType: z.enum(["fantasy_draft", "regular_rosters", "custom_rosters", "rise_to_immortality"]).default("regular_rosters"),
  immortalityOffensePosition: z.enum(["QB", "HB", "WR", "TE"]).optional(),
  immortalityDefensePosition: z.enum(["CB", "FS", "SS", "MIKE"]).optional(),
  immortalityTeamPool: z.enum(["default_nfl", "custom_32"]).optional(),
  immortalityCustomTeams: z.array(z.object({
    replacesAbbreviation: z.string().trim().min(2).max(5),
    city: z.string().trim().min(1).max(40),
    nick: z.string().trim().min(1).max(40),
    abbreviation: z.string().trim().min(2).max(5),
  })).max(32).optional(),
  // Madden only, custom_rosters only: a wizard-step confirmation asked right after picking
  // "custom rosters" — "pre-seed with in-game default rosters anyway?" Defaults to false
  // (no preseed) so commissioners who want a truly blank roster get one without an extra step.
  customRostersPreseedRequested: z.boolean().default(false),
  // CFB 27 only: replaces the League Type question.
  activeRostersEnabled: z.boolean().default(true),
  // CFB 27 only: seed the league's initial rosters from the CFB baseline dataset at creation.
  trackRostersEnabled: z.boolean().default(true),

  dynastyType: z.enum(["real", "mixed"]).default("real"),
  recruitingDifficulty: z.enum(["easy", "normal", "hard"]).default("normal"),
  transferPortalEnabled: z.boolean().default(true),
  coachCarouselEnabled: z.boolean().default(true),
  homeFieldAdvantageEnabled: z.boolean().default(true),
  stadiumPulseEnabled: z.boolean().default(true),
  conferenceRealignment: z.enum(["allowed", "locked"]).default("locked"),
  // Team abbreviation -> conference override, applied when seeding default teams (CFB 27 only).
  conferenceAssignments: z.record(z.string()).default({}),
  teamBuilderAllowed: z.boolean().default(false),
  // CFB 27 only: per-conference rule overrides (division structure, conference games,
  // championship game, protected opponents). Only conferences actually customized are sent.
  playerEditPermission: z.enum(["commish_only", "any_player", "none"]).default("commish_only"),
  manualXpProgressionPenaltyPct: z.number().int().min(0).max(100).default(25),
  verbalCommitInfluencePct: z.number().int().min(0).max(100).default(25),
  userTransferChancePct: z.number().int().min(0).max(100).default(55),
  cpuTransferChancePct: z.number().int().min(0).max(100).default(55),
  transferPortalMaxPerTeam: z.number().int().min(0).max(30).default(20),
  minimumPlayClockSeconds: z.number().int().min(10).max(25).default(15),
  seasonExperience: z.enum(["full_control", "customized", "simple"]).default("customized"),
  conferenceRules: z.array(z.object({
    conferenceName: z.string().trim().min(1).max(80),
    divisionsEnabled: z.boolean(),
    division1Name: z.string().optional().nullable(),
    division2Name: z.string().optional().nullable(),
    conferenceGames: z.number().int().min(6).max(9),
    confChampGameEnabled: z.boolean(),
    champGameLocation: z.string().optional().nullable(),
    champGameSelectionCriteria: z.string().optional().nullable(),
    protectedOpponentsEnabled: z.boolean(),
    protectedOpponentsCount: z.number().int().min(1).max(10),
  })).optional(),

  seasonNumber: z.number().int().min(1).default(1),
  seasonStage: SeasonStageSchema.default("preseason_training_camp"),
  currentWeek: z.number().int().min(0).max(30).default(1),

  currentPhase: z.enum([
    "fantasy_draft",
    "preseason",
    "regular_season",
    "playoffs",
    "coach_hiring_period",
    "free_agency_stage_1",
    "free_agency_stage_2",
    "free_agency_stage_3",
    "draft",
    "offseason",
    "completed"
  ]).default("regular_season"),

  coinEconomyEnabled: z.boolean().default(false),
  coinEconomyMinimumLinkedUsers: z.number().int().min(0).max(30).default(8),
  customPlayersEnabled: z.boolean().default(false),
  legendsEnabled: z.boolean().default(false),
  devUpgradesEnabled: z.boolean().default(false),
  ageResetsEnabled: z.boolean().default(false),
  attributePurchasesEnabled: z.boolean().default(false),
  playerTraitPurchasesEnabled: z.boolean().default(false),
  contractAdjustmentPurchasesEnabled: z.boolean().default(false),
  mediaFeaturesEnabled: z.boolean().default(true),

  customPlayersSeasonCap: z.number().int().min(0).max(5).default(0),
  legendsSeasonCap: z.number().int().min(0).max(5).default(0),
  devUpgradeCapMode: z.enum(["total_purchases", "players_per_season"]).default("total_purchases"),
  devUpgradesSeasonCap: z.number().int().min(0).max(20).default(0),
  devUpgradesPlayerCap: z.number().int().min(0).max(20).default(0),
  ageResetsSeasonCap: z.number().int().min(0).max(5).default(0),
  playerTraitPurchasesSeasonCap: z.number().int().min(0).max(10).default(0),
  contractPurchasesSeasonCap: z.number().int().min(0).max(5).default(0),
  // Attribute caps are points-per-user-per-season, and every cap here is additive with the
  // others rather than either/or: a purchase must clear its own attribute's individual cap
  // (override, or the group default if it has none) AND the group's pooled total.
  // coreAttributePurchasesSeasonCap / nonCoreAttributeDefaultCap-equivalent: DEFAULT individual
  // cap applied to an attribute in that group when it has no override. *CapOverrides: per-
  // attribute individual cap that replaces the default for that one code. *GroupCap /
  // nonCoreAttributePurchasesSeasonCap: pooled TOTAL cap across every attribute in that group
  // combined. 0 means unlimited for any of these.
  coreAttributePurchasesSeasonCap: z.number().int().min(0).max(99).default(0),
  coreAttributeGroupCap: z.number().int().min(0).max(99).default(0),
  nonCoreAttributePurchasesSeasonCap: z.number().int().min(0).max(99).default(0),
  nonCoreAttributeCapMode: z.enum(["group", "individual"]).default("group"),
  coreAttributes: z.array(z.string()).default([]),
  coreAttributeCapOverrides: z.record(z.number().int().min(0).max(99)).default({}),
  nonCoreAttributeCapOverrides: z.record(z.number().int().min(0).max(99)).default({}),
  purchaseDeadlines: z.record(z.object({
    stage: z.string().trim().min(1).max(80),
    week: z.number().int().min(1).max(30),
  })).default({}),

  streamingRequirement: streamingRequirement.default("recommended"),
  regularSeasonStreamingRequirement: streamingRequirement.default("recommended"),
  postseasonStreamingRequirement: streamingRequirement.default("required"),
  gotwStreamingRequirement: streamingRequirement.default("recommended"),
  streamingScope: z.enum(["every_game", "playoffs_only"]).default("every_game"),
  streamingSide: z.enum(["home", "away", "either", "both"]).default("either"),
  regularSeasonStreamingSide: z.enum(["home", "away", "either", "both"]).default("either"),
  postseasonStreamingSide: z.enum(["home", "away", "either", "both"]).default("either"),
  gotwStreamingSide: z.enum(["home", "away", "either", "both"]).default("either"),

  fourthDownRuleType: z.enum(["none", "standard_rec", "custom"]).default("standard_rec"),
  fourthDownRuleTypeRegular: z.enum(["none", "standard_rec", "custom"]).default("standard_rec"),
  fourthDownRuleTypePlayoff: z.enum(["none", "standard_rec", "custom"]).default("standard_rec"),
  customFourthDownRule: z.string().optional().nullable(),
  customFourthDownRuleRegular: z.string().optional().nullable(),
  customFourthDownRulePlayoff: z.string().optional().nullable(),

  positionChangePolicy: z.enum(["open", "restricted", "highly_restricted"]).default("restricted"),
  positionChangePolicyDescription: z.string().optional(),

  customCoachesRequired: z.boolean().default(false),
  customPlaybooksAllowed: z.boolean().default(false),
  coachAbilitiesRestricted: z.boolean().default(false),
  coachAbilitiesRestrictionNotes: z.string().optional().nullable(),
  tradeApprovalPolicy: z.enum(["no_approval_required", "commissioner_review", "competition_committee_review"]).default("competition_committee_review"),
  cpuTradingAllowed: z.boolean().default(true),
  cpuTradingPolicy: z.enum(["allowed", "restricted", "not_allowed"]).default("allowed"),
  cpuTradingRestriction: z.string().optional().nullable(),
  cpuTradesSeasonCap: z.number().int().min(0).max(5).default(0),
  cpuFreeAgencyPolicy: z.enum(["open", "restricted", "disabled"]).default("open"),
  injuryPolicy: z.enum(["off", "on_standard", "on_reduced"]).default("on_standard"),

  difficulty: z.enum(["rookie", "pro", "all_pro", "all_madden"]).default("all_madden"),
  cfbDifficulty: z.enum(["freshman", "varsity", "all_american", "heisman"]).default("heisman"),
  // Madden only: mirrors the in-game "Trade Difficulty" league setting. Omitted/null for CFB.
  tradeDifficulty: z.enum(["very_easy", "easy", "normal", "hard", "very_hard"]).default("normal"),
  // Madden 26 only: mirrors the in-game "Free Agent Motivation Impact" league setting (the
  // setting does not exist in Madden 27). Null/omitted for everything else.
  freeAgentMotivationImpact: z.enum(["off", "normal", "high", "very_high"]).default("normal"),
  slidersAdjusted: z.boolean().default(false),
  sliderPresetId: z.string().trim().max(100).optional().nullable(),
  sliderCatalogVersion: z.string().trim().max(100).optional().nullable(),
  sliderSettings: z.record(z.number().min(0).max(300)).default({}),
  difficultyCustomSettings: z.string().optional().nullable(),
  coachXpSetting: z.enum(["casual", "career", "simulation"]).optional().nullable(),
  quarterLengthMinutes: z.number().int().min(1).max(15).default(8),
  acceleratedClockEnabled: z.boolean().default(true),
  acceleratedClockMinimumSeconds: z.number().int().min(0).max(40).default(20),
  salaryCapEnabled: z.boolean().default(false),
  tradeDeadlineEnabled: z.boolean().default(false),
  abilitiesEnabled: z.boolean().default(true),
  wearAndTearEnabled: z.boolean().default(true),

  advanceTiming: z.enum(["24hr", "48hr", "72hr", "other"]).default("24hr"),
  advanceTimingOther: z.string().max(120).optional().nullable(),

  // Franchise settings (shared across Madden and CFB).
  coachFiringPolicy: z.enum(["off", "on", "cpu_only"]).default("on"),
  preorderBonusesEnabled: z.boolean().default(true),
  coachModeEnabled: z.boolean().default(false),
  coachModeAutoPassEnabled: z.boolean().default(false),
  coachModeAutoSnapEnabled: z.boolean().default(false),
  coachModeCoachSuggestionsEnabled: z.boolean().default(false),
  // Coach Mode sub-toggles below only apply when game === "cfb_27".
  coachModeRecruitFlippingEnabled: z.boolean().default(false),
  coachModeAutoRecruitingEnabled: z.boolean().default(false),
  coachModeAutoProgressPlayersEnabled: z.boolean().default(false),
  coachModeUserAutoProgressionEnabled: z.boolean().default(false),
  coachModeCpuManageBudgetEnabled: z.boolean().default(false),
  coachModeCpuManageStaffEnabled: z.boolean().default(false),
  coachModeCpuManageFacilitiesEnabled: z.boolean().default(false),
  ballHawk: z.enum(["on", "off", "keep_individual"]).default("keep_individual"),
  heatSeeker: z.enum(["on", "off", "keep_individual"]).default("keep_individual"),
  switchAssist: z.enum(["on", "off", "keep_individual"]).default("keep_individual"),

  offensivePlayCallLimitsEnabled: z.boolean().default(false),
  offensivePlayCallLimit: z.number().int().min(1).max(50).optional().nullable(),
  offensivePlayCallCooldownEnabled: z.boolean().default(false),
  offensivePlayCallCooldown: z.number().int().min(1).max(50).optional().nullable(),

  defensivePlayCallLimitsEnabled: z.boolean().default(false),
  defensivePlayCallLimit: z.number().int().min(1).max(50).optional().nullable(),
  defensivePlayCallCooldownEnabled: z.boolean().default(false),
  defensivePlayCallCooldown: z.number().int().min(1).max(50).optional().nullable(),

  fairSimRequirements: z.string().optional().nullable(),
  forceWinRequirements: z.string().optional().nullable(),
  forceWinRulesRegular: z.array(z.string()).optional(),
  forceWinRulesPostseason: z.array(z.string()).optional(),
  fairSimRulesRegular: z.array(z.string()).optional(),
  fairSimRulesPostseason: z.array(z.string()).optional(),
  announcementsChannelId: z.string().optional().nullable(),
  mainChatChannelId: z.string().optional().nullable(),
  powerRankingsChannelId: z.string().optional().nullable(),
  streamsChannelId: z.string().optional().nullable(),
  highlightsChannelId: z.string().optional().nullable(),
  weeklySubmissionsChannelId: z.string().optional().nullable(),
  recGuideChannelId: z.string().optional().nullable(),
  gameChannelsCategoryId: z.string().optional().nullable(),
  seedDefaultSchedule: z.boolean().default(false),
  requestedByDiscordId: z.string().min(1).optional(),
  serverName: z.string().optional()
});

export const UpdateServerRoutesSchema = z.object({
  guildId: z.string().min(1),
  generalChatChannelId: z.string().optional().nullable(),
  schedulingChannelId: z.string().optional().nullable(),
  mediaChannelId: z.string().optional().nullable(),
  rulesChannelId: z.string().optional().nullable(),
  announcementsChannelId: z.string().optional().nullable(),
  mainChatChannelId: z.string().optional().nullable(),
  powerRankingsChannelId: z.string().optional().nullable(),
  streamsChannelId: z.string().optional().nullable(),
  highlightsChannelId: z.string().optional().nullable(),
  weeklySubmissionsChannelId: z.string().optional().nullable(),
  recGuideChannelId: z.string().optional().nullable(),
  gameChannelsCategoryId: z.string().optional().nullable(),
});

export const GetLeagueTeamConferencesSchema = z.object({
  guildId: z.string().min(1)
});

export const UpdateTeamConferenceSchema = z.object({
  guildId: z.string().min(1),
  abbreviation: z.string().min(1),
  conference: z.string().min(1),
  requestedByDiscordId: z.string().min(1).optional()
});

export type RegisterServerInput = z.infer<typeof RegisterServerSchema>;
export type CreateLeagueInput = z.infer<typeof CreateLeagueSchema>;
export type UpdateServerRoutesInput = z.infer<typeof UpdateServerRoutesSchema>;
export type GetLeagueTeamConferencesInput = z.infer<typeof GetLeagueTeamConferencesSchema>;
export type UpdateTeamConferenceInput = z.infer<typeof UpdateTeamConferenceSchema>;
