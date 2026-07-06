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
  teamSelect: "rec:teamlink:team",
  afcTeamSelect: "rec:teamlink:team:afc",
  nfcTeamSelect: "rec:teamlink:team:nfc",
  viewLinked: "rec:teamlink:view_linked",
  viewOpen: "rec:teamlink:view_open",
  simpleConferenceSelect: "rec:teamlink:simple_conference",
  simpleTeamSelect: "rec:teamlink:simple_team",
  simpleAfcTeamSelect: "rec:teamlink:simple_afc",
  simpleNfcTeamSelect: "rec:teamlink:simple_nfc",
  leagueTeamsAddRemove: "rec:league_teams:add_remove",
  leagueTeamsEdit: "rec:league_teams:edit",
  leagueTeamsBack: "rec:league_teams:back",
  leagueTeamsEditBack: "rec:league_teams:edit_back",
  leagueTeamsConferenceSelect: "rec:league_teams:conference",
  leagueTeamsTeamSelect: "rec:league_teams:team",
  leagueTeamsEditConferenceSelect: "rec:league_teams:edit_conference",
  leagueTeamsEditTeamSelect: "rec:league_teams:edit_team",
  leagueTeamsResetDefaults: "rec:league_teams:reset_defaults",
  leagueTeamsConfirmBack: "rec:league_teams:confirm_back",
  leagueTeamsConfirmUnlink: "rec:league_teams:confirm_unlink",
  editTeamModal: "rec:league_teams:edit_team_modal",
  userIdModal: "rec:teamlink:user_id_modal",
  userIdInput: "rec:teamlink:user_id_input",
  simpleUserSelect: "rec:teamlink:simple_user_select",
  clearAllLinks: "rec:teamlink:clear_all_links",
  roleSelect: "rec:teamlink:role_select",
  customTeamNoLink: "rec:teamlink:custom_team_nolink",
  customTeamModal: "rec:teamlink:custom_team_modal",
  customTeamReplaceInput: "rec:teamlink:custom_team_replace",
  customTeamCityInput: "rec:teamlink:custom_team_city",
  customTeamNickInput: "rec:teamlink:custom_team_nick",
  customTeamAbbrInput: "rec:teamlink:custom_team_abbr"
} as const;

export type TeamLinkUserOption = {
  discordId: string;
  label: string;
  description?: string;
};

export type TeamLinkTeamOption = {
  id?: string;
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

function uniqueConferences(teams: Array<{ conference?: string | null }>) {
  const names = [...new Set(teams.map((team) => String(team.conference ?? "").trim()).filter(Boolean))];
  const order = ["NFC", "AFC", "ACC", "American", "Big Ten", "Big 12", "C-USA", "MAC", "Mountain West", "Pac-12", "SEC", "Sun Belt", "Independents", "Other"];
  return names.sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
}

export function buildConferenceSelectRow(teams: TeamLinkTeamOption[] = [...AFC_TEAMS, ...NFC_TEAMS]) {
  const conferences = uniqueConferences(teams).slice(0, 25);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TEAM_LINK_CUSTOM_IDS.conferenceSelect)
      .setPlaceholder("Select conference")
      .addOptions(
        ...conferences.map((conference) =>
          new StringSelectMenuOptionBuilder().setLabel(`${conference} Teams`.slice(0, 100)).setValue(conference)
        )
      )
  );
}

export function buildOpenTeamSelectRow(conference: string, openTeams: TeamLinkTeamOption[]) {
  const customId = conference === "AFC"
    ? TEAM_LINK_CUSTOM_IDS.afcTeamSelect
    : conference === "NFC"
      ? TEAM_LINK_CUSTOM_IDS.nfcTeamSelect
      : TEAM_LINK_CUSTOM_IDS.teamSelect;
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
            .setValue(String(team.id ?? team.abbreviation))
        ),
        ...(conference === "AFC" || conference === "NFC"
          ? [
              new StringSelectMenuOptionBuilder()
                .setLabel("Custom / Team Builder")
                .setValue("CUSTOM_TEAM")
                .setDescription("Register or update a relocated, custom, or Team Builder team.")
            ]
          : [])
      )
  );
}

export function buildTeamSelectRow(conference: string) {
  const teams = conference === "AFC" ? AFC_TEAMS : NFC_TEAMS;
  return buildOpenTeamSelectRow(conference, teams);
}

