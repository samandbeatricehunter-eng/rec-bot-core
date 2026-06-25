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
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { nextLeagueStage, stageLabel } from "../lib/league-stage.js";
import { recApi } from "../lib/rec-api.js";
import { enterAdvanceTimeStep } from "./advance-time.js";

export const ADVANCE_WIZARD_CUSTOM_IDS = {
  homeWinPrefix: "rec:advance_wizard:home",
  awayWinPrefix: "rec:advance_wizard:away",
  tiePrefix: "rec:advance_wizard:tie",
  divisionWinnerSelectPrefix: "rec:advance_wizard:division_winner",
  cancelPrefix: "rec:advance_wizard:cancel",
} as const;

type WizardGame = {
  gameId: string;
  homeTeamName: string;
  awayTeamName: string;
  isH2h: boolean;
  isCpuGame: boolean;
};

type AdvanceWizardSession = {
  guildId: string;
  userId: string;
  seasonNumber: number;
  currentWeek: number;
  currentStage: string;
  nextWeekNumber: number;
  nextSeasonStage: string;
  pendingGames: WizardGame[];
  gameIndex: number;
  results: Array<{ gameId: string; outcome: "home" | "away" | "tie" }>;
  divisions: DivisionWinnerGroup[];
  divisionIndex: number;
  divisionWinners: Array<{ divisionKey: string; teamId: string }>;
};

type DivisionWinnerGroup = {
  key: string;
  label: string;
  conference: string;
  division: string;
  teams: Array<{ id: string; name: string; abbreviation?: string | null }>;
};

const sessions = new Map<string, AdvanceWizardSession>();
const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

function renderWizardStep(session: AdvanceWizardSession) {
  const game = session.pendingGames[session.gameIndex];
  if (!game) {
    return {
      embeds: [new EmbedBuilder().setTitle("Advance Week").setDescription("No games require commissioner input this week.")],
      components: [],
    };
  }

  const embed = new EmbedBuilder()
    .setTitle(`Advance Week — Game ${session.gameIndex + 1} of ${session.pendingGames.length}`)
    .setDescription([
      `Logging results for **${stageLabel(session.currentStage, session.currentWeek)}** before advancing to **${stageLabel(session.nextSeasonStage, session.nextWeekNumber)}**.`,
      "",
      `**Away:** ${game.awayTeamName}`,
      `**Home:** ${game.homeTeamName}`,
      game.isH2h ? "User H2H" : "Includes CPU",
      "",
      "Select the winner. These results update **display records only** (power rankings / team embed W-L). Box scores still drive official stats and payouts.",
    ].join("\n"));

  const suffix = `:${session.guildId}:${session.userId}`;
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.awayWinPrefix}${suffix}`).setLabel(`${game.awayTeamName} Win`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.homeWinPrefix}${suffix}`).setLabel(`${game.homeTeamName} Win`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.tiePrefix}${suffix}`).setLabel("Tie").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.cancelPrefix}${suffix}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function needsDivisionWinnerStep(session: Pick<AdvanceWizardSession, "currentStage" | "currentWeek" | "nextSeasonStage">) {
  return session.currentStage === "regular_season" && session.currentWeek >= 18 && session.nextSeasonStage === "wild_card";
}

function renderDivisionWinnerStep(session: AdvanceWizardSession) {
  const division = session.divisions[session.divisionIndex];
  if (!division) {
    return {
      embeds: [new EmbedBuilder().setTitle("Division Winners").setDescription("All division winners selected. Saving and advancing...")],
      components: [],
    };
  }

  const selectedLines = session.divisionWinners
    .map((winner) => {
      const group = session.divisions.find((d) => d.key === winner.divisionKey);
      const team = group?.teams.find((t) => t.id === winner.teamId);
      return `- ${group?.label ?? winner.divisionKey}: **${team?.name ?? "Selected"}**`;
    });

  const suffix = `:${session.guildId}:${session.userId}`;
  const selected = session.divisionWinners.find((winner) => winner.divisionKey === division.key)?.teamId;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.divisionWinnerSelectPrefix}${suffix}`)
    .setPlaceholder(`Select ${division.label} winner`)
    .addOptions(
      division.teams.slice(0, 25).map((team) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(team.name.slice(0, 100))
          .setDescription((team.abbreviation ?? division.label).slice(0, 100))
          .setValue(team.id)
          .setDefault(team.id === selected),
      ),
    );

  return {
    embeds: [new EmbedBuilder()
      .setTitle(`Division Winners - ${session.divisionIndex + 1} of ${session.divisions.length}`)
      .setDescription([
        `Select the **${division.label}** winner before advancing to **${stageLabel(session.nextSeasonStage, session.nextWeekNumber)}**.`,
        "",
        selectedLines.length ? selectedLines.join("\n") : "No division winners selected yet.",
      ].join("\n"))],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${ADVANCE_WIZARD_CUSTOM_IDS.cancelPrefix}${suffix}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function enterDivisionWinnerStepOrComplete(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  session: AdvanceWizardSession,
  buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[],
) {
  if (needsDivisionWinnerStep(session)) {
    const payload = await recApi.getDivisionWinnerOptions(session.guildId);
    session.divisions = (payload.divisions ?? []).filter((division: DivisionWinnerGroup) => (division.teams ?? []).length > 1);
    session.divisionIndex = 0;
    session.divisionWinners = [];
    if (session.divisions.length) {
      sessions.set(sessionKey(session.guildId, session.userId), session);
      return interaction.editReply(renderDivisionWinnerStep(session));
    }
  }
  return completeAdvanceFromSession(interaction, session, buildAdvanceRows);
}

async function completeAdvanceFromSession(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  session: AdvanceWizardSession,
  _buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[],
) {
  if (needsDivisionWinnerStep(session) && session.divisionWinners.length) {
    await recApi.saveDivisionWinners({
      guildId: session.guildId,
      seasonNumber: session.seasonNumber,
      selectedByDiscordId: interaction.user.id,
      winners: session.divisionWinners,
    });
  }

  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Advancing Week...").setDescription("Saving display results and advancing the league week.")],
    components: [],
  });

  const result = await recApi.completeAdvanceWeek({
    guildId: session.guildId,
    nextWeekNumber: session.nextWeekNumber,
    nextSeasonStage: session.nextSeasonStage,
    advancedByDiscordId: interaction.user.id,
    results: session.results,
  });

  const interest = result?.savingsInterest;
  const interestLine = interest?.applied && interest.usersCredited > 0
    ? `\n\nSavings interest credited: **$${interest.totalInterest}** across **${interest.usersCredited}** user${interest.usersCredited === 1 ? "" : "s"} (3.5%, floored).`
    : "";

  const headline = `League advanced from **${stageLabel(session.currentStage, session.currentWeek)}** to **${stageLabel(session.nextSeasonStage, session.nextWeekNumber)}**.${interestLine}`;
  sessions.delete(sessionKey(session.guildId, session.userId));
  return enterAdvanceTimeStep(interaction, headline, { seasonNumber: session.seasonNumber, weekNumber: session.currentWeek });
}

