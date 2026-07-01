import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";

export const MANUAL_SCORES_CUSTOM_IDS = {
  open: "rec:ms:open",
  weekSelect: "rec:ms:week",
  gameSelect: "rec:ms:game",
  cancel: "rec:ms:cancel",
  homeWinPrefix: "rec:ms:home:",
  awayWinPrefix: "rec:ms:away:",
  tiePrefix: "rec:ms:tie:",
  scoreModalPrefix: "rec:ms:score_modal:",
  scoreAwayInput: "rec:ms:score_away",
  scoreHomeInput: "rec:ms:score_home",
  anotherPrefix: "rec:ms:another:",
} as const;

type ManualScoreSession = {
  weekNumber: number;
  gameId: string;
  homeName: string;
  awayName: string;
};

const sessions = new Map<string, ManualScoreSession>();
const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

function replyAdminOnly(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) {
  const content = "Only Commissioners, Co-Commissioners, League Managers, or Discord Administrators can enter manual scores.";
  return interaction.reply({ content, ephemeral: true });
}

function buildCancelRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(MANUAL_SCORES_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
}

function buildWeekRows(currentWeek: number) {
  const maxOptions = Math.min(Math.max(currentWeek, 1), 25);
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(MANUAL_SCORES_CUSTOM_IDS.weekSelect)
        .setPlaceholder("Select week")
        .addOptions(Array.from({ length: maxOptions }, (_, idx) => {
          const week = idx + 1;
          return new StringSelectMenuOptionBuilder().setLabel(`Week ${week}`).setValue(String(week));
        })),
    ),
    buildCancelRow(),
  ];
}

export async function handleManualScoresOpen(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyAdminOnly(interaction);
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", ephemeral: true });

  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const currentWeek = Math.max(1, Number(week?.league?.current_week ?? 1));
  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));

  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Manual Scores")
      .setDescription([
        "Enter a game's result by hand when a box score or schedule screenshot isn't available.",
        "",
        "Pick the winner (or Tie). If you know the final score, the follow-up prompt lets you enter it for full accuracy — leave it blank to record just the W/L/T.",
        "",
        "These results update **display records only** (power rankings / standings). They won't count toward stat-based EOS awards or badges — only full box scores populate those. Games that already have a box score submission can't be overridden here.",
      ].join("\n"))],
    components: buildWeekRows(currentWeek),
  });
}

async function renderGameSelect(guildId: string, weekNumber: number) {
  const result = await recApi.listManualScoreGames({ guildId, weekNumber });
  const games = result?.games ?? [];
  if (!games.length) {
    return {
      embeds: [new EmbedBuilder().setTitle("Manual Scores").setColor(0xf1c40f).setDescription(
        result?.lockedCount
          ? `Every scheduled game for Week ${weekNumber} already has a box score submission.`
          : `No scheduled games are logged for Week ${weekNumber}. Import the schedule first, then try again.`,
      )],
      components: [buildCancelRow()],
    };
  }
  const lockedNote = result?.lockedCount ? `\n${result.lockedCount} game(s) already have a box score and aren't shown.` : "";
  return {
    embeds: [new EmbedBuilder().setTitle("Manual Scores").setDescription(`Select the scheduled game for Week ${weekNumber}.${lockedNote}`)],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(MANUAL_SCORES_CUSTOM_IDS.gameSelect)
          .setPlaceholder("Select scheduled game")
          .addOptions(games.slice(0, 25).map((game: any) => {
            const label = `${game.awayName} at ${game.homeName}`.slice(0, 100);
            const existing = game.existingResult;
            const description = existing
              ? existing.isTie ? "Tie logged — select to overwrite" : `${existing.awayScore}-${existing.homeScore} logged — select to overwrite`
              : "No result yet";
            return new StringSelectMenuOptionBuilder()
              .setLabel(label)
              .setValue(`${weekNumber}:${game.gameId}`)
              .setDescription(description.slice(0, 100));
          })),
      ),
      buildCancelRow(),
    ],
  };
}

export async function handleManualScoresWeekSelect(interaction: StringSelectMenuInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyAdminOnly(interaction);
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", ephemeral: true });
  const weekNumber = Number(interaction.values[0] ?? 1);
  await interaction.deferUpdate();
  try {
    return interaction.editReply(await renderGameSelect(interaction.guildId, weekNumber));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Manual Scores").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildCancelRow()],
    });
  }
}