export function buildSimpleTeamLinkPanel(teams: TeamLinkTeamOption[] = [...AFC_TEAMS, ...NFC_TEAMS]) {
  const conferences = uniqueConferences(teams).slice(0, 25);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Link User to Team")
        .setDescription("Select a conference to view available teams.\n\nUse **Add / Edit Custom Team** to register or update a relocated, custom, or Team Builder team's data without linking or relinking a coach. Works for unmanned teams and already-linked teams - any existing coach link is preserved.")
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.simpleConferenceSelect)
          .setPlaceholder("Select conference")
          .addOptions(
            ...conferences.map((conference) =>
              new StringSelectMenuOptionBuilder().setLabel(`${conference} Teams`.slice(0, 100)).setValue(conference)
            )
          )
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.customTeamNoLink)
          .setLabel("Add / Edit Custom Team")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.clearAllLinks)
          .setLabel("Clear All Links")
          .setStyle(ButtonStyle.Danger)
      ),
      buildNavigationRow({ includeAdminPanel: true })
    ]
  };
}

export function buildLeagueMgmtTeamsPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Teams")
        .setDescription([
          "**Add/Remove User** - Link users to open teams or unlink assigned users from teams.",
          "**Edit Teams** - Add or edit custom/relocated teams.",
          "**Clear All Links** - Remove every user/team link in this league."
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsAddRemove).setLabel("Add/Remove User").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsEdit).setLabel("Edit Teams").setStyle(ButtonStyle.Success)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.clearAllLinks).setLabel("Clear All Links").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsBack).setLabel("Back to Menu").setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

export function buildPostSetupTeamLinkingPanel(franchiseYearOne: boolean) {
  const continueLabel = franchiseYearOne ? "Continue to Schedule Review" : "Continue to Schedule Setup";
  const skipLabel = franchiseYearOne ? "Skip Linking - Review Schedule" : "Skip Linking - Set Up Schedule";
  const footerNote = franchiseYearOne
    ? "When you are ready, review each regular-season week (18 pages)."
    : "When you are ready, enter the schedule manually or finish setup.";

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Teams")
        .setDescription([
          "**Add/Remove User** - Link users to open teams or unlink assigned users from teams.",
          "**Edit Teams** - Add or edit custom/relocated teams.",
          "",
          footerNote,
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsAddRemove).setLabel("Add/Remove User").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsEdit).setLabel("Edit Teams").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.clearAllLinks).setLabel("Clear All Links").setStyle(ButtonStyle.Danger),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("rec:league_setup:continue_schedule_review")
          .setLabel(continueLabel)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("rec:league_setup:skip_team_linking")
          .setLabel(skipLabel)
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildLeagueTeamsConferencePanel(conferences: Array<{ conference: string }>) {
  const options = [...new Set(normalizeLeagueTeamConferences(conferences).map((conf) => conf.conference).filter(Boolean))]
    .slice(0, 24)
    .map((conference) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${conference} Teams`.slice(0, 100))
        .setValue(conference)
    );
  options.push(new StringSelectMenuOptionBuilder().setLabel("Back to Teams").setValue("back_to_teams"));

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Add/Remove User")
        .setDescription("Select a conference below to view teams in that conference.")
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsConferenceSelect)
          .setPlaceholder("Select conference")
          .addOptions(options)
      )
    ]
  };
}

const DIVISION_ORDER = ["East", "North", "South", "West"];
const CONFERENCE_ORDER = ["NFC", "AFC", "ACC", "American", "Big Ten", "Big 12", "C-USA", "MAC", "Mountain West", "Pac-12", "SEC", "Sun Belt", "Independents", "Other"];
const CANONICAL_CONFERENCE_NAMES = new Map(CONFERENCE_ORDER.map((conference) => [conference.toUpperCase(), conference]));

function normalizeDivisionName(value: unknown, conference: string) {
  const cleaned = String(value ?? "Other")
    .replace(new RegExp(`^${conference}\\s+`, "i"), "")
    .replace(/^(AFC|NFC)\s+/i, "")
    .trim();
  return cleaned || "Other";
}

function normalizeLeagueTeamConferences(rawConferences: any[]) {
  const confMap = new Map<string, Map<string, any[]>>();
  for (const conference of rawConferences ?? []) {
    const rawName = String(conference.conference ?? "").trim();
    const upperName = rawName.toUpperCase();
    const confName = CANONICAL_CONFERENCE_NAMES.get(upperName) ?? (rawName || "Other");
    for (const division of conference.divisions ?? []) {
      const label = normalizeDivisionName(division.label ?? division.division, confName);
      if (!confMap.has(confName)) confMap.set(confName, new Map());
      const divMap = confMap.get(confName)!;
      if (!divMap.has(label)) divMap.set(label, []);
      divMap.get(label)!.push(...(division.teams ?? []));
    }
  }
  return [...confMap.entries()]
    .sort((a, b) => {
      const ai = CONFERENCE_ORDER.indexOf(a[0]);
      const bi = CONFERENCE_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a[0].localeCompare(b[0]);
    })
    .map(([conference, divisions]) => ({
      conference,
      divisions: [...divisions.entries()]
        .sort((a, b) => {
          const ai = DIVISION_ORDER.indexOf(a[0]);
          const bi = DIVISION_ORDER.indexOf(b[0]);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a[0].localeCompare(b[0]);
        })
        .map(([label, teams]) => ({ label, division: label, teams: [...teams].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))) }))
    }));
}

function teamRecordText(team: any) {
  return team.recordText ?? `${team.wins ?? 0}-${team.losses ?? 0}-${team.ties ?? 0}`;
}

function adminTeamLine(team: any) {
  const name = team.name ?? team.abbreviation ?? "Team";
  const label = team.linkedDiscordId ? `~~${name}~~` : name;
  const user = team.linkedDiscordId ? ` (<@${team.linkedDiscordId}>)` : "";
  return `${label} (${teamRecordText(team)})${user}`;
}

export function buildLeagueTeamsTeamSelectPanel(rawConferences: any[], conferenceName: string) {
  const conference = normalizeLeagueTeamConferences(rawConferences).find((conf) => conf.conference === conferenceName);
  const teams = (conference?.divisions ?? [])
    .flatMap((division: any) => (division.teams ?? []).map((team: any) => ({ ...team, divisionLabel: division.label ?? division.division ?? "Teams" })));
  const options = teams.slice(0, 24).map((team: any) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(String(team.name ?? team.abbreviation ?? "Team").slice(0, 100))
      .setValue(String(team.id))
      .setDescription((team.linkedDiscordId ? `Linked to ${team.linkedName ?? "user"}` : "Unlinked").slice(0, 100))
  );
  options.push(new StringSelectMenuOptionBuilder().setLabel("Back to Conferences").setValue("back_to_conferences"));

  const divisionLines = (conference?.divisions ?? []).map((division: any) => {
    const lines = (division.teams ?? []).map(adminTeamLine).join("\n") || "No teams found";
    return `**${division.label ?? division.division ?? "Teams"}**\n${lines}`;
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`${conferenceName} Teams`)
        .setDescription((divisionLines.join("\n\n") || "No teams found.").slice(0, 4096))
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsTeamSelect}:${conferenceName}`)
          .setPlaceholder(`Select ${conferenceName} team`)
          .addOptions(options)
      )
    ]
  };
}

