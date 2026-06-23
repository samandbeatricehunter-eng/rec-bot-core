import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
} from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { nextLeagueStage, stageLabel } from "../lib/league-stage.js";
import { recApi } from "../lib/rec-api.js";
import { enterAdvanceTimeStep } from "./advance-time.js";

export const ADVANCE_WIZARD_CUSTOM_IDS = {
  homeWinPrefix: "rec:advance_wizard:home",
  awayWinPrefix: "rec:advance_wizard:away",
  tiePrefix: "rec:advance_wizard:tie",
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
  };

  sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);

  if (!pendingGames.length) {
    sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
    const result = await recApi.completeAdvanceWeek({
      guildId: interaction.guildId,
      nextWeekNumber: next.weekNumber,
      nextSeasonStage: next.seasonStage,
      advancedByDiscordId: interaction.user.id,
      results: [],
    });
    const interest = result?.savingsInterest;
    const interestLine = interest?.applied && interest.usersCredited > 0
      ? `\n\nSavings interest credited: **$${interest.totalInterest}** across **${interest.usersCredited}** user${interest.usersCredited === 1 ? "" : "s"} (3.5%, floored).`
      : "";
    const headline = `League advanced from **${stageLabel(currentStage, currentWeek)}** to **${stageLabel(next.seasonStage, next.weekNumber)}**.${interestLine}`;
    return enterAdvanceTimeStep(interaction, headline);
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

  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Advancing Week...").setDescription("Saving display results and advancing the league week.")],
    components: [],
  });

  const result = await recApi.completeAdvanceWeek({
    guildId: interaction.guildId,
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
  return enterAdvanceTimeStep(interaction, headline);
}
