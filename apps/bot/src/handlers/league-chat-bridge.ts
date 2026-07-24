import type { Message } from "discord.js";
import { recApi } from "../lib/rec-api.js";

export async function handleLeagueChatMessage(message: Message): Promise<boolean> {
  if (!message.guildId) return false;
  const content = message.content?.trim();
  if (!content) return false;
  const result = await recApi.ingestLeagueChatMessage({
    discordChannelId: message.channelId,
    discordUserId: message.author.id,
    discordMessageId: message.id,
    content,
  }).catch(() => null);
  return Boolean(result?.ingested);
}
