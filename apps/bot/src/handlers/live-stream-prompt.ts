import { MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { recApi } from "../lib/rec-api.js";

export const LIVE_STREAM_CUSTOM_IDS = {
  gameSelectPrefix: "rec:live:game:",
  confirmPrefix: "rec:live:ok:",
  declinePrefix: "rec:live:no:",
};

export function isLiveStreamCustomId(customId: string) {
  return customId.startsWith(LIVE_STREAM_CUSTOM_IDS.gameSelectPrefix)
    || customId.startsWith(LIVE_STREAM_CUSTOM_IDS.confirmPrefix)
    || customId.startsWith(LIVE_STREAM_CUSTOM_IDS.declinePrefix);
}

export async function handleLiveStreamInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  const customId = interaction.customId;
  try {
    if (interaction.isStringSelectMenu() && customId.startsWith(LIVE_STREAM_CUSTOM_IDS.gameSelectPrefix)) {
      const promptId = customId.slice(LIVE_STREAM_CUSTOM_IDS.gameSelectPrefix.length);
      await recApi.streamingSelectGame({
        discordId: interaction.user.id,
        promptId,
        gameId: interaction.values[0] ?? "",
      });
      return interaction.reply({
        content: "Matchup selected. Hit **Confirm** to mark yourself live for that game.",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (interaction.isButton() && customId.startsWith(LIVE_STREAM_CUSTOM_IDS.confirmPrefix)) {
      const promptId = customId.slice(LIVE_STREAM_CUSTOM_IDS.confirmPrefix.length);
      await recApi.streamingConfirm({ discordId: interaction.user.id, promptId });
      return interaction.update({
        content: "You're marked live for that matchup. If you go live on a linked platform, we'll post your stream to the game channel about 3 minutes later.",
        embeds: [],
        components: [],
      });
    }
    if (interaction.isButton() && customId.startsWith(LIVE_STREAM_CUSTOM_IDS.declinePrefix)) {
      const promptId = customId.slice(LIVE_STREAM_CUSTOM_IDS.declinePrefix.length);
      await recApi.streamingDecline({ discordId: interaction.user.id, promptId });
      return interaction.update({
        content: "Got it — this live stream will be ignored until you go offline and come back on later.",
        embeds: [],
        components: [],
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't update that live-stream prompt.";
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}