function buildOutcomeRows(gameId: string, homeName: string, awayName: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${MANUAL_SCORES_CUSTOM_IDS.awayWinPrefix}${gameId}`).setLabel(`${awayName} Win`.slice(0, 80)).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${MANUAL_SCORES_CUSTOM_IDS.homeWinPrefix}${gameId}`).setLabel(`${homeName} Win`.slice(0, 80)).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${MANUAL_SCORES_CUSTOM_IDS.tiePrefix}${gameId}`).setLabel("Tie").setStyle(ButtonStyle.Secondary),
    ),
    buildCancelRow(),
  ];
}

export async function handleManualScoresGameSelect(interaction: StringSelectMenuInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyAdminOnly(interaction);
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", ephemeral: true });
  const [weekRaw, gameId] = String(interaction.values[0] ?? "").split(":");
  const weekNumber = Number(weekRaw ?? 1);
  await interaction.deferUpdate();
  try {
    const result = await recApi.listManualScoreGames({ guildId: interaction.guildId, weekNumber });
    const game = (result?.games ?? []).find((g: any) => g.gameId === gameId);
    if (!game) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Manual Scores").setColor(0xe74c3c).setDescription("That game is no longer available — it may already have a box score now.")],
        components: [buildCancelRow()],
      });
    }
    sessions.set(sessionKey(interaction.guildId, interaction.user.id), { weekNumber, gameId, homeName: game.homeName, awayName: game.awayName });
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Manual Scores").setDescription([
        `**Week ${weekNumber}**`,
        `**Away:** ${game.awayName}`,
        `**Home:** ${game.homeName}`,
        "",
        "Pick the winner (or Tie). A follow-up prompt lets you optionally enter the final score.",
      ].join("\n"))],
      components: buildOutcomeRows(gameId, game.homeName, game.awayName),
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Manual Scores").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildCancelRow()],
    });
  }
}

export async function handleManualScoresOutcome(interaction: ButtonInteraction, outcome: "home" | "away" | "tie", gameId: string) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyAdminOnly(interaction);
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", ephemeral: true });
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  const homeLabel = session?.gameId === gameId ? session.homeName : "Home team";
  const awayLabel = session?.gameId === gameId ? session.awayName : "Away team";

  const modal = new ModalBuilder()
    .setCustomId(`${MANUAL_SCORES_CUSTOM_IDS.scoreModalPrefix}${outcome}:${gameId}`)
    .setTitle("Final Score (optional)".slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(MANUAL_SCORES_CUSTOM_IDS.scoreAwayInput).setLabel(`${awayLabel} final score`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("numbers only, leave blank if unknown"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(MANUAL_SCORES_CUSTOM_IDS.scoreHomeInput).setLabel(`${homeLabel} final score`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("numbers only, leave blank if unknown"),
      ),
    );
  return interaction.showModal(modal);
}

function parseScore(raw: string): number | null {
  const v = (raw ?? "").replace(/[^0-9]/g, "");
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

export async function handleManualScoresScoreModal(interaction: ModalSubmitInteraction, outcome: "home" | "away" | "tie", gameId: string) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyAdminOnly(interaction);
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", ephemeral: true });
  await interaction.deferUpdate();

  const awayScore = parseScore(interaction.fields.getTextInputValue(MANUAL_SCORES_CUSTOM_IDS.scoreAwayInput));
  const homeScore = parseScore(interaction.fields.getTextInputValue(MANUAL_SCORES_CUSTOM_IDS.scoreHomeInput));

  try {
    const settled = await recApi.recordManualGameResult({ guildId: interaction.guildId, gameId, outcome, homeScore, awayScore });
    sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
    const scoreLine = settled.hasRealScores
      ? `**${settled.awayName}** ${settled.awayScore} — **${settled.homeName}** ${settled.homeScore}`
      : settled.isTie ? `**${settled.awayName}** tied **${settled.homeName}** (no final score recorded)`
      : `**${settled.outcome === "home" ? settled.homeName : settled.awayName}** won (no final score recorded)`;
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Manual Scores").setColor(0x2ecc71).setDescription([
        `Week ${settled.weekNumber} logged.`,
        scoreLine,
      ].join("\n"))],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${MANUAL_SCORES_CUSTOM_IDS.anotherPrefix}${settled.weekNumber}`).setLabel("Enter Another").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(MANUAL_SCORES_CUSTOM_IDS.cancel).setLabel("Done").setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Manual Scores").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildCancelRow()],
    });
  }
}

export async function handleManualScoresAnother(interaction: ButtonInteraction, weekNumber: number) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyAdminOnly(interaction);
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", ephemeral: true });
  await interaction.deferUpdate();
  try {
    return interaction.editReply(await renderGameSelect(interaction.guildId, weekNumber));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Manual Scores").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildCancelRow()],
    });
  }
}
