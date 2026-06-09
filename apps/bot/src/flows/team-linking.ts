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
export const simpleTeamLinkSessions = new Map<string, {
  guildId: string;
  teamId: string;
  teamAbbr: string;
  teamName: string;
  selectedUserId?: string;
}>();

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
    const teamDisplay = row.team?.abbreviation ?? row.team?.name ?? "Unknown Team";
    return `• **${teamDisplay}** → ${userLabel} (${authority})`;
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
    .map((team: any) => `• ${team.conference ?? ""} **${team.abbreviation ?? team.name}**`);

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
            `Team: **${result.team.abbreviation ?? result.team.name}**`,
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

export async function startSimpleTeamLink(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can manage team links.", ephemeral: true });
    return;
  }

  // Ensure default 32 NFL teams exist for this league
  const openTeamsResult = await recApi.getOpenTeams(interaction.guildId);
  if (!openTeamsResult.openTeams || openTeamsResult.openTeams.length === 0) {
    await recApi.createDefaultTeams(interaction.guildId);
  }

  const { buildSimpleTeamLinkPanel } = await import("../ui/team-options.js");
  await interaction.update(buildSimpleTeamLinkPanel());
}

export async function handleSimpleTeamLinkSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;

  const { TEAM_LINK_CUSTOM_IDS, buildSimpleTeamSelectPanel, buildUserSelectionPanel } = await import("../ui/team-options.js");

  if (interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleConferenceSelect) {
    const conference = interaction.values[0] as "AFC" | "NFC";

    // Acknowledge immediately — the linked-users API call below can exceed Discord's 3s window
    // (especially on a cold API), which previously caused Unknown interaction (10062) on update.
    await interaction.deferUpdate();

    // Get linked users to show in team descriptions.
    // API shape: row.team = { id, name, abbreviation, ... }, row.discordId, row.discordAccount = { username, global_name }.
    const linkedResult = await recApi.getLinkedUsersTeams(interaction.guildId);
    const linkedUsers = new Map<string, { discordUsername: string; discordId: string }>();
    (linkedResult.linked ?? []).forEach((row: any) => {
      const abbr = row.team?.abbreviation;
      if (abbr && row.discordId) {
        const username = row.discordAccount?.global_name || row.discordAccount?.username;
        linkedUsers.set(abbr, {
          discordUsername: username ? `@${username}` : `<@${row.discordId}>`,
          discordId: row.discordId
        });
      }
    });

    await interaction.editReply(buildSimpleTeamSelectPanel(conference, linkedUsers));
    return;
  }

  if (
    interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleAfcTeamSelect ||
    interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleNfcTeamSelect
  ) {
    await interaction.deferUpdate();

    const teamAbbr = interaction.values[0];
    const conference = interaction.customId === TEAM_LINK_CUSTOM_IDS.simpleAfcTeamSelect ? "AFC" : "NFC";
    const teams = conference === "AFC"
      ? (await import("@rec/shared")).AFC_TEAMS
      : (await import("@rec/shared")).NFC_TEAMS;
    const selectedTeam = teams.find((t: any) => t.abbreviation === teamAbbr);

    if (!selectedTeam) {
      await interaction.editReply({ content: "Team not found." });
      return;
    }

    // Get linked users to check if this team already has someone
    const linkedResult = await recApi.getLinkedUsersTeams(interaction.guildId);
    const currentLinkedUser = (linkedResult.linked ?? []).find((row: any) => row.team?.abbreviation === teamAbbr);

    if (currentLinkedUser) {
      // Team already has a user — actually delete the DB assignment, then clear Discord roles/nickname.
      const teamId = currentLinkedUser.team?.id;
      if (teamId) {
        try {
          await recApi.unlinkTeam({ guildId: interaction.guildId, teamId, requestedByDiscordId: interaction.user.id });
        } catch (error) {
          console.error("[ERROR] Failed to unlink team:", error);
          await interaction.editReply({
            content: `Failed to unlink: ${error instanceof Error ? error.message : String(error)}`,
            components: []
          });
          return;
        }
      }

      const guildMember = await interaction.guild.members.fetch(currentLinkedUser.discordId).catch(() => null);
      if (guildMember) {
        await guildMember.setNickname(null).catch(() => undefined);
        const allRoles = await interaction.guild.roles.fetch();
        for (const roleName of ["REC League Commissioner", "REC League Comp. Committee", "REC League Member"]) {
          const r = allRoles.find((role) => role.name === roleName);
          if (r && guildMember.roles.cache.has(r.id)) {
            await guildMember.roles.remove(r.id).catch(() => undefined);
          }
        }
      }

      simpleTeamLinkSessions.delete(interaction.user.id);

      // Rebuild the conference team panel so the freed team shows as Unassigned and linking can continue.
      const refreshed = await recApi.getLinkedUsersTeams(interaction.guildId);
      const linkedUsers = new Map<string, { discordUsername: string; discordId: string }>();
      (refreshed.linked ?? []).forEach((row: any) => {
        const abbr = row.team?.abbreviation;
        if (abbr && row.discordId) {
          const username = row.discordAccount?.global_name || row.discordAccount?.username;
          linkedUsers.set(abbr, {
            discordUsername: username ? `@${username}` : `<@${row.discordId}>`,
            discordId: row.discordId
          });
        }
      });

      const panel = buildSimpleTeamSelectPanel(conference, linkedUsers);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("User Unlinked")
            .setDescription(`<@${currentLinkedUser.discordId}> has been unlinked from **${selectedTeam.name}**. Select another team to link or unlink.`)
        ],
        components: panel.components
      });
      return;
    }

    // Use the cached member list. getCachedGuildUsers reuses a 5-minute cache and falls back to
    // the gateway member cache when a full fetch would be gateway-rate-limited (opcode 8), so
    // linking many users in a row no longer triggers repeated expensive member fetches.
    const cachedUsers = await getCachedGuildUsers(interaction);
    const availableUsers = cachedUsers.map((u) => ({ label: u.label, discordId: u.discordId }));

    if (availableUsers.length === 0) {
      await interaction.editReply({
        content: "No server members are available to link yet. Wait a few seconds and try again.",
        components: []
      });
      return;
    }

    // Get team ID from league
    let openTeamsResult = await recApi.getOpenTeams(interaction.guildId);
    let allTeams = openTeamsResult.openTeams ?? [];

    // If no teams found, create default NFL teams
    if (allTeams.length === 0) {
      await recApi.createDefaultTeams(interaction.guildId);
      openTeamsResult = await recApi.getOpenTeams(interaction.guildId);
      allTeams = openTeamsResult.openTeams ?? [];
    }

    // Find the team in the list
    let teamData = allTeams.find((t: any) => t.abbreviation === selectedTeam.abbreviation);

    if (!teamData) {
      // If still not found in open teams, try to find in linked teams
      const linkedResult2 = await recApi.getLinkedUsersTeams(interaction.guildId);
      const linkedTeams = linkedResult2.linked?.map((link: any) => ({
        id: link.team?.id,
        abbreviation: link.team?.abbreviation,
        name: link.team?.name
      })) ?? [];

      teamData = linkedTeams.find((t: any) => t.abbreviation === selectedTeam.abbreviation);

      if (!teamData) {
        await interaction.editReply({ content: "Team not found in league. Please try again.", components: [] });
        return;
      }
    }

    simpleTeamLinkSessions.set(interaction.user.id, {
      guildId: interaction.guildId,
      teamId: teamData.id,
      teamAbbr: selectedTeam.abbreviation,
      teamName: selectedTeam.name
    });

    await interaction.editReply(buildUserSelectionPanel(selectedTeam.name, availableUsers, 0));
  }
}

export async function handleSimpleTeamLinkUserSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;

  const { TEAM_LINK_CUSTOM_IDS, buildRoleSelectionPanel } = await import("../ui/team-options.js");
  const session = simpleTeamLinkSessions.get(interaction.user.id);

  if (!session) {
    await interaction.reply({ content: "Team selection expired. Please try again.", ephemeral: true });
    return;
  }

  try {
    const discordId = interaction.values[0];

    // Store the selected user ID in the session
    simpleTeamLinkSessions.set(interaction.user.id, {
      ...session,
      selectedUserId: discordId
    });

    // Find the league roles by name pattern
    const allRoles = await interaction.guild.roles.fetch();
    const commissionerRole = allRoles.find(r => r.name === "REC League Commissioner");
    const compCommitteeRole = allRoles.find(r => r.name === "REC League Comp. Committee");
    const memberRole = allRoles.find(r => r.name === "REC League Member");

    const roles = {
      commissioner: commissionerRole ? `${commissionerRole.name}:${commissionerRole.id}` : "Commissioner",
      coCommissioner: compCommitteeRole ? `${compCommitteeRole.name}:${compCommitteeRole.id}` : "Comp. Committee",
      member: memberRole ? `${memberRole.name}:${memberRole.id}` : "Member"
    };

    await interaction.update(buildRoleSelectionPanel(discordId, session.teamName, roles));
  } catch (error) {
    console.error("[ERROR] Simple team link user select failed:", error);
    await interaction.reply({
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      ephemeral: true
    });
    simpleTeamLinkSessions.delete(interaction.user.id);
  }
}

export async function handleSimpleTeamLinkRoleSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;

  const { TEAM_LINK_CUSTOM_IDS } = await import("../ui/team-options.js");
  const session = simpleTeamLinkSessions.get(interaction.user.id);

  if (!session || !session.selectedUserId) {
    await interaction.reply({ content: "Session expired. Please try again.", ephemeral: true });
    return;
  }

  // Acknowledge immediately — the role/nickname/API work below exceeds Discord's 3s window.
  await interaction.deferUpdate();

  try {
    const roleValue = interaction.values[0];
    // Parse role value (format: "role_type:roleId" or just "role_type")
    const [roleType, roleId] = roleValue.split(":");
    const role = roleType as "member" | "commissioner" | "co_commissioner";

    // Fetch the guild member
    const guildMember = await interaction.guild.members.fetch(session.selectedUserId).catch(() => null);

    if (guildMember) {
      // Find all REC League roles
      const allRoles = await interaction.guild.roles.fetch();
      const commissionerRole = allRoles.find(r => r.name === "REC League Commissioner");
      const compCommitteeRole = allRoles.find(r => r.name === "REC League Comp. Committee");
      const memberRole = allRoles.find(r => r.name === "REC League Member");

      // Remove all league roles first
      const rolesToRemove = [commissionerRole, compCommitteeRole, memberRole].filter(Boolean);
      for (const r of rolesToRemove) {
        if (r && guildMember.roles.cache.has(r.id)) {
          await guildMember.roles.remove(r.id).catch(() => undefined);
        }
      }

      // Add roles based on hierarchy: Commissioner > Comp. Committee > Member
      if (role === "commissioner" && commissionerRole) {
        // Commissioner gets all three roles
        await guildMember.roles.add(commissionerRole.id).catch(() => undefined);
        if (compCommitteeRole) await guildMember.roles.add(compCommitteeRole.id).catch(() => undefined);
        if (memberRole) await guildMember.roles.add(memberRole.id).catch(() => undefined);
      } else if (role === "co_commissioner" && compCommitteeRole) {
        // Comp. Committee gets Comp. Committee and Member
        await guildMember.roles.add(compCommitteeRole.id).catch(() => undefined);
        if (memberRole) await guildMember.roles.add(memberRole.id).catch(() => undefined);
      } else if (role === "member" && memberRole) {
        // Member gets just Member role
        await guildMember.roles.add(memberRole.id).catch(() => undefined);
      }
    }

    // Link the user to the team with the selected role
    await recApi.linkUserToTeam({
      guildId: interaction.guildId,
      discordId: session.selectedUserId,
      teamId: session.teamId,
      authority: role,
      requestedByDiscordId: interaction.user.id
    });

    // Extract team name (last word of team name, e.g., "Ravens" from "Baltimore Ravens"),
    // then append a leadership-role suffix so their title is visible in the member list.
    const teamNameWords = session.teamName.split(" ");
    const baseNickname = teamNameWords[teamNameWords.length - 1];
    let nickname = baseNickname;
    if (role === "commissioner") {
      nickname = `${baseNickname} (Commissioner)`;
    } else if (role === "co_commissioner") {
      nickname = `${baseNickname} (Co-Commissioner)`;
    }
    // Discord nicknames cap at 32 characters.
    nickname = nickname.slice(0, 32);

    if (guildMember) {
      await guildMember.setNickname(nickname).catch(() => undefined);
    }

    simpleTeamLinkSessions.delete(interaction.user.id);
    // Do NOT clear the member cache here: linking does not change guild membership, and clearing
    // it would force an expensive members.fetch() on the next link, re-triggering gateway rate limits
    // when linking many users in a row.

    const roleText = role === "commissioner" ? "Commissioner" : role === "co_commissioner" ? "Comp. Committee" : "Member";

    const { buildSimpleTeamLinkPanel } = await import("../ui/team-options.js");
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("User Linked to Team")
          .setDescription(
            [
              `User: <@${session.selectedUserId}>`,
              `Team: **${session.teamName}** (${session.teamAbbr})`,
              `Role: **${roleText}**`,
              `Nickname: **${nickname}**`,
              "",
              "Select a conference to link another team, or go back."
            ].join("\n")
          )
      ],
      components: buildSimpleTeamLinkPanel().components
    });
  } catch (error) {
    console.error("[ERROR] Simple team link role select failed:", error);
    await interaction.editReply({
      content: `Error linking user: ${error instanceof Error ? error.message : String(error)}`,
      components: []
    });
    simpleTeamLinkSessions.delete(interaction.user.id);
  }
}