export async function startAdvanceWeekWizard(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", ephemeral: true });
  if (!isFullLeagueAdminInteraction(interaction)) return interaction.reply({ content: "Only commissioners or server admins can advance the league.", ephemeral: true });

  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Preparing Advance Week...").setDescription("Loading this week's schedule and checking for missing box scores.")],
    components: [],
  });

  const payload = await recApi.getAdvanceWeekGames(interaction.guildId);
  const currentWeek = Number(payload.currentWeek ?? 1);
  const currentStage = String(payload.currentStage ?? "regular_season");
  const next = nextLeagueStage(currentWeek, currentStage);
  const pendingGames: WizardGame[] = (payload.gamesNeedingInput ?? []).map((game: any) => ({
    gameId: game.gameId,
    homeTeamName: game.homeTeamName,
    awayTeamName: game.awayTeamName,
    isH2h: Boolean(game.isH2h),
    isCpuGame: Boolean(game.isCpuGame),
  }));

  const session: AdvanceWizardSession = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    seasonNumber: Number(payload.seasonNumber ?? 1),
    currentWeek,
    currentStage,
    nextWeekNumber: next.weekNumber,
    nextSeasonStage: next.seasonStage,
    pendingGames,
    gameIndex: 0,
    results: [],
    divisions: [],
    divisionIndex: 0,
    divisionWinners: [],
  };

  sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);

  if (!pendingGames.length) {
    sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
    return enterDivisionWinnerStepOrComplete(interaction, session, buildAdvanceRows);
  }

  return interaction.editReply(renderWizardStep(session));
}

export async function handleAdvanceWizardCancel(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Advance Week").setDescription("Advance cancelled. No changes were saved.")],
    components: buildAdvanceRows(),
  });
}

export async function handleAdvanceWizardOutcome(interaction: ButtonInteraction, outcome: "home" | "away" | "tie", buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  if (!session) {
    return interaction.reply({ content: "Advance session expired. Reopen League Mgmt > Advance.", ephemeral: true });
  }

  const game = session.pendingGames[session.gameIndex];
  if (!game) return;

  await interaction.deferUpdate();
  session.results.push({ gameId: game.gameId, outcome });
  session.gameIndex += 1;

  if (session.gameIndex < session.pendingGames.length) {
    sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderWizardStep(session));
  }

  return enterDivisionWinnerStepOrComplete(interaction, session, buildAdvanceRows);
}

export async function handleAdvanceWizardDivisionWinnerSelect(
  interaction: StringSelectMenuInteraction,
  buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[],
) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  if (!session) {
    return interaction.reply({ content: "Advance session expired. Reopen League Mgmt > Advance.", ephemeral: true });
  }

  const division = session.divisions[session.divisionIndex];
  const teamId = interaction.values[0];
  if (!division || !teamId) return interaction.reply({ content: "Division winner selection was invalid.", ephemeral: true });

  await interaction.deferUpdate();
  session.divisionWinners = [
    ...session.divisionWinners.filter((winner) => winner.divisionKey !== division.key),
    { divisionKey: division.key, teamId },
  ];
  session.divisionIndex += 1;

  if (session.divisionIndex < session.divisions.length) {
    sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderDivisionWinnerStep(session));
  }

  return completeAdvanceFromSession(interaction, session, buildAdvanceRows);
}
