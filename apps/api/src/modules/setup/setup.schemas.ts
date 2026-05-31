import { z } from "zod";

export const RegisterServerSchema = z.object({
  guildId: z.string().min(1),
  name: z.string().min(1),
  setupMode: z.string().default("manual_first"),
  requestedByDiscordId: z.string().min(1).optional()
});

const streamingRequirement = z.enum(["required", "recommended", "disabled"]);

export const CreateLeagueSchema = z.object({
  guildId: z.string().min(1),
  name: z.string().min(1),

  leagueType: z.enum(["fantasy_draft", "regular_rosters", "custom_rosters"]).default("regular_rosters"),
  importMode: z.enum(["manual", "ea_import", "companion_app_export"]).default("manual"),

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
  ]).default("preseason"),
  currentWeek: z.number().int().optional(),

  coinEconomyEnabled: z.boolean().default(false),
  customPlayersEnabled: z.boolean().default(false),
  legendsEnabled: z.boolean().default(false),
  devUpgradesEnabled: z.boolean().default(false),
  ageResetsEnabled: z.boolean().default(false),
  trainingPackagesEnabled: z.boolean().default(false),
  contractAdjustmentPurchasesEnabled: z.boolean().default(false),
  capManagementAssistantEnabled: z.boolean().default(false),

  draftClassFeaturesEnabled: z.boolean().default(false),
  draftClassType: z.enum(["custom", "auto_gen", "realistic", "other"]).default("auto_gen"),
  scoutingPurchasesEnabled: z.boolean().default(false),
  mediaFeaturesEnabled: z.boolean().default(true),

  streamingRequirement: streamingRequirement.default("recommended"),
  regularSeasonStreamingRequirement: streamingRequirement.default("recommended"),
  postseasonStreamingRequirement: streamingRequirement.default("required"),
  streamingScope: z.enum(["every_game", "playoffs_only"]).default("every_game"),
  streamingSide: z.enum(["home", "away", "either", "both"]).default("either"),

  fourthDownRuleType: z.enum(["none", "standard_rec", "custom"]).default("standard_rec"),
  customFourthDownRule: z.string().optional().nullable(),

  positionChangePolicy: z.enum(["open", "restricted", "highly_restricted"]).default("restricted"),
  positionChangePolicyDescription: z.string().optional(),

  customPlaybooksAllowed: z.boolean().default(false),
  tradeApprovalPolicy: z.enum(["no_approval_required", "commissioner_review", "competition_committee_review"]).default("competition_committee_review"),
  cpuTradingAllowed: z.boolean().default(true),
  cpuFreeAgencyPolicy: z.enum(["open", "restricted", "disabled"]).default("open"),
  injuryPolicy: z.enum(["off", "on_standard", "on_reduced"]).default("on_standard"),

  difficulty: z.enum(["rookie", "pro", "all_pro", "all_madden"]).default("all_madden"),
  quarterLengthMinutes: z.number().int().min(1).max(15).default(8),
  acceleratedClockEnabled: z.boolean().default(true),
  acceleratedClockMinimumSeconds: z.number().int().min(0).max(40).default(20),
  salaryCapEnabled: z.boolean().default(false),
  tradeDeadlineEnabled: z.boolean().default(false),
  abilitiesEnabled: z.boolean().default(true),
  wearAndTearEnabled: z.boolean().default(true),

  offensivePlayCallLimitsEnabled: z.boolean().default(false),
  offensivePlayCallLimit: z.number().int().min(1).max(50).optional().nullable(),
  offensivePlayCallCooldownEnabled: z.boolean().default(false),
  offensivePlayCallCooldown: z.number().int().min(1).max(50).optional().nullable(),

  defensivePlayCallLimitsEnabled: z.boolean().default(false),
  defensivePlayCallLimit: z.number().int().min(1).max(50).optional().nullable(),
  defensivePlayCallCooldownEnabled: z.boolean().default(false),
  defensivePlayCallCooldown: z.number().int().min(1).max(50).optional().nullable(),

  requestedByDiscordId: z.string().min(1).optional()
});

export const UpdateServerRoutesSchema = z.object({
  guildId: z.string().min(1),
  generalChatChannelId: z.string().optional().nullable(),
  adminImportLogChannelId: z.string().optional().nullable(),
  schedulingChannelId: z.string().optional().nullable(),
  mediaChannelId: z.string().optional().nullable(),
  rulesChannelId: z.string().optional().nullable(),
  announcementsChannelId: z.string().optional().nullable(),
  economyChannelId: z.string().optional().nullable()
});

export type RegisterServerInput = z.infer<typeof RegisterServerSchema>;
export type CreateLeagueInput = z.infer<typeof CreateLeagueSchema>;
export type UpdateServerRoutesInput = z.infer<typeof UpdateServerRoutesSchema>;
