import { ActionRowBuilder, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { REC_ROUTE_CHANNELS, getRecRouteChannel } from "@rec/shared";

export const SERVER_SETUP_CUSTOM_IDS = {
  selectChannelType: "rec:server_setup:select_channel_type",
  channelIdModal: "rec:server_setup:channel_id_modal",
  channelIdInput: "rec:server_setup:channel_id_input"
} as const;

export const CHANNEL_TYPE_OPTIONS = Object.fromEntries(
  Object.entries(REC_ROUTE_CHANNELS).map(([key, config]) => [key, config.label])
) as Record<keyof typeof REC_ROUTE_CHANNELS, string>;

export function buildServerSetupPanel(note?: string) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SERVER_SETUP_CUSTOM_IDS.selectChannelType)
    .setPlaceholder("Select a channel or category to assign")
    .addOptions(
      ...Object.entries(REC_ROUTE_CHANNELS).map(([key, config]) =>
        new StringSelectMenuOptionBuilder().setLabel(config.label).setValue(key)
      )
    );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Server Setup")
        .setDescription(
          ["Select a channel or category type to assign by Discord ID.", note ? `\n${note}` : null].filter(Boolean).join("\n")
        )
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)]
  };
}

export function buildChannelIdModal(channelType: string) {
  const modal = new ModalBuilder()
    .setCustomId(SERVER_SETUP_CUSTOM_IDS.channelIdModal)
    .setTitle(`Assign ${getRecRouteChannel(channelType)?.label ?? "Channel"}`);

  const idInput = new TextInputBuilder()
    .setCustomId(SERVER_SETUP_CUSTOM_IDS.channelIdInput)
    .setLabel("Discord Channel/Category ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Paste the Discord ID (right-click channel > Copy Channel ID)");

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(idInput));
  return modal;
}
