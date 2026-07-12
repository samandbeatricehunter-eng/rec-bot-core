import { z } from "zod";

export const ExchangeActivityAuthSchema = z.object({
  code: z.string().min(1),
  guildId: z.string().min(1),
});
export type ExchangeActivityAuthInput = z.infer<typeof ExchangeActivityAuthSchema>;
