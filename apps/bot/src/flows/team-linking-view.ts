import { EmbedBuilder, Interaction } from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import {
  buildAuthoritySelectRow,
  buildConferenceSelectRow,
  buildTeamLinkHomeRows,
  buildTeamSelectRow,
  buildUserSelectRow,
  TEAM_LINK_CUSTOM_IDS
} from "../ui/team-options.js";

export type TeamLinkDraft = {
  discordId?: string;
  authority?: "member" | "commissioner" | "co_commissioner";
  conference?: "AFC" | "NFC";
};

export const teamLinkSessions = new Map<string, TeamLinkDraft>();

export function buildTeamLinkPanelPayload(description?: string) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("User / Team Linking")
        .setDescription(description ?? "Manage Discord users and team links for this server's active league.")
    ],
    components: buildTeamLinkHomeRows()
  };
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
  await interaction.deferUpdate();
  const result = await recApi.createDefaultTeams(interaction.guildId);
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("NFL Teams Refreshed").setDescription(`League: **${result.league.name}**\nTeams available: **${result.teams.length}**`)],
    components: buildTeamLinkHomeRows()
  });
}

export async function handleViewLinkedUsersTeams(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const result = await recApi.getLinkedUsersTeams(interaction.guildId);
  const rows = (result.linked ?? []).slice(0, 25).map((row: any) => `• **${row.team?.name ?? "Unknown Team"}** → ${row.user?.display_name ?? row.user_id}`);
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Linked Users / Teams").setDescription(`League: **${result.league.name}**\n\n${rows.length ? rows.join("\n") : "No active team links found."}`)],
    components: buildTeamLinkHomeRows()
  });
}

export async function handleViewOpenTeams(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton() || !interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const result = await recApi.getOpenTeams(interaction.guildId);
  const rows = (result.openTeams ?? []).slice(0, 32).map((team: any) => `• ${team.conference ?? ""} **${team.name}**`);
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Open Teams").setDescription(`League: **${result.league.name}**\n\n${rows.length ? rows.join("\n") : "No open teams found."}`)],
    components: buildTeamLinkHomeRows()
  });
}

export async function startTeamLinkFlow(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  teamLinkSessions.set(interaction.user.id, {});
  await interaction.update({ embeds: [new EmbedBuilder().setTitle("Link User to Team").setDescription("Step 1: select the Discord user to link.")], components: [buildUserSelectRow()] });
}

export async function handleTeamLinkUserSelect(interaction: Extract<Interaction, { isUserSelectMenu(): boolean }>) {
  if (!interaction.isUserSelectMenu()) return;
  const draft = teamLinkSessions.get(interaction.user.id) ?? {};
  draft.discordId = interaction.values[0];
  teamLinkSessions.set(interaction.user.id, draft);
  await interaction.update({ embeds: [new EmbedBuilder().setTitle("Link User to Team").setDescription("Step 2: select the user's REC authority level.")], components: [buildAuthoritySelectRow()] });
}

export async function handleTeamLinkSelectView(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  const draft = teamLinkSessions.get(interaction.user.id) ?? {};
  const value = interaction.values[0];
  if (interaction.customId === TEAM_LINK_CUSTOM_IDS.authoritySelect) {
    draft.authority = value as TeamLinkDraft["authority"];
    teamLinkSessions.set(interaction.user.id, draft);
    await interaction.update({ embeds: [new EmbedBuilder().setTitle("Link User to Team").setDescription("Step 3: select AFC or NFC.")], components: [buildConferenceSelectRow()] });
    return;
  }
  if (interaction.customId === TEAM_LINK_CUSTOM_IDS.conferenceSelect) {
    draft.conference = value as "AFC" | "NFC";
    teamLinkSessions.set(interaction.user.id, draft);
    await interaction.update({ embeds: [new EmbedBuilder().setTitle("Link User to Team").setDescription(`Step 4: select a ${draft.conference} team.`)], components: [buildTeamSelectRow(draft.conference)] });
  }
}
