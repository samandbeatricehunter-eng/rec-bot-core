import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { isFullLeagueAdminInteraction, replyFullAdminOnly } from "../lib/admin.js";
import { COLORS } from "../lib/colors.js";
import { userFacingError } from "../lib/errors.js";
import { isCfb, regularSeasonWeeks, stageForWeek, stageLabel, type LeagueGame } from "../lib/league-stage.js";
import { recApi } from "../lib/rec-api.js";
import { MENU_CUSTOM_IDS } from "../ui/menu.js";

export const ADVANCE_CUSTOM_IDS = {
  regularWeekSelect: "rec:advance:regular_week_select",
  stageSelect: "rec:advance:stage_select",
  seasonSelect: "rec:advance:season_select",
  seasonManualModal: "rec:advance:season_manual_modal",
  seasonManualInput: "rec:advance:season_manual_input"
} as const;

async function currentLeagueGame(guildId: string): Promise<LeagueGame> {
  const current = await recApi.viewLeagueWeek(guildId).catch(() => null);
  return (current?.league?.game as LeagueGame) ?? null;
}

// CFB's postseason is conference_championship/cfp_first_round/cfp_quarterfinals/cfp_semifinals/
// national_championship at weeks 15-19 (no bye week), and it starts at "preseason" (no training
// camp). Madden's postseason is wild_card/divisional/conference_championship/super_bowl at weeks
// 19-22, starting at "preseason_training_camp". CFB's offseason is its own dynasty-mode pipeline
// (players_leaving -> transfer_portal -> signing_day -> training_results); Madden's is franchise
// mode (coach_hiring -> final_resigning -> free_agency -> draft) — see
// packages/shared/src/league-stage.ts.
function buildSetWeekRows(game: LeagueGame) {
  const cfb = isCfb(game);
  const firstRegularWeek = cfb ? 0 : 1;
  const lastRegularWeek = regularSeasonWeeks(game);
  const regularOptions = Array.from({ length: lastRegularWeek - firstRegularWeek + 1 }, (_, idx) => {
    const week = firstRegularWeek + idx;
    return new StringSelectMenuOptionBuilder().setLabel(`Week ${week}`).setValue(`regular:${week}`);
  });
  const stageOptions = (cfb
    ? [
        ["Conference Championship", "conference_championship:15"],
        ["CFP First Round", "cfp_first_round:16"],
        ["CFP Quarterfinals", "cfp_quarterfinals:17"],
        ["CFP Semifinals", "cfp_semifinals:18"],
        ["National Championship", "national_championship:19"],
        ["Players Leaving", "players_leaving:1"],
        ["Transfer Portal", "transfer_portal:1"],
        ["National Signing Day", "signing_day:1"],
        ["Training Results", "training_results:1"],
        ["Preseason", "preseason:1"],
      ]
    : [
        ["Wild Card", "wild_card:19"],
        ["Divisional", "divisional:20"],
        ["Conference Championship", "conference_championship:21"],
        ["Super Bowl", "super_bowl:22"],
        ["Coach Hiring", "coach_hiring:1"],
        ["Final Re-Signing", "final_resigning:1"],
        ["Free Agency", "free_agency:1"],
        ["Draft", "draft:1"],
        ["Training Camp", "preseason_training_camp:1"],
      ]
  ).map(([label, value]) => new StringSelectMenuOptionBuilder().setLabel(label).setValue(value));

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ADVANCE_CUSTOM_IDS.regularWeekSelect)
        .setPlaceholder("Select regular season week")
        .addOptions(regularOptions)
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ADVANCE_CUSTOM_IDS.stageSelect)
        .setPlaceholder("Select postseason or offseason stage")
        .addOptions(stageOptions)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Secondary)
    )
  ];
}

export async function handleSetWeek(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league week");
  const game = await currentLeagueGame(interaction.guildId);
  const firstRegularWeek = isCfb(game) ? 0 : 1;
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Set Week")
      .setDescription(`Choose a regular season week, postseason week, or offseason stage. Regular season weeks use Week ${firstRegularWeek}-${regularSeasonWeeks(game)}; postseason and offseason stages are listed separately.`)],
    components: buildSetWeekRows(game)
  });
}

function formatSavingsInterestSummary(result: any) {
  const interest = result?.savingsInterest;
  if (!interest?.applied || Number(interest.usersCredited ?? 0) <= 0) return "";
  const usersCredited = Number(interest.usersCredited ?? 0);
  const totalInterest = Number(interest.totalInterest ?? 0);
  return `\n\nSavings interest credited: **$${totalInterest}** across **${usersCredited}** user${usersCredited === 1 ? "" : "s"} (3.5%, floored).`;
}

