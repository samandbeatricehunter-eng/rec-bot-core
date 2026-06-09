import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle
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
  viewOpen: "rec:teamlink:view_open",
  simpleConferenceSelect: "rec:teamlink:simple_conference",
  simpleAfcTeamSelect: "rec:teamlink:simple_afc",
  simpleNfcTeamSelect: "rec:teamlink:simple_nfc",
  userIdModal: "rec:teamlink:user_id_modal",
  userIdInput: "rec:teamlink:user_id_input",
  simpleUserSelect: "rec:teamlink:simple_user_select",
  clearAllLinks: "rec:teamlink:clear_all_links",
  roleSelect: "rec:teamlink:role_select"
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

export function buildSimpleTeamLinkPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Link User to Team")
        .setDescription("Select a conference to view available teams.")
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.simpleConferenceSelect)
          .setPlaceholder("Select conference")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("AFC Teams").setValue("AFC"),
            new StringSelectMenuOptionBuilder().setLabel("NFC Teams").setValue("NFC")
          )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.clearAllLinks)
          .setLabel("Clear All Links")
          .setStyle(ButtonStyle.Danger)
      ),
      buildNavigationRow({ includeAdminPanel: true })
    ]
  };
}

export function buildSimpleTeamSelectPanel(
  conference: "AFC" | "NFC",
  linkedUsers?: Map<string, { discordUsername: string; discordId: string }>
) {
  const teams = conference === "AFC" ? AFC_TEAMS : NFC_TEAMS;
  const customId = conference === "AFC" ? TEAM_LINK_CUSTOM_IDS.simpleAfcTeamSelect : TEAM_LINK_CUSTOM_IDS.simpleNfcTeamSelect;

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${conference} Teams`)
        .setDescription(`Select a team to link or unlink a user.`)
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder(`Select ${conference} team`)
          .addOptions(
            ...teams
              .filter((team) => team.conference === conference)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((team) => {
                const option = new StringSelectMenuOptionBuilder()
                  .setLabel(team.name)
                  .setValue(team.abbreviation);

                const linkedUser = linkedUsers?.get(team.abbreviation);
                if (linkedUser) {
                  option.setDescription(`Assigned to: ${linkedUser.discordUsername}`);
                } else {
                  option.setDescription("Unassigned");
                }

                return option;
              })
          )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.clearAllLinks)
          .setLabel("Clear All Links")
          .setStyle(ButtonStyle.Danger)
      ),
      buildNavigationRow({ includeAdminPanel: true })
    ]
  };
}

export function buildUserSelectionPanel(
  teamName: string,
  users: Array<{ label: string; discordId: string }>,
  page: number = 0
) {
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const startIdx = currentPage * pageSize;
  const endIdx = Math.min(startIdx + pageSize, users.length);
  const pageUsers = users.slice(startIdx, endIdx);

  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [];

  if (pageUsers.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.simpleUserSelect)
          .setPlaceholder(`Select user for ${teamName} (Page ${currentPage + 1}/${totalPages})`)
          .addOptions(
            ...pageUsers.map((user) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(user.label.slice(0, 100))
                .setValue(user.discordId)
            )
          )
      )
    );
  }

  if (totalPages > 1) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${TEAM_LINK_CUSTOM_IDS.simpleUserSelect}:prev:${page}`)
          .setLabel("Previous Users")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage <= 0),
        new ButtonBuilder()
          .setCustomId(`${TEAM_LINK_CUSTOM_IDS.simpleUserSelect}:next:${page}`)
          .setLabel("Next Users")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages - 1)
      )
    );
  }

  rows.push(buildNavigationRow({ includeAdminPanel: true }));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Link User to ${teamName}`)
        .setDescription(
          users.length > 0
            ? `Select a user to link them to ${teamName}. (Showing ${startIdx + 1}-${endIdx} of ${users.length})`
            : `No available users to link to ${teamName}.`
        )
    ],
    components: rows
  };
}

export function buildUserIdModal(teamName: string) {
  const modal = new ModalBuilder()
    .setCustomId(TEAM_LINK_CUSTOM_IDS.userIdModal)
    .setTitle(`Link User to ${teamName}`);

  const userIdInput = new TextInputBuilder()
    .setCustomId(TEAM_LINK_CUSTOM_IDS.userIdInput)
    .setLabel("Discord User ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Paste the Discord user ID (e.g., 123456789)");

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(userIdInput));
  return modal;
}

export function buildRoleSelectionPanel(
  userName: string,
  teamName: string,
  roles?: { commissioner?: string; coCommissioner?: string; member?: string }
) {
  const options = [];

  if (roles?.commissioner) {
    const [label, roleId] = roles.commissioner.includes(":")
      ? roles.commissioner.split(":")
      : ["Commissioner", ""];
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(roleId ? `commissioner:${roleId}` : "commissioner")
    );
  }

  if (roles?.coCommissioner) {
    const [label, roleId] = roles.coCommissioner.includes(":")
      ? roles.coCommissioner.split(":")
      : ["Comp. Committee", ""];
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(roleId ? `co_commissioner:${roleId}` : "co_commissioner")
    );
  }

  if (roles?.member) {
    const [label, roleId] = roles.member.includes(":")
      ? roles.member.split(":")
      : ["Member", ""];
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(roleId ? `member:${roleId}` : "member")
    );
  }

  // Fallback if no roles provided
  if (options.length === 0) {
    options.push(
      new StringSelectMenuOptionBuilder().setLabel("Member").setValue("member"),
      new StringSelectMenuOptionBuilder().setLabel("Commissioner").setValue("commissioner"),
      new StringSelectMenuOptionBuilder().setLabel("Co-Commissioner").setValue("co_commissioner")
    );
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Select User Role")
        .setDescription(`Assigning <@${userName}> to **${teamName}**.\n\nSelect their role in the league:`)
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.roleSelect)
          .setPlaceholder("Select role")
          .addOptions(...options)
      ),
      buildNavigationRow({ includeAdminPanel: true })
    ]
  };
}
