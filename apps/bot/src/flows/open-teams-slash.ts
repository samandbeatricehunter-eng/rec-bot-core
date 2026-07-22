import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { COLORS } from "../lib/colors.js";
import { userFacingError } from "../lib/errors.js";
import { isCfbLeague } from "../lib/league-game.js";
import { recApi } from "../lib/rec-api.js";
import { normalizeRosterConferences, type RosterConference } from "../ui/menu.js";

export const OPEN_TEAMS_SLASH_CUSTOM_IDS = {
  confPrefix: "rec:openteams:conf",
  cfbPagePrefix: "rec:openteams:cfb:page",
  requestTeam: "rec:openteams:request",
  conferenceSelect: "rec:openteams:req:conference",
  teamSelectPrefix: "rec:openteams:req:team",
} as const;

function formatTeamLine(team: { name: string; linkedDiscordId?: string | null }) {
  return team.linkedDiscordId ? `~~${team.name}~~` : `**${team.name}**`;
}

function conferenceFields(conference: RosterConference) {
  return conference.divisions
    .map((division) => {
      const lines = division.teams.map(formatTeamLine).join("\n").slice(0, 1024);
      if (!lines) return null;
      return { name: division.label || "Division", value: lines, inline: false as const };
    })
    .filter((field): field is { name: string; value: string; inline: false } => Boolean(field));
}

function buildConferenceEmbed(conference: RosterConference, opts?: { footer?: string }) {
  const fields = conferenceFields(conference);
  const embed = new EmbedBuilder()
    .setTitle(`Open Teams · ${conference.conference}`)
    .setColor(COLORS.gold);
  if (fields.length) embed.addFields(fields);
  else embed.setDescription("No teams listed in this conference.");
  if (opts?.footer) embed.setFooter({ text: opts.footer });
  return embed;
}

