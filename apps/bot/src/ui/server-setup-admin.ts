import { ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, RoleSelectMenuBuilder } from "discord.js";
import { buildNavigationRow } from "./navigation.js";

export const SERVER_SETUP_ADMIN_CUSTOM_IDS = {
  setCommissionerOffice: "rec:server_setup:set_commissioner_office",
  setStreamsChannel: "rec:server_setup:set_streams_channel",
  setCommissionerRole: "rec:server_setup:set_commissioner_role",
  setCompCommitteeRole: "rec:server_setup:set_comp_committee_role"
} as const;

export function buildServerSetupAdminPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Server Setup")
        .setDescription([
          "Configure server-level REC routing and roles.",
          "",
          "Commissioner and Comp Committee roles live here because they apply to server management, game-channel escalations, and active-check follow-up."
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
        new ChannelSelectMenuBuilder().setCustomId(SERVER_SETUP_ADMIN_CUSTOM_IDS.setStreamsChannel).setPlaceholder("Set Streams Channel").setChannelTypes(ChannelType.GuildText)
      ),
      buildNavigationRow({ includeAdminPanel: true })
    ]
  };
}
