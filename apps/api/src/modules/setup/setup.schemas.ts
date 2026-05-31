import { z } from "zod";

export const RegisterServerSchema = z.object({
  guildId: z.string().min(1),
  name: z.string().min(1),
  setupMode: z.string().default("manual_first"),
  requestedByDiscordId: z.string().min(1).optional()
});

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
  draftClassFeaturesEnabled: z.boolean().default(false),
  draftClassType: z.enum(["custom", "auto_gen", "realistic", "other"]).default("auto_gen"),
  mediaFeaturesEnabled: z.boolean().default(true),
  coinEconomyEnabled: z.boolean().default(false),
  customPlayersEnabled: z.boolean().default(false),
  legendsEnabled: z.boolean().default(false),
  devUpgradesEnabled: z.boolean().default(false),
  ageResetsEnabled: z.boolean().default(false),
  trainingPackagesEnabled: z.boolean().default(false),
  contractAdjustmentPurchasesEnabled: z.boolean().default(false),
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
