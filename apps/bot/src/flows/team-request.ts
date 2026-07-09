import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { RecTeamAuthority } from "@rec/shared";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { isCfbLeague } from "../lib/league-game.js";
import { recApi } from "../lib/rec-api.js";
import { ensureRecBaseRoles, formatTeamDisplayName, syncMemberForTeam } from "../lib/role-sync.js";
import { buildTeamsMenuRows, MENU_CUSTOM_IDS, normalizeRosterConferences, type TeamsMenuPage, type RosterConference } from "../ui/menu.js";

export const TEAM_REQUEST_CUSTOM_IDS = {
  conferenceSelect: "rec:team_request:conference",
  teamSelectPrefix: "rec:team_request:team",
  approvePrefix: "rec:team_request:approve",
  rejectPrefix: "rec:team_request:reject",
  rolePrefix: "rec:team_request:role",
} as const;

function openTeams(conferences: RosterConference[]) {
  const open: Array<{ id: string; name: string; conference: string; division: string }> = [];
  for (const conference of normalizeRosterConferences(conferences)) {
    for (const division of conference.divisions) {
      for (const team of division.teams) {
        if (!team.linkedDiscordId) {
          open.push({
            id: team.id,
            name: team.name,
            conference: conference.conference,
            division: division.label,
          });
        }
      }
    }
  }
  return open;
}

function requestTeamBackRow() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.teamsBack).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildTeamRequestConferenceRows(openTeamsList: Array<{ conference: string }>) {
  const conferences = [...new Set(openTeamsList.map((team) => team.conference).filter(Boolean))].slice(0, 25);
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(TEAM_REQUEST_CUSTOM_IDS.conferenceSelect)
        .setPlaceholder("Select conference")
        .addOptions(
          ...conferences.map((conference) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(conference.slice(0, 100))
              .setValue(conference)
          )
        )
    ),
    ...requestTeamBackRow(),
  ];
}

async function loadTeamRequestEligibility(guildId: string, discordId: string) {
  const [profileResult, confData] = await Promise.all([
    recApi.getMenuProfile(discordId, guildId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("404") || /Discord account not found/i.test(message)) return null;
      throw error;
    }),
    recApi.getLeagueConferences(guildId),
  ]);

  const conferences: RosterConference[] = confData?.conferences ?? [];
  return {
    isLinkedToTeam: Boolean(profileResult?.team),
    openTeams: openTeams(conferences),
    conferences,
  };
}

export async function startTeamRequestFlow(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Request Team").setDescription("Open /menu inside a REC Discord server.")],
      components: [],
    });
  }

  const eligibility = await loadTeamRequestEligibility(interaction.guildId, interaction.user.id);
  if (eligibility.isLinkedToTeam) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Request Team")
          .setDescription("You can't request a team because you're already linked to a team in this league."),
      ],
      components: requestTeamBackRow(),
    });
  }

  if (!eligibility.openTeams.length) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Request Team")
          .setDescription("This league is currently full with no available teams to request."),
      ],
      components: requestTeamBackRow(),
    });
  }

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Request Team")
        .setDescription("Choose a conference to see **available** (unlinked) teams you can request."),
    ],
    components: buildTeamRequestConferenceRows(eligibility.openTeams),
  });
}

export async function handleTeamRequestConference(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) return;
  const conference = interaction.isStringSelectMenu()
    ? interaction.values[0] ?? ""
    : interaction.customId.slice(`${TEAM_REQUEST_CUSTOM_IDS.conferenceSelect}:`.length);
  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: RosterConference[] = confData?.conferences ?? [];
  const teams = openTeams(conferences).filter((team) => team.conference === conference);

  if (!teams.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle(`${conference} — No Open Teams`).setDescription("Every team in this conference is already linked. Try the other conference or ask a commissioner.")],
      components: buildTeamsMenuRows(conference as TeamsMenuPage, conferences),
    });
  }

  const options = teams.slice(0, 24).map((team) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(team.name.slice(0, 100))
      .setValue(team.id)
      .setDescription(team.division.slice(0, 100)),
  );

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(`${conference} Open Teams`).setDescription("Select an available team to send a link request to the commissioner office.")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${TEAM_REQUEST_CUSTOM_IDS.teamSelectPrefix}:${conference}`)
          .setPlaceholder("Select an open team")
          .addOptions(options),
      ),
      ...buildTeamsMenuRows(conference as TeamsMenuPage, conferences),
    ],
  });
}

async function getCommissionerOfficeChannel(guild: ButtonInteraction["guild"], guildId: string) {
  const cfg = await recApi.getEconomyConfig(guildId).catch(() => null);
  const routes = cfg?.routes ?? cfg ?? {};
  const channelId = routes.commissioner_office_channel_id ?? routes.commissionerOfficeChannelId;
  if (!channelId || !guild) return null;
  return guild.channels.fetch(channelId).catch(() => null);
}

export async function handleTeamRequestSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId || !interaction.guild) return;

  const teamId = interaction.values[0]!;
  try {
    const created = await recApi.createTeamLinkRequest({
      guildId: interaction.guildId,
      discordId: interaction.user.id,
      teamId,
    });

    const requestId = created.request.id;
    const officeChannel = await getCommissionerOfficeChannel(interaction.guild, interaction.guildId);
    if (!officeChannel || !officeChannel.isTextBased()) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Request Failed").setDescription("Commissioner office channel is not configured. Ask a commissioner to set it in Server Setup.")],
        components: buildTeamsMenuRows("NFC"),
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("Team Link Request")
      .setDescription([
        `<@${interaction.user.id}> requested the following open team:`,
        `**${created.teamName}**`,
        "",
        "Approve or reject this request below.",
      ].join("\n"));

    const message = await officeChannel.send({
      embeds: [embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${TEAM_REQUEST_CUSTOM_IDS.approvePrefix}:${requestId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${TEAM_REQUEST_CUSTOM_IDS.rejectPrefix}:${requestId}`).setLabel("Reject").setStyle(ButtonStyle.Danger),
        ),
      ],
      allowedMentions: { users: [interaction.user.id] },
    });

    await recApi.attachTeamLinkRequestMessage({
      requestId,
      channelId: message.channelId,
      messageId: message.id,
    });

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Request Sent")
          .setDescription(`Your request for **${created.teamName}** was sent to the commissioner office. You'll be linked once approved.`),
      ],
      components: buildTeamsMenuRows("NFC"),
    });
  } catch (error) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Request Failed").setDescription(userFacingError(error))],
      components: buildTeamsMenuRows("NFC"),
    });
  }
}