function maddenRows(showing: "AFC" | "NFC") {
  const toggleTo = showing === "AFC" ? "NFC" : "AFC";
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${OPEN_TEAMS_SLASH_CUSTOM_IDS.confPrefix}:${toggleTo}`)
        .setLabel(toggleTo)
        .setStyle(toggleTo === "NFC" ? ButtonStyle.Primary : ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(OPEN_TEAMS_SLASH_CUSTOM_IDS.requestTeam)
        .setLabel("Request Team")
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function cfbRows(pageIndex: number) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${OPEN_TEAMS_SLASH_CUSTOM_IDS.cfbPagePrefix}:${pageIndex - 1}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${OPEN_TEAMS_SLASH_CUSTOM_IDS.cfbPagePrefix}:${pageIndex + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(OPEN_TEAMS_SLASH_CUSTOM_IDS.requestTeam)
        .setLabel("Request Team")
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

async function loadConferences(guildId: string): Promise<RosterConference[]> {
  const confData = await recApi.getLeagueConferences(guildId);
  return normalizeRosterConferences(confData?.conferences ?? []);
}

function findConference(conferences: RosterConference[], name: string) {
  return conferences.find((c) => c.conference.toUpperCase() === name.toUpperCase())
    ?? conferences.find((c) => c.conference.toUpperCase().includes(name.toUpperCase()))
    ?? null;
}

function openTeamsList(conferences: RosterConference[]) {
  const open: Array<{ id: string; name: string; conference: string; division: string }> = [];
  for (const conference of conferences) {
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

export async function handleOpenTeamsSlash(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "Open teams is only available inside a league Discord server.", flags: MessageFlags.Ephemeral });
  }

  try {
    const [conferences, isCfb] = await Promise.all([
      loadConferences(interaction.guildId),
      isCfbLeague(interaction.guildId),
    ]);

    if (!conferences.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle("Open Teams").setColor(COLORS.gold).setDescription("No conferences/teams are loaded for this league yet.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (isCfb) {
      const page = 0;
      const conference = conferences[page]!;
      return interaction.reply({
        embeds: [buildConferenceEmbed(conference, { footer: `Conference ${page + 1} of ${conferences.length}` })],
        components: cfbRows(page),
        flags: MessageFlags.Ephemeral,
      });
    }

    const afc = findConference(conferences, "AFC") ?? conferences[0]!;
    return interaction.reply({
      embeds: [buildConferenceEmbed(afc)],
      components: maddenRows("AFC"),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    return interaction.reply({ content: userFacingError(error), flags: MessageFlags.Ephemeral });
  }
}

export async function handleOpenTeamsConfToggle(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const confName = interaction.customId.slice(`${OPEN_TEAMS_SLASH_CUSTOM_IDS.confPrefix}:`.length) as "AFC" | "NFC";
  try {
    await interaction.deferUpdate();
    const conferences = await loadConferences(interaction.guildId);
    const conference = findConference(conferences, confName) ?? conferences[0];
    if (!conference) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Open Teams").setDescription("No conferences found.")],
        components: [],
      });
    }
    const showing = confName.toUpperCase().includes("NFC") ? "NFC" : "AFC";
    return interaction.editReply({
      embeds: [buildConferenceEmbed(conference)],
      components: maddenRows(showing),
    });
  } catch (error) {
    return interaction.followUp({ content: userFacingError(error), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function handleOpenTeamsCfbPage(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const raw = Number(interaction.customId.slice(`${OPEN_TEAMS_SLASH_CUSTOM_IDS.cfbPagePrefix}:`.length));
  try {
    await interaction.deferUpdate();
    const conferences = await loadConferences(interaction.guildId);
    if (!conferences.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Open Teams").setDescription("No conferences found.")],
        components: [],
      });
    }
    const page = ((raw % conferences.length) + conferences.length) % conferences.length;
    const conference = conferences[page]!;
    return interaction.editReply({
      embeds: [buildConferenceEmbed(conference, { footer: `Conference ${page + 1} of ${conferences.length}` })],
      components: cfbRows(page),
    });
  } catch (error) {
    return interaction.followUp({ content: userFacingError(error), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function handleOpenTeamsRequestTeam(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  try {
    await interaction.deferUpdate();
    const [profile, conferences] = await Promise.all([
      recApi.getMenuProfile(interaction.user.id, interaction.guildId).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("404") || /Discord account not found/i.test(message)) return null;
        throw error;
      }),
      loadConferences(interaction.guildId),
    ]);

    if (profile?.team) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Request Team")
            .setColor(COLORS.error)
            .setDescription("You can't request a team because you're already linked to a team in this league."),
        ],
        components: [],
      });
    }

    const open = openTeamsList(conferences);
    if (!open.length) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Request Team")
            .setDescription("This league is currently full with no available teams to request."),
        ],
        components: [],
      });
    }

    const conferenceNames = [...new Set(open.map((team) => team.conference).filter(Boolean))].slice(0, 25);
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Request Team")
          .setColor(COLORS.gold)
          .setDescription("Choose a conference to see **available** (unlinked) teams you can request."),
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(OPEN_TEAMS_SLASH_CUSTOM_IDS.conferenceSelect)
            .setPlaceholder("Select conference")
            .addOptions(
              ...conferenceNames.map((conference) =>
                new StringSelectMenuOptionBuilder().setLabel(conference.slice(0, 100)).setValue(conference),
              ),
            ),
        ),
      ],
    });
  } catch (error) {
    return interaction.followUp({ content: userFacingError(error), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function handleOpenTeamsRequestConference(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  try {
    await interaction.deferUpdate();
    const conference = interaction.values[0] ?? "";
    const conferences = await loadConferences(interaction.guildId);
    const teams = openTeamsList(conferences).filter((team) => team.conference === conference);

    if (!teams.length) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`${conference} — No Open Teams`)
            .setDescription("Every team in this conference is already linked. Try another conference."),
        ],
        components: [],
      });
    }

    const options = teams.slice(0, 24).map((team) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(team.name.slice(0, 100))
        .setValue(team.id)
        .setDescription(team.division.slice(0, 100)),
    );

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${conference} Open Teams`)
          .setDescription("Select an available team to send a link request."),
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${OPEN_TEAMS_SLASH_CUSTOM_IDS.teamSelectPrefix}:${conference}`)
            .setPlaceholder("Select an open team")
            .addOptions(options),
        ),
      ],
    });
  } catch (error) {
    return interaction.followUp({ content: userFacingError(error), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function handleOpenTeamsRequestSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  try {
    await interaction.deferUpdate();
    const teamId = interaction.values[0]!;
    const created = await recApi.createTeamLinkRequest({
      guildId: interaction.guildId,
      discordId: interaction.user.id,
      teamId,
    });

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Request Sent")
          .setColor(COLORS.success)
          .setDescription(`Your request for **${created.teamName}** was sent to commissioners. You'll be linked once approved.`),
      ],
      components: [],
    });
  } catch (error) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Request Failed").setColor(COLORS.error).setDescription(userFacingError(error))],
      components: [],
    });
  }
}