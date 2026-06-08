import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { NAV_CUSTOM_IDS } from "./navigation.js";

export const ECONOMY_ADMIN_CUSTOM_IDS = {
  panel: "rec:economy_admin:panel",
  setPendingChannel: "rec:economy_admin:set_pending_channel",
  setGameCategory: "rec:economy_admin:set_game_category",
  setCommissionerOffice: "rec:economy_admin:set_commissioner_office",
  setStreamsChannel: "rec:economy_admin:set_streams_channel",
  clearEos: "rec:economy_admin:clear_eos",
  clearEosModal: "rec:economy_admin:clear_eos_modal",
  clearReasonInput: "rec:economy_admin:clear_reason"
} as const;

export function buildEconomyAdminPanel() {
  return {
    embeds: [new EmbedBuilder().setTitle("Economy Reviews").setDescription("Configure pending purchase/payout routing and EOS review controls.")],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(ECONOMY_ADMIN_CUSTOM_IDS.setPendingChannel).setPlaceholder("Set Pending Purchases / Payouts Channel").setChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(ECONOMY_ADMIN_CUSTOM_IDS.setGameCategory).setPlaceholder("Set Game Channels Category").setChannelTypes(ChannelType.GuildCategory)
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(ECONOMY_ADMIN_CUSTOM_IDS.setCommissionerOffice).setPlaceholder("Set Commissioner Office Channel").setChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(ECONOMY_ADMIN_CUSTOM_IDS.setStreamsChannel).setPlaceholder("Set Streams Channel").setChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ECONOMY_ADMIN_CUSTOM_IDS.clearEos).setLabel("Clear Pending EOS Batch").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.adminPanel).setLabel("Back to Admin Panel").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

export function buildClearEosModal() {
  return new ModalBuilder()
    .setCustomId(ECONOMY_ADMIN_CUSTOM_IDS.clearEosModal)
    .setTitle("Clear Pending EOS Batch")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(ECONOMY_ADMIN_CUSTOM_IDS.clearReasonInput).setLabel("Reason").setStyle(TextInputStyle.Paragraph).setRequired(true)
    ));
}
