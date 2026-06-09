import { ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, RoleSelectMenuBuilder } from "discord.js";
import { buildNavigationRow } from "./navigation.js";

export const SERVER_SETUP_ADMIN_CUSTOM_IDS = {
  setCommissionerRole: "rec:server_setup:set_commissioner_role",
  setCompCommitteeRole: "rec:server_setup:set_comp_committee_role",
  setCommissionerOffice: "rec:server_setup:set_commissioner_office",
  setStreamsChannel: "rec:server_setup:set_streams_channel",
  setHighlightsChannel: "rec:server_setup:set_highlights_channel",
  setPendingPayoutsChannel: "rec:server_setup:set_pending_payouts_channel",
  setAnnouncementsChannel: "rec:server_setup:set_announcements_channel",
  setGameChannelsCategory: "rec:server_setup:set_game_channels_category"
} as const;

export function buildServerSetupAdminPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Server Setup")
        .setDescription([
          "Configure server-level REC routing, channels, and roles.",
          "",
          "**Roles** apply to server management, game-channel escalations, and admin access.",
          "**Channels** route announcements, game channels, streams, highlights, and pending payouts.",
          "**Categories** are parent channels for auto-created game channels."
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setCommissionerRole).setPlaceholder("Set Commissioner Role")
      ),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setCompCommitteeRole).setPlaceholder("Set Comp Committee Role")
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setCommissionerOffice).setPlaceholder("Set Commissioner Office Channel").setChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setAnnouncementsChannel).setPlaceholder("Set Announcements Channel").setChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setStreamsChannel).setPlaceholder("Set Streams Channel").setChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setHighlightsChannel).setPlaceholder("Set Highlights Channel").setChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setPendingPayoutsChannel).setPlaceholder("Set Pending Payouts Channel").setChannelTypes(ChannelType.GuildText)
      ),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setGameChannelsCategory).setPlaceholder("Set Game Channels Category").setChannelTypes(ChannelType.GuildCategory)
      ),
      buildNavigationRow({ includeAdminPanel: true })
    ]
  };
}