export function buildLeagueTeamsEditPanel(rawConferences: any[], selectedConference = "AFC") {
  const conferences = normalizeLeagueTeamConferences(rawConferences);
  const selected = conferences.find((conf) => conf.conference === selectedConference) ?? conferences[0];
  const conferenceOptions = conferences.slice(0, 25).map((conference) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${conference.conference} Teams`.slice(0, 100))
      .setValue(conference.conference)
      .setDefault(conference.conference === selected?.conference)
  );
  const teams = (selected?.divisions ?? []).flatMap((division: any) => division.teams ?? []);
  const teamOptions = teams.slice(0, 25).map((team: any) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(String(team.name ?? team.abbreviation ?? "Team").slice(0, 100))
      .setValue(String(team.id))
      .setDescription(`Current abbreviation: ${team.abbreviation ?? "None"}`.slice(0, 100))
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Edit Teams")
        .setDescription("Select a conference, then choose a team to edit its abbreviation, city, and team name.")
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsEditConferenceSelect)
          .setPlaceholder("Select conference")
          .addOptions(conferenceOptions)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsResetDefaults).setLabel("Reset All Teams").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsEditBack).setLabel("Back to Teams").setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${TEAM_LINK_CUSTOM_IDS.leagueTeamsEditTeamSelect}:${selected?.conference ?? selectedConference}`)
          .setPlaceholder(`Select ${selected?.conference ?? selectedConference} team`)
          .addOptions(teamOptions.length ? teamOptions : [new StringSelectMenuOptionBuilder().setLabel("No teams found").setValue("NO_TEAMS").setDescription("Reset default teams, then try again.")])
      )
    ]
  };
}

