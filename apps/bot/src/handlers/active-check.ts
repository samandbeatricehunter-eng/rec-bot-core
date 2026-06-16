import { Client, MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { ACTIVE_CHECK_CUSTOM_IDS, buildActiveCheckAnnouncement } from "../ui/active-check.js";

export async function handleStartActiveCheck(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can start an Active Check.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.createActiveCheck({ guildId: interaction.guildId, createdByDiscordId: interaction.user.id });
  if (result.alreadyOpen && result.event?.discord_channel_id && result.event?.discord_message_id) {
    await interaction.editReply(`An Active Check is already open in <#${result.event.discord_channel_id}>. It closes at ${result.deadlineDisplay?.central ?? "the configured deadline"}.`);
    return;
  }
  if (!result.channelId) {
    await interaction.editReply("No league announcements channel is configured. Set announcements during server/league setup before starting an Active Check.");
    return;
  }
  const channel = await interaction.guild.channels.fetch(result.channelId).catch(() => null);
  if (!channel || !("send" in channel)) {
    await interaction.editReply("The configured announcements channel could not be accessed.");
    return;
  }
  const sent = await (channel as any).send(buildActiveCheckAnnouncement(result.event, result.deadlineDisplay ?? {}));
  await recApi.recordActiveCheckMessage({ eventId: result.event.id, discordChannelId: result.channelId, discordMessageId: sent.id });
  await interaction.editReply(`Active Check posted in <#${result.channelId}>. It closes in 24 hours.`);
}

export async function handleActiveCheckResponse(interaction: ButtonInteraction) {
  const eventId = interaction.customId.slice(ACTIVE_CHECK_CUSTOM_IDS.activePrefix.length);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await recApi.recordActiveCheckResponse({ eventId, discordId: interaction.user.id });
  await interaction.editReply(result.recorded ? "Active Check recorded. You are marked active for this league." : result.reason ?? "Your Active Check could not be recorded.");
}

export function startActiveCheckCloseoutLoop(activeClient: Client) {
  setInterval(async () => {
    for (const guild of activeClient.guilds.cache.values()) {
      const result = await recApi.getOpenActiveChecks(guild.id).catch(() => null);
      for (const event of result?.events ?? []) {
        if (!event.closes_at || new Date(event.closes_at).getTime() > Date.now()) continue;
        const closed = await recApi.closeActiveCheck(event.id).catch(() => null);
        if (!closed?.closed) continue;
        if (closed.event?.discord_channel_id && closed.event?.discord_message_id) {
          const channel = await guild.channels.fetch(closed.event.discord_channel_id).catch(() => null) as any;
          const message = channel?.messages ? await channel.messages.fetch(closed.event.discord_message_id).catch(() => null) : null;
          await message?.edit({ components: [] }).catch(() => undefined);
        }
        if (closed.commissionerOfficeChannelId) {
          const office = await guild.channels.fetch(closed.commissionerOfficeChannelId).catch(() => null) as any;
          const missing = closed.missing ?? [];
          const lines = missing.length
            ? missing.map((user: any) => user.discord_id ? `<@${user.discord_id}>` : user.rec_users?.display_name ?? user.user_id)
            : ["All linked team users responded as active."];
          await office?.send?.(["Active Check Closed", "", "Users who did not respond:", ...lines].join("\n")).catch(() => undefined);
        }
      }
    }
  }, 300_000).unref();
}
