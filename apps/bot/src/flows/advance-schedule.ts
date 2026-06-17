import { EmbedBuilder, MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { recApi } from "../lib/rec-api.js";
import {
  ADVANCE_SCHEDULE_CUSTOM_IDS,
  buildAdvanceSchedulePayload,
  DEFAULT_SCHEDULE_TIMEZONE,
  wallClockToUtc,
  type AdvanceScheduleState
} from "../ui/advance-schedule.js";
import { runAdvanceWizardProcessing } from "./advance-wizard.js";

const advanceScheduleSessions = new Map<string, AdvanceScheduleState>();

export function startAdvanceScheduleSession(userId: string, state: AdvanceScheduleState = { timezone: DEFAULT_SCHEDULE_TIMEZONE }) {
  advanceScheduleSessions.set(userId, state);
  return buildAdvanceSchedulePayload(state);
}

export async function handleAdvanceScheduleSelect(interaction: StringSelectMenuInteraction) {
  const state = advanceScheduleSessions.get(interaction.user.id) ?? { timezone: DEFAULT_SCHEDULE_TIMEZONE };
  const value = interaction.values[0];
  if (interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.daySelect) {
    state.date = value;
  } else if (interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.hourSelect) {
    state.hour = value === "none" ? undefined : Number(value);
  } else if (interaction.customId === ADVANCE_SCHEDULE_CUSTOM_IDS.tzSelect) {
    state.timezone = value;
    state.hour = undefined;
  }
  advanceScheduleSessions.set(interaction.user.id, state);
  await interaction.update(buildAdvanceSchedulePayload(state));
}

export async function handleAdvanceScheduleConfirm(interaction: ButtonInteraction) {
  if (!interaction.guildId) return;
  const state = advanceScheduleSessions.get(interaction.user.id);
  if (!state?.date || state.hour == null || !state.timezone) {
    return interaction.reply({ content: "Select a day, time, and timezone first.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();

  if (state.wizardMode && interaction.inCachedGuild()) {
    advanceScheduleSessions.delete(interaction.user.id);
    await runAdvanceWizardProcessing(interaction, state.date, state.hour, state.timezone, interaction.guild);
    return;
  }

  try {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Setting Next Advance...").setDescription("Saving the advance deadline.")], components: [] });
    const [year, month, day] = state.date.split("-").map(Number);
    const when = wallClockToUtc(year, month, day, state.hour, state.timezone);
    const result = await recApi.setNextAdvance({ guildId: interaction.guildId, nextAdvanceAt: when.toISOString(), timezone: state.timezone });
    advanceScheduleSessions.delete(interaction.user.id);
    const times: any[] = result?.nextAdvanceTimes ?? [];
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Next Advance Set")
          .setDescription([
            "The next advance deadline has been set.",
            "",
            ...(times.length ? times.map((t: any) => `${t.label}: ${t.value}`) : ["(No formatted times returned.)"])
          ].join("\n"))
      ],
      components: []
    });
  } catch (error) {
    console.error("[ERROR] Set next advance failed:", error);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Set Next Advance Failed").setDescription(error instanceof Error ? error.message : String(error))],
      components: []
    });
  }
}
