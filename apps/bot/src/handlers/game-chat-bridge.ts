import type { Message } from "discord.js";
import { recApi } from "../lib/rec-api.js";

// Discord -> site half of the game-chat bridge. The site -> Discord half posts through
// postDiscordChannelMessage (apps/api/src/lib/discord-guild.ts) as the bot's own user, so
// message.author.bot already filters those back out before this handler ever runs — no
// separate "just forwarded" cache needed to prevent an echo loop.
export async function handleGameChannelChatMessage(message: Message): Promise<boolean> {
  if (!message.guildId) return false;
  const content = message.content?.trim();
  if (!content) return false;
  const result = await recApi
    .ingestGameChatMessage({
      discordChannelId: message.channelId,
      discordUserId: message.author.id,
      discordMessageId: message.id,
      content,
    })
    .catch(() => null);
  return Boolean(result?.ingested);
}
