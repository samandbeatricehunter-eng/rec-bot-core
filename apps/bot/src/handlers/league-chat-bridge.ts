import type { Message } from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { extractMessageImages } from "../lib/discord-message-images.js";

export async function handleLeagueChatMessage(message: Message): Promise<boolean> {
  if (!message.guildId) return false;
  const content = message.content?.trim() ?? "";
  const images = extractMessageImages(message);
  if (!content && !images.length) return false;
  const result = await recApi.ingestLeagueChatMessage({
    discordChannelId: message.channelId,
    discordUserId: message.author.id,
    discordMessageId: message.id,
    content,
    images,
  }).catch(() => null);
  return Boolean(result?.ingested);
}
