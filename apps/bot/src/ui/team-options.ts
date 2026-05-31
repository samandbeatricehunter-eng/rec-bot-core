import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder
} from "discord.js";
import { AFC_TEAMS, NFC_TEAMS } from "@rec/shared";
import { buildNavigationRow } from "./navigation.js";

export const TEAM_LINK_CUSTOM_IDS = {
  userTeamLinkPanel: "rec:teamlink:panel",
  authoritySelect: "rec:teamlink:authority",
  userSelect: "rec:teamlink:user",
  conferenceSelect: "rec:teamlink:conference",
  afcTeamSelect: "rec:teamlink:team:afc",
  nfcTeamSelect: "rec:teamlink:team:nfc",
  createDefaultTeams: "rec:teamlink:create_default_teams",
  viewLinked: "rec:teamlink:view_linked",
  viewOpen: "rec:teamlink:view_open"
} as const;

export function buildTeamLinkHomeRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(TEAM_LINK_CUSTOM_IDS.createDefaultTeams)
        .setLabel("Create/Refresh NFL Teams")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(TEAM_LINK_CUSTOM_IDS.viewLinked)
        .setLabel("Linked Users/Teams")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(TEAM_LINK_CUSTOM_IDS.viewOpen)
        .setLabel("Open Teams")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(TEAM_LINK_CUSTOM_IDS.userTeamLinkPanel)
        .setLabel("Link User to Team")
        .setStyle(ButtonStyle.Success)
    ),
    buildNavigationRow({ includeAdminPanel: true })
  ];
}

export function buildAuthoritySelectRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TEAM_LINK_CUSTOM_IDS.authoritySelect)
      .setPlaceholder("Select user authority level")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("Member").setValue("member"),
        new StringSelectMenuOptionBuilder().setLabel("Commissioner").setValue("commissioner"),
        new StringSelectMenuOptionBuilder().setLabel("Co-Commissioner").setValue("co_commissioner")
      )
  );
}

export function buildUserSelectRow() {
  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(TEAM_LINK_CUSTOM_IDS.userSelect)
      .setPlaceholder("Select Discord user")
      .setMinValues(1)
      .setMaxValues(1)
  );
}

export function buildConferenceSelectRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TEAM_LINK_CUSTOM_IDS.conferenceSelect)
      .setPlaceholder("Select conference")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("AFC Teams").setValue("AFC"),
        new StringSelectMenuOptionBuilder().setLabel("NFC Teams").setValue("NFC")
      )
  );
}

export function buildTeamSelectRow(conference: "AFC" | "NFC") {
  const teams = conference === "AFC" ? AFC_TEAMS : NFC_TEAMS;
  const customId = conference === "AFC" ? TEAM_LINK_CUSTOM_IDS.afcTeamSelect : TEAM_LINK_CUSTOM_IDS.nfcTeamSelect;

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`Select ${conference} team`)
      .addOptions(
        ...teams.map((team) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(team.name)
            .setValue(team.abbreviation)
        ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Custom Team")
          .setValue("CUSTOM_TEAM")
          .setDescription("Custom team replacement flow will be added next.")
      )
  );
}
