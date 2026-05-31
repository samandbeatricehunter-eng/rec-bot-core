import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from "discord.js";
import { AFC_TEAMS, NFC_TEAMS } from "@rec/shared";
import { buildNavigationRow } from "./navigation.js";

export const TEAM_LINK_CUSTOM_IDS = {
  userTeamLinkPanel: "rec:teamlink:panel",
  authoritySelect: "rec:teamlink:authority",
  userSelect: "rec:teamlink:user",
  userPagePrev: "rec:teamlink:user_page_prev",
  userPageNext: "rec:teamlink:user_page_next",
  conferenceSelect: "rec:teamlink:conference",
  afcTeamSelect: "rec:teamlink:team:afc",
  nfcTeamSelect: "rec:teamlink:team:nfc",
  createDefaultTeams: "rec:teamlink:create_default_teams",
  viewLinked: "rec:teamlink:view_linked",
  viewOpen: "rec:teamlink:view_open"
} as const;

export type TeamLinkUserOption = {
  discordId: string;
  label: string;
  description?: string;
};

export type TeamLinkTeamOption = {
  name: string;
  abbreviation: string;
  conference?: string | null;
};

const USER_PAGE_SIZE = 25;

export function getTeamLinkUserPageInfo(totalUsers: number, requestedPage = 0) {
  const totalPages = Math.max(1, Math.ceil(totalUsers / USER_PAGE_SIZE));
  const page = Math.min(Math.max(requestedPage, 0), totalPages - 1);

  return {
    page,
    totalPages,
    start: page * USER_PAGE_SIZE,
    end: Math.min(page * USER_PAGE_SIZE + USER_PAGE_SIZE, totalUsers)
  };
}

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

export function buildUserSelectRows(input: { users: TeamLinkUserOption[]; page?: number }) {
  const { page, totalPages, start, end } = getTeamLinkUserPageInfo(input.users.length, input.page ?? 0);
  const usersForPage = input.users.slice(start, end);
  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [];

  if (usersForPage.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.userSelect)
          .setPlaceholder(`Select unlinked user (${page + 1}/${totalPages})`)
          .addOptions(
            ...usersForPage.map((user) => {
              const option = new StringSelectMenuOptionBuilder()
                .setLabel(user.label.slice(0, 100))
                .setValue(user.discordId);

              if (user.description) {
                option.setDescription(user.description.slice(0, 100));
              }

              return option;
            })
          )
      )
    );
  }

  if (totalPages > 1) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.userPagePrev)
          .setLabel("Previous Users")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.userPageNext)
          .setLabel("Next Users")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)
      )
    );
  }

  rows.push(buildNavigationRow({ includeAdminPanel: true }));
  return rows;
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

export function buildOpenTeamSelectRow(conference: "AFC" | "NFC", openTeams: TeamLinkTeamOption[]) {
  const customId = conference === "AFC" ? TEAM_LINK_CUSTOM_IDS.afcTeamSelect : TEAM_LINK_CUSTOM_IDS.nfcTeamSelect;
  const options = openTeams
    .filter((team) => team.conference === conference)
    .sort((a, b) => a.name.localeCompare(b.name));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`Select open ${conference} team`)
      .addOptions(
        ...options.map((team) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(team.name.slice(0, 100))
            .setValue(team.abbreviation)
        ),
        new StringSelectMenuOptionBuilder()
          .setLabel("Custom Team")
          .setValue("CUSTOM_TEAM")
          .setDescription("Custom team replacement flow will be added next.")
      )
  );
}

export function buildTeamSelectRow(conference: "AFC" | "NFC") {
  const teams = conference === "AFC" ? AFC_TEAMS : NFC_TEAMS;
  return buildOpenTeamSelectRow(conference, teams);
}