export async function handleSetWeekSelect(interaction: any, buildAdvanceMgmtRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league week");
  await interaction.deferUpdate();
  const game = await currentLeagueGame(interaction.guildId);
  const [rawStage, rawWeek] = String(interaction.values[0] ?? "regular:1").split(":");
  const parsedWeek = Number(rawWeek);
  // Math.max(0, ...) — not Math.max(1, ...) — so CFB's Week 0 survives; only Madden's options
  // start at 1 anyway, so this never pulls a Madden week below its real minimum.
  const weekNumber = Number.isFinite(parsedWeek) ? Math.max(0, parsedWeek) : 1;
  const seasonStage = rawStage === "regular" ? stageForWeek(weekNumber, game) : rawStage;
  let result: any;
  try {
    result = await recApi.setLeagueWeek({ guildId: interaction.guildId, weekNumber, seasonStage });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set Week Failed").setColor(COLORS.error).setDescription(userFacingError(err))], components: buildAdvanceMgmtRows() });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Week Set").setDescription(`League is now set to **${stageLabel(seasonStage, weekNumber, game)}**.${formatSavingsInterestSummary(result)}`)],
    components: buildAdvanceMgmtRows()
  });
}

function buildSetSeasonRows() {
  const options = Array.from({ length: 24 }, (_, idx) => {
    const season = idx + 1;
    return new StringSelectMenuOptionBuilder().setLabel(`Season ${season}`).setValue(String(season));
  });
  options.push(new StringSelectMenuOptionBuilder().setLabel("Manual Season Number").setValue("manual").setDescription("Enter season 25 or higher."));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(ADVANCE_CUSTOM_IDS.seasonSelect)
        .setPlaceholder("Select season")
        .addOptions(options)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtAdvance).setLabel("Back").setStyle(ButtonStyle.Secondary)
    )
  ];
}

export async function handleSetSeason(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league season");
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Set Season")
      .setDescription("Select seasons 1-24, or choose Manual Season Number for season 25 or higher.")],
    components: buildSetSeasonRows()
  });
}

async function updateLeagueSeason(guildId: string, seasonNumber: number) {
  const current = await recApi.viewLeagueWeek(guildId);
  const weekNumber = Number(current?.league?.current_week ?? 1);
  const seasonStage = String(current?.league?.season_stage ?? current?.league?.current_phase ?? stageForWeek(weekNumber, current?.league?.game ?? null));
  return recApi.setLeagueWeek({ guildId, weekNumber, seasonStage, seasonNumber });
}

export async function handleSetSeasonSelect(interaction: any, buildAdvanceMgmtRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league season");
  const selected = String(interaction.values[0] ?? "");
  if (selected === "manual") {
    return interaction.showModal(new ModalBuilder()
      .setCustomId(ADVANCE_CUSTOM_IDS.seasonManualModal)
      .setTitle("Set Season")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(ADVANCE_CUSTOM_IDS.seasonManualInput)
          .setLabel("Season number")
          .setPlaceholder("25")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(3)
      )));
  }
  await interaction.deferUpdate();
  try {
    await updateLeagueSeason(interaction.guildId, Number(selected));
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set Season Failed").setColor(COLORS.error).setDescription(userFacingError(err))], components: buildAdvanceMgmtRows() });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Season Set").setDescription(`League season is now **Season ${Number(selected)}**.`)],
    components: buildAdvanceMgmtRows()
  });
}

export async function handleSetSeasonManual(interaction: ModalSubmitInteraction, buildAdvanceMgmtRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "set the league season");
  const seasonNumber = Number(interaction.fields.getTextInputValue(ADVANCE_CUSTOM_IDS.seasonManualInput));
  if (!Number.isInteger(seasonNumber) || seasonNumber < 25) {
    const invalidPayload = { embeds: [new EmbedBuilder().setTitle("Invalid Season").setColor(COLORS.error).setDescription("Manual season number must be 25 or higher.")], components: buildAdvanceMgmtRows() };
    if (interaction.isFromMessage()) return interaction.update(invalidPayload);
    return interaction.reply({ ...invalidPayload, flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  try {
    await updateLeagueSeason(interaction.guildId, seasonNumber);
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set Season Failed").setColor(COLORS.error).setDescription(userFacingError(err))], components: buildAdvanceMgmtRows() });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Season Set").setDescription(`League season is now **Season ${seasonNumber}**.`)],
    components: buildAdvanceMgmtRows()
  });
}
