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
import { stageLabel } from "../lib/league-stage.js";
import { recApi } from "../lib/rec-api.js";
import { MENU_CUSTOM_IDS } from "../ui/menu.js";

export const ADVANCE_CUSTOM_IDS = {
  regularWeekSelect: "rec:advance:regular_week_select",
  stageSelect: "rec:advance:stage_select",
  seasonSelect: "rec:advance:season_select",
  seasonManualModal: "rec:advance:season_manual_modal",
  seasonManualInput: "rec:advance:season_manual_input"
} as const;

function stageFromWeekNumber(weekNumber: number) {
  if (weekNumber <= 18) return "regular_season";
  if (weekNumber === 19) return "wild_card";
  if (weekNumber === 20) return "divisional";
  if (weekNumber === 21) return "conference_championship";
  if (weekNumber === 22) return "super_bowl";
  return "regular_season";
}

function buildSetWeekRows() {
  const regularOptions = Array.from({ length: 18 }, (_, idx) => {
    const week = idx + 1;
    return new StringSelectMenuOptionBuilder().setLabel(`Week ${week}`).setValue(`regular:${week}`);
  });
  const stageOptions = [
    ["Wild Card", "wild_card:19"],
    ["Divisional", "divisional:20"],
    ["Conference Championship", "conference_championship:21"],
    ["Super Bowl", "super_bowl:22"],
    ["Coach Hiring", "coach_hiring:1"],
    ["Final Re-Signing", "final_resigning:1"],
    ["Free Agency", "free_agency:1"],
    ["Draft", "draft:1"],
    ["Training Camp", "preseason_training_camp:1"],
  ].map(([label, value]) => new StringSelectMenuOptionBuilder().setLabel(label).setValue(value));

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
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Set Week")
      .setDescription("Choose a regular season week, postseason week, or offseason stage. Regular season weeks use Week 1-18; postseason and offseason stages are listed separately.")],
    components: buildSetWeekRows()
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
  const [rawStage, rawWeek] = String(interaction.values[0] ?? "regular:1").split(":");
  const weekNumber = Math.max(1, Number(rawWeek) || 1);
  const seasonStage = rawStage === "regular" ? stageFromWeekNumber(weekNumber) : rawStage;
  let result: any;
  try {
    result = await recApi.setLeagueWeek({ guildId: interaction.guildId, weekNumber, seasonStage });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Set Week Failed").setColor(COLORS.error).setDescription(userFacingError(err))], components: buildAdvanceMgmtRows() });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Week Set").setDescription(`League is now set to **${stageLabel(seasonStage, weekNumber)}**.${formatSavingsInterestSummary(result)}`)],
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
  const seasonStage = String(current?.league?.season_stage ?? current?.league?.current_phase ?? stageFromWeekNumber(weekNumber));
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
    return interaction.reply({ content: "Manual season number must be 25 or higher.", flags: MessageFlags.Ephemeral });
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
