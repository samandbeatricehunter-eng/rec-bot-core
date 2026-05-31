import { ButtonInteraction, EmbedBuilder, Interaction, StringSelectMenuInteraction } from "discord.js";
import type { RecTeamAuthority } from "@rec/shared";
import { recApi } from "../lib/rec-api.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { syncMemberForTeam } from "../lib/role-sync.js";
import { buildNavigationRow } from "../ui/navigation.js";
import {
  buildAuthoritySelectRow,
  buildConferenceSelectRow,
  buildTeamLinkHomeRows,
  buildOpenTeamSelectRow,
  buildUserSelectRows,
  getTeamLinkUserPageInfo,
  TEAM_LINK_CUSTOM_IDS,
  type TeamLinkUserOption
} from "../ui/team-options.js";

export type TeamLinkDraft = {
  discordId?: string;
  authority?: RecTeamAuthority;
  conference?: "AFC" | "NFC";
  userPage: number;
};

export const teamLinkSessions = new Map<string, TeamLinkDraft>();

type CachedGuildUserList = {
  expiresAt: number;
  users: TeamLinkUserOption[];
};

const guildUserCache = new Map<string, CachedGuildUserList>();
const GUILD_USER_CACHE_MS = 5 * 60 * 1000;

export function clearTeamLinkGuildUserCache(guildId: string) {
  guildUserCache.delete(guildId);
}

export function buildTeamLinkPanelPayload(description?: string) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("User / Team Linking")
        .setDescription(
          description ??
            [
              "Manage Discord user to league team links for this server's active league.",
              "",
              "The active league is resolved automatically from this Discord server ID."
            ].join("\n")
        )
    ],
    components: buildTeamLinkHomeRows()
  };
}

function makeTeamLinkDraft(): TeamLinkDraft {
  return { userPage: 0 };
}


async function getCachedGuildUsers(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return [];

  const cached = guildUserCache.get(interaction.guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.users;
  }

  let members = interaction.guild.members.cache;

  try {
    members = await interaction.guild.members.fetch();
  } catch (error: any) {
    const stale = guildUserCache.get(interaction.guildId);
    if (stale) return stale.users;

    console.warn(
      `REC Team Linking member fetch failed for guild ${interaction.guildId}; using current cache instead.`,
      error?.message ?? error
    );
  }

  const users = [...members.values()]
    .filter((member) => !member.user.bot)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map<TeamLinkUserOption>((member) => ({
      discordId: member.id,
      label: member.displayName || member.user.username,
      description: member.user.username === member.displayName ? undefined : member.user.username
    }));

  guildUserCache.set(interaction.guildId, {
    expiresAt: Date.now() + GUILD_USER_CACHE_MS,
    users
  });

  return users;
}

async function getEligibleGuildUsers(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return [];

  const linkedResult = await recApi.getLinkedUsersTeams(interaction.guildId);
  const linkedDiscordIds = new Set(
    (linkedResult.linked ?? [])
      .map((row: any) => row.discordId)
      .filter((discordId: unknown): discordId is string => typeof discordId === "string" && discordId.length > 0)
  );

  const guildUsers = await getCachedGuildUsers(interaction);
  return guildUsers.filter((user) => !linkedDiscordIds.has(user.discordId));
}

async function renderUserSelection(interaction: ButtonInteraction | StringSelectMenuInteraction, page = 0) {
  if (!interaction.inCachedGuild()) return;

  const draft = teamLinkSessions.get(interaction.user.id) ?? makeTeamLinkDraft();
  const users = await getEligibleGuildUsers(interaction);
  const pageInfo = getTeamLinkUserPageInfo(users.length, page);
  draft.userPage = pageInfo.page;
  teamLinkSessions.set(interaction.user.id, draft);

  const description = users.length > 0
    ? [
        "Step 1: select an unlinked Discord user.",
        "",
        `Showing users ${pageInfo.start + 1}-${pageInfo.end} of ${users.length}.`,
        "Users already linked in this server's active league are hidden."
      ].join("\n")
    : [
        "No eligible unlinked users were found in this server.",
        "",
        "Users linked in other servers can still be linked here. Only this guild's active league is excluded."
      ].join("\n");

  await interaction.update({
    embeds: [new EmbedBuilder().setTitle("Link User to Team").setDescription(description)],
    components: users.length > 0 ? buildUserSelectRows({ users, page: pageInfo.page }) : [buildNavigationRow({ includeAdminPanel: true })]
  });
}

export async function renderTeamLinkPanel(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can manage team links.", ephemeral: true });
    return;
  }

  teamLinkSessions.delete(interaction.user.id);
  await interaction.update(buildTeamLinkPanelPayload());
}

export async function handleCreateDefaultTeams(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can create league teams.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  const result = await recApi.createDefaultTeams(interaction.guildId);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("NFL Teams Refreshed")
        .setDescription([
          `League: **${result.league.name}**`,
          `Teams available: **${result.teams.length}**`,
          "",
          "You can now link Discord users to teams."
        ].join("\n"))
    ],
    components: buildTeamLinkHomeRows()
  });
}

export async function handleViewLinkedUsersTeams(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;

  await interaction.deferUpdate();
  const result = await recApi.getLinkedUsersTeams(interaction.guildId);
  const rows = (result.linked ?? []).slice(0, 25).map((row: any) => {
    const authority = String(row.notes ?? "Authority: member").replace("Authority: ", "");
    const userLabel = row.discordId ? `<@${row.discordId}>` : row.user?.display_name ?? row.user_id;
    return `• **${row.team?.name ?? "Unknown Team"}** → ${userLabel} (${authority})`;
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Linked Users / Teams")
        .setDescription([
          `League: **${result.league.name}**`,
          "",
          rows.length > 0 ? rows.join("\n") : "No active team links found."
        ].join("\n"))
    ],
    components: buildTeamLinkHomeRows()
  });
}