export async function handleClearAllTeamLinks(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;

  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can clear team links.", ephemeral: true });
    return;
  }

  try {
    // Get all linked users
    const linkedResult = await recApi.getLinkedUsersTeams(interaction.guildId);
    const linkedUsers = linkedResult.linked ?? [];

    if (linkedUsers.length === 0) {
      await interaction.reply({ content: "No team links to clear.", ephemeral: true });
      return;
    }

    // Unlink all users from database
    await recApi.unlinkAllTeams(interaction.guildId, interaction.user.id);

    // Clear Discord nicknames and roles
    for (const link of linkedUsers) {
      const guildMember = await interaction.guild.members.fetch(link.discordId).catch(() => null);
      if (guildMember) {
        await guildMember.setNickname(null).catch(() => undefined);

        // Remove all REC League roles
        const allRoles = await interaction.guild.roles.fetch();
        const leagueRoles = [
          allRoles.find(r => r.name === "REC League Commissioner"),
          allRoles.find(r => r.name === "REC League Comp. Committee"),
          allRoles.find(r => r.name === "REC League Member")
        ].filter(Boolean);

        for (const role of leagueRoles) {
          if (role && guildMember.roles.cache.has(role.id)) {
            await guildMember.roles.remove(role.id).catch(() => undefined);
          }
        }
      }
    }

    clearTeamLinkGuildUserCache(interaction.guildId);

    // Update the message to show refreshed team list
    // Go back to conference selection so teams can be viewed again
    const { buildSimpleTeamLinkPanel } = await import("../ui/team-options.js");
    await interaction.update({
      ...buildSimpleTeamLinkPanel(),
      embeds: [
        new EmbedBuilder()
          .setTitle("All Links Cleared")
          .setDescription(`Cleared ${linkedUsers.length} team links and removed Discord roles and nicknames. Select a conference to view available teams.`)
      ]
    });
  } catch (error) {
    console.error("[ERROR] Clear all team links failed:", error);
    await interaction.reply({
      content: `Error clearing links: ${error instanceof Error ? error.message : String(error)}`,
      ephemeral: true
    });
  }
}
