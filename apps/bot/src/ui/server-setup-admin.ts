import { ActionRowBuilder, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

export const SERVER_SETUP_CUSTOM_IDS = {
  selectChannelType: "rec:server_setup:select_channel_type",
  channelIdModal: "rec:server_setup:channel_id_modal",
  channelIdInput: "rec:server_setup:channel_id_input"
} as const;

export const CHANNEL_TYPE_OPTIONS = {
  commissioner_office: "Commissioner Office",
  announcements: "Announcements",
  voting_polls: "Voting Polls",
  streams: "Streams",
  highlights: "Highlights",
  pending_payouts: "Pending Payouts",
  pending_purchases: "Pending Purchases",
  game_channels_category: "Game Channels Category"
} as const;

export function buildServerSetupPanel() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SERVER_SETUP_CUSTOM_IDS.selectChannelType)
    .setPlaceholder("Select a channel or category to assign")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Commissioner Office").setValue("commissioner_office"),
      new StringSelectMenuOptionBuilder().setLabel("Announcements").setValue("announcements"),
      new StringSelectMenuOptionBuilder().setLabel("Voting Polls").setValue("voting_polls"),
      new StringSelectMenuOptionBuilder().setLabel("Streams").setValue("streams"),
      new StringSelectMenuOptionBuilder().setLabel("Highlights").setValue("highlights"),
      new StringSelectMenuOptionBuilder().setLabel("Pending Payouts").setValue("pending_payouts"),
      new StringSelectMenuOptionBuilder().setLabel("Pending Purchases").setValue("pending_purchases"),
      new StringSelectMenuOptionBuilder().setLabel("Game Channels Category").setValue("game_channels_category")
    );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Server Setup")
        .setDescription("Select a channel or category type to assign by Discord ID.")
    ],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)]
  };
}

export function buildChannelIdModal(channelType: string) {
  const modal = new ModalBuilder()
    .setCustomId(SERVER_SETUP_CUSTOM_IDS.channelIdModal)
    .setTitle(`Assign ${CHANNEL_TYPE_OPTIONS[channelType as keyof typeof CHANNEL_TYPE_OPTIONS] || "Channel"}`);

  const idInput = new TextInputBuilder()
    .setCustomId(SERVER_SETUP_CUSTOM_IDS.channelIdInput)
    .setLabel("Discord Channel/Category ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Paste the Discord ID (right-click channel > Copy Channel ID)");

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(idInput));
  return modal;
}