export async function handleViewOpenTeams(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;

  await interaction.deferUpdate();
  const result = await recApi.getOpenTeams(interaction.guildId);
  const rows = (result.openTeams ?? [])
    .slice(0, 32)
    .map((team: any) => `• ${team.conference ?? ""} **${team.name}**`);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Open Teams")
        .setDescription([
          `League: **${result.league.name}**`,
          "",
          rows.length > 0 ? rows.join("\n") : "No open teams found."
        ].join("\n"))
    ],
    components: buildTeamLinkHomeRows()
  });
}

export async function startTeamLinkFlow(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can link users to teams.", ephemeral: true });
    return;
  }

  teamLinkSessions.set(interaction.user.id, makeTeamLinkDraft());
  await renderUserSelection(interaction, 0);
}

export async function handleTeamLinkUserPage(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;

  const draft = teamLinkSessions.get(interaction.user.id) ?? makeTeamLinkDraft();
  const nextPage = interaction.customId === TEAM_LINK_CUSTOM_IDS.userPageNext ? draft.userPage + 1 : draft.userPage - 1;
  await renderUserSelection(interaction, nextPage);
}

export async function handleTeamLinkSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;

  const draft = teamLinkSessions.get(interaction.user.id) ?? makeTeamLinkDraft();
  const value = interaction.values[0];

  if (interaction.customId === TEAM_LINK_CUSTOM_IDS.userSelect) {
    draft.discordId = value;
    teamLinkSessions.set(interaction.user.id, draft);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Link User to Team")
          .setDescription("Step 2: select the user's REC authority level.")
      ],
      components: [buildAuthoritySelectRow(), buildNavigationRow({ includeAdminPanel: true })]
    });
    return;
  }

  if (interaction.customId === TEAM_LINK_CUSTOM_IDS.authoritySelect) {
    draft.authority = value as RecTeamAuthority;
    teamLinkSessions.set(interaction.user.id, draft);

    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("Link User to Team")
          .setDescription("Step 3: select AFC or NFC.")
      ],
      components: [buildConferenceSelectRow(), buildNavigationRow({ includeAdminPanel: true })]
    });
    return;
  }

  if (interaction.customId === TEAM_LINK_CUSTOM_IDS.conferenceSelect) {
    draft.conference = value as "AFC" | "NFC";
    teamLinkSessions.set(interaction.user.id, draft);

    await interaction.deferUpdate();

    const openTeamsResult = await recApi.getOpenTeams(interaction.guildId);
    const openConferenceTeams = (openTeamsResult.openTeams ?? []).filter(
      (team: any) => team.conference === draft.conference
    );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Link User to Team")
          .setDescription(
            openConferenceTeams.length > 0
              ? `Step 4: select an open ${draft.conference} team.`
              : `No open ${draft.conference} teams are available in this league.`
          )
      ],
      components:
        openConferenceTeams.length > 0
          ? [buildOpenTeamSelectRow(draft.conference, openConferenceTeams), buildNavigationRow({ includeAdminPanel: true })]
          : [buildNavigationRow({ includeAdminPanel: true })]
    });
    return;
  }

  if (
    interaction.customId === TEAM_LINK_CUSTOM_IDS.afcTeamSelect ||
    interaction.customId === TEAM_LINK_CUSTOM_IDS.nfcTeamSelect
  ) {
    if (value === "CUSTOM_TEAM") {
      await interaction.reply({
        content: "Custom team replacement will be added in the next team-linking pass.",
        ephemeral: true
      });
      return;
    }

    if (!draft.discordId || !draft.authority) {
      await interaction.reply({
        content: "Team link session expired. Start User / Team Linking again.",
        ephemeral: true
      });
      return;
    }

    await interaction.deferUpdate();

    const openTeamsResult = await recApi.getOpenTeams(interaction.guildId);
    const selectedTeam = (openTeamsResult.openTeams ?? []).find((team: any) => team.abbreviation === value);

    if (!selectedTeam) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Team Not Available")
            .setDescription("That team is not currently open. Use Linked Users/Teams or Open Teams, then try again.")
        ],
        components: buildTeamLinkHomeRows()
      });
      teamLinkSessions.delete(interaction.user.id);
      return;
    }

    const result = await recApi.linkUserToTeam({
      guildId: interaction.guildId,
      discordId: draft.discordId,
      teamId: selectedTeam.id,
      authority: draft.authority,
      requestedByDiscordId: interaction.user.id
    });

    const guildMember = await interaction.guild.members.fetch(draft.discordId);
    const syncResult = await syncMemberForTeam({
      member: guildMember,
      teamName: result.team.name,
      authority: draft.authority
    });

    teamLinkSessions.delete(interaction.user.id);
    clearTeamLinkGuildUserCache(interaction.guildId);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("User Linked to Team")
          .setDescription([
            `League: **${result.league.name}**`,
            `Team: **${result.team.name}**`,
            `User: <@${draft.discordId}>`,
            `Authority: **${draft.authority.replace("_", " ")}**`,
            `Nickname: **${syncResult.nickname}**`,
            `Roles: ${syncResult.roleNames.join(", ")}`
          ].join("\n"))
      ],
      components: buildTeamLinkHomeRows()
    });
  }
}