export function buildLeagueTeamsUnlinkConfirmPanel(teamName: string, discordId: string) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Unlink User?")
        .setDescription(`<@${discordId}> is currently linked to **${teamName}**. Proceeding will unlink that user from this team.`)
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsConfirmBack).setLabel("Back to Team Select").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(TEAM_LINK_CUSTOM_IDS.leagueTeamsConfirmUnlink).setLabel("Unlink User").setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

export function buildSimpleTeamSelectPanel(
  conference: string,
  linkedUsers?: Map<string, { discordUsername: string; discordId: string }>,
  leagueTeams?: TeamLinkTeamOption[]
) {
  const teams = (leagueTeams ?? (conference === "AFC" ? AFC_TEAMS : NFC_TEAMS)).filter((team) => team.conference === conference);
  const customId = conference === "AFC"
    ? TEAM_LINK_CUSTOM_IDS.simpleAfcTeamSelect
    : conference === "NFC"
      ? TEAM_LINK_CUSTOM_IDS.simpleNfcTeamSelect
      : TEAM_LINK_CUSTOM_IDS.simpleTeamSelect;

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
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((team) => {
                const teamValue = String("id" in team && team.id ? team.id : team.abbreviation);
                const option = new StringSelectMenuOptionBuilder()
                  .setLabel(team.name)
                  .setValue(teamValue);

                const linkedUser = linkedUsers?.get(teamValue) ?? linkedUsers?.get(team.abbreviation);
                if (linkedUser) {
                  option.setDescription(`Assigned to: ${linkedUser.discordUsername}`);
                } else {
                  option.setDescription("Unassigned");
                }

                return option;
              }),
            ...(conference === "AFC" || conference === "NFC"
              ? [
                  new StringSelectMenuOptionBuilder()
                    .setLabel("Custom / Relocated Team")
                    .setValue("CUSTOM_TEAM")
                    .setDescription(`Register a custom or relocated ${conference} team`)
                ]
              : [])
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

export function buildCustomTeamModal(conference?: string, isCfb?: boolean) {
  const modal = new ModalBuilder()
    .setCustomId(`${TEAM_LINK_CUSTOM_IDS.customTeamModal}:${conference ?? "GEN"}`)
    .setTitle(conference ? `Register ${conference} Custom Team` : "Register Custom Team");

  const replaceInput = new TextInputBuilder()
    .setCustomId(TEAM_LINK_CUSTOM_IDS.customTeamReplaceInput)
    .setLabel("Existing team slot to replace")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("e.g. DAL, Alabama, Oregon");

  // CFB team identity is University Name + Team Name (e.g. "Texas Longhorns", "Alabama Crimson
  // Tide") — city/state don't matter there, unlike Madden's City + Mascot convention.
  const cityInput = new TextInputBuilder()
    .setCustomId(TEAM_LINK_CUSTOM_IDS.customTeamCityInput)
    .setLabel(isCfb ? "University name" : "New school or city")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(isCfb ? "e.g. Texas or Coastal Carolina" : "e.g. San Diego or Coastal Carolina");

  const nickInput = new TextInputBuilder()
    .setCustomId(TEAM_LINK_CUSTOM_IDS.customTeamNickInput)
    .setLabel(isCfb ? "Team name (mascot)" : "New mascot or team name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(isCfb ? "e.g. Longhorns or Chanticleers" : "e.g. Chargers or Chanticleers");

  const abbrInput = new TextInputBuilder()
    .setCustomId(TEAM_LINK_CUSTOM_IDS.customTeamAbbrInput)
    .setLabel("New team abbreviation")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(8)
    .setPlaceholder("e.g. SDC");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(replaceInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(cityInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(nickInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(abbrInput)
  );
  return modal;
}

export function buildEditTeamModal(teamName: string) {
  return new ModalBuilder()
    .setCustomId(TEAM_LINK_CUSTOM_IDS.editTeamModal)
    .setTitle(`Edit ${teamName}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.customTeamAbbrInput)
          .setLabel("New team abbreviation")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(8)
          .setPlaceholder("e.g. SDC")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.customTeamCityInput)
          .setLabel("New team city")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g. San Diego")
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(TEAM_LINK_CUSTOM_IDS.customTeamNickInput)
          .setLabel("New team name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g. Chargers")
      )
    );
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