function parseRequestId(customId: string, prefix: string) {
  return customId.slice(`${prefix}:`.length);
}

async function updateReviewMessage(interaction: ButtonInteraction, request: any, embed: EmbedBuilder, components: ActionRowBuilder<ButtonBuilder>[] = []) {
  const channelId = request.review_channel_id;
  const messageId = request.review_message_id;
  if (channelId && messageId && interaction.guild) {
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) await message.edit({ embeds: [embed], components }).catch(() => undefined);
    }
  }
  if (interaction.message.editable) {
    await interaction.message.edit({ embeds: [embed], components }).catch(() => undefined);
  }
}

export async function handleTeamRequestApprove(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can approve team requests.", ephemeral: true });
  }
  await interaction.deferUpdate();
  const requestId = parseRequestId(interaction.customId, TEAM_REQUEST_CUSTOM_IDS.approvePrefix);
  try {
    await recApi.approveTeamLinkRequest({ requestId, reviewerDiscordId: interaction.user.id });
    const result = await recApi.completeTeamLinkRequest({
      requestId,
      authority: "member",
      reviewerDiscordId: interaction.user.id,
    });
    const request = result.request;
    const team = result.link?.team;

    let isCfb = false;
    if (interaction.guild) {
      isCfb = await isCfbLeague(interaction.guild.id);
      await ensureRecBaseRoles(interaction.guild);
      const member = await interaction.guild.members.fetch(request.requester_discord_id).catch(() => null);
      if (member) {
        await syncMemberForTeam({
          member,
          teamName: team?.name ?? "Team",
          authority: "member",
          team,
          isCfb,
        }).catch(() => undefined);
      }
    }
    const teamDisplayName = formatTeamDisplayName(team, isCfb) ?? team?.name ?? "Team";
    const embed = new EmbedBuilder()
      .setTitle("Team Link Request — Approved")
      .setDescription([
        `<@${interaction.user.id}> linked <@${request.requester_discord_id}> to **${teamDisplayName}** as **member**.`,
      ].join("\n"));
    await updateReviewMessage(interaction, request, embed, []);
  } catch (error) {
    await interaction.followUp({ content: userFacingError(error), ephemeral: true }).catch(() => undefined);
  }
}

export async function handleTeamRequestReject(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can reject team requests.", ephemeral: true });
  }
  await interaction.deferUpdate();
  const requestId = parseRequestId(interaction.customId, TEAM_REQUEST_CUSTOM_IDS.rejectPrefix);
  try {
    const request = await recApi.rejectTeamLinkRequest({ requestId, reviewerDiscordId: interaction.user.id });
    const embed = new EmbedBuilder()
      .setTitle("Team Link Request — Rejected")
      .setDescription(`Request from <@${request.requester_discord_id}> was rejected by <@${interaction.user.id}>.`);
    await updateReviewMessage(interaction, request, embed, []);
  } catch (error) {
    await interaction.followUp({ content: userFacingError(error), ephemeral: true }).catch(() => undefined);
  }
}

export async function handleTeamRequestRole(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can assign team roles.", ephemeral: true });
  }
  await interaction.deferUpdate();
  const parts = interaction.customId.split(":");
  const authority = parts[parts.length - 2] as RecTeamAuthority;
  const requestId = parts[parts.length - 1]!;

  try {
    const result = await recApi.completeTeamLinkRequest({
      requestId,
      authority,
      reviewerDiscordId: interaction.user.id,
    });
    const request = result.request;
    const team = result.link?.team;

    let isCfb = false;
    if (interaction.guild) {
      isCfb = await isCfbLeague(interaction.guild.id);
      await ensureRecBaseRoles(interaction.guild);
      const member = await interaction.guild.members.fetch(request.requester_discord_id).catch(() => null);
      if (member) {
        await syncMemberForTeam({
          member,
          teamName: team?.name ?? "Team",
          authority,
          team,
          isCfb,
        }).catch(() => undefined);
      }
    }
    const teamDisplayName = formatTeamDisplayName(team, isCfb) ?? team?.name ?? "Team";

    const roleLabel = authority.replace("_", " ");
    const embed = new EmbedBuilder()
      .setTitle("Team Link Request — Completed")
      .setDescription([
        `<@${interaction.user.id}> linked <@${request.requester_discord_id}> to **${teamDisplayName}** as **${roleLabel}**.`,
      ].join("\n"));

    await updateReviewMessage(interaction, request, embed, []);
  } catch (error) {
    await interaction.followUp({ content: userFacingError(error), ephemeral: true }).catch(() => undefined);
  }
}
