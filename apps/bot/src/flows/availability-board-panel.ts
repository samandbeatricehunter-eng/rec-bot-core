import {
  ActionRowBuilder, ButtonInteraction, ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder,
  StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { handleSetAvailabilitySlash } from "./availability-slash.js";
import { handleSetTimezoneSlash } from "./settimezone-slash.js";
import { parseAvailabilityText } from "../lib/availability-text.js";

export const AVAILABILITY_BOARD_CUSTOM_IDS = {
  setAvailability: "rec:availboard:setavailability",
  setTimezone: "rec:availboard:settimezone",
  thisWeek: "rec:availboard:thisweek",
  thisWeekDaySelect: "rec:availboard:thisweek:day",
  thisWeekModalPrefix: "rec:availboard:thisweek:modal:",
};

export async function handleBoardSetAvailability(interaction: ButtonInteraction) {
  return handleSetAvailabilitySlash(interaction);
}

export async function handleBoardSetTimezone(interaction: ButtonInteraction) {
  return handleSetTimezoneSlash(interaction);
}

function nextSevenDays(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const value = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    out.push({ value, label });
  }
  return out;
}

export async function handleBoardThisWeek(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const options = nextSevenDays().map((d) => new StringSelectMenuOptionBuilder().setLabel(d.label).setValue(d.value));
  await interaction.reply({
    content: "Pick a day this week to adjust (an exception to your normal availability):",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(AVAILABILITY_BOARD_CUSTOM_IDS.thisWeekDaySelect).setPlaceholder("Select a day").addOptions(options),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleBoardThisWeekDaySelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const date = interaction.values[0]!;
  const modal = new ModalBuilder()
    .setCustomId(`${AVAILABILITY_BOARD_CUSTOM_IDS.thisWeekModalPrefix}${date}`)
    .setTitle(`Exception for ${date}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("windows").setLabel('Windows (e.g. "6pm-9pm"), or "off"').setStyle(TextInputStyle.Short).setPlaceholder("off").setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleBoardThisWeekModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const localDate = interaction.customId.slice(AVAILABILITY_BOARD_CUSTOM_IDS.thisWeekModalPrefix.length);
  const raw = interaction.fields.getTextInputValue("windows");
  const parsed = parseAvailabilityText(raw);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if ("error" in parsed) return interaction.editReply({ content: parsed.error });

  try {
    const profile = await recApi.getSchedulingProfile({ guildId: interaction.guildId, discordId: interaction.user.id });
    const timezone = profile.profile.timezone ?? "America/Chicago";

    if (!parsed.windows.length) {
      await recApi.setSchedulingOverride({ guildId: interaction.guildId, discordId: interaction.user.id, scope: "week", localDate, timezone, unavailable: true });
    } else {
      for (const w of parsed.windows) {
        await recApi.setSchedulingOverride({ guildId: interaction.guildId, discordId: interaction.user.id, scope: "week", localDate, timezone, startMinute: w.startMinute, endMinute: w.endMinute % 1440, unavailable: false });
      }
    }
    await interaction.editReply({ content: `Exception saved for ${localDate}: ${parsed.windows.length ? raw : "unavailable all day"}.` });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to save that exception." });
  }
}
