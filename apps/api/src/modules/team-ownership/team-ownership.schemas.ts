import { z } from "zod";
export const CreateDefaultTeamsSchema = z.object({
  guildId: z.string().min(1),
  requestedByDiscordId: z.string().optional().nullable(),
  // Team abbreviation -> conference override, applied when seeding CFB 27 default teams.
  conferenceOverrides: z.record(z.string()).optional(),
});
export const ResetDefaultTeamsSchema = z.object({ guildId: z.string().min(1), requestedByDiscordId: z.string().min(1).optional() });
export const LinkUserToTeamSchema = z.object({ guildId: z.string().min(1), discordId: z.string().min(1), teamId: z.string().uuid(), authority: z.enum(["member","commissioner","co_commissioner"]).default("member"), requestedByDiscordId: z.string().min(1).optional() });
export const CustomTeamReplacementSchema = z.object({ guildId: z.string().min(1), replacementTeamAbbreviation: z.string().min(1), customTeamName: z.string().min(1), customDisplayCity: z.string().min(1).optional(), customDisplayNick: z.string().min(1).optional(), customDisplayAbbr: z.string().min(1).optional(), requestedByDiscordId: z.string().min(1).optional() });
export const UnlinkAllTeamsSchema = z.object({ guildId: z.string().min(1), requestedByDiscordId: z.string().min(1).optional() });
export const UnlinkTeamSchema = z.object({ guildId: z.string().min(1), teamId: z.string().uuid(), requestedByDiscordId: z.string().min(1).optional() });
export type CreateDefaultTeamsInput = z.infer<typeof CreateDefaultTeamsSchema>;
export type ResetDefaultTeamsInput = z.infer<typeof ResetDefaultTeamsSchema>;
export type LinkUserToTeamInput = z.infer<typeof LinkUserToTeamSchema>;
export type CustomTeamReplacementInput = z.infer<typeof CustomTeamReplacementSchema>;
export type UnlinkAllTeamsInput = z.infer<typeof UnlinkAllTeamsSchema>;
export type UnlinkTeamInput = z.infer<typeof UnlinkTeamSchema>;
