import { z } from "zod";

export const MintWebSessionSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  username: z.string().min(1),
  globalName: z.string().optional().nullable(),
});
export type MintWebSessionInput = z.infer<typeof MintWebSessionSchema>;
