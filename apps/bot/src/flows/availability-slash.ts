import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ModalBuilder,
  ModalSubmitInteraction, TextInputBuilder, TextInputStyle, MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { formatWindows, parseAvailabilityText, WEEKDAY_LABELS } from "../lib/availability-text.js";

export const SETAVAILABILITY_CUSTOM_IDS = {
  dayPrefix: "rec:setavail:day:",
  modalPrefix: "rec:setavail:modal:",
};

function dayRows() {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < WEEKDAY_LABELS.length; i += 4) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      WEEKDAY_LABELS.slice(i, i + 4).map((d) =>
        new ButtonBuilder().setCustomId(`${SETAVAILABILITY_CUSTOM_IDS.dayPrefix}${d.weekday}`).setLabel(d.label).setStyle(ButtonStyle.Secondary),
      ),
    ));
  }
  return rows;
}

export async function handleSetAvailabilitySlash(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let current: Awaited<ReturnType<typeof recApi.getSchedulingProfile>> | null = null;
  try {
    current = await recApi.getSchedulingProfile({ guildId: interaction.guildId, discordId: interaction.user.id });
  } catch {
    current = null;
  }

  const byWeekday = new Map<number, Array<{ startMinute: number; endMinute: number }>>();
  for (const w of current?.windows ?? []) byWeekday.set(w.weekday, [...(byWeekday.get(w.weekday) ?? []), { startMinute: w.startMinute, endMinute: w.endMinute }]);
  const summary = WEEKDAY_LABELS.map((d) => `**${d.label}**: ${formatWindows(byWeekday.get(d.weekday) ?? [])}`).join("\n");
  const timezoneNote = current?.profile?.timezone ? `Timezone: **${current.profile.timezone}**` : "⚠️ You haven't set a timezone yet — run `/settimezone` first.";

  await interaction.editReply({
    content: `${timezoneNote}\n\nTap a day to set when you're normally available (e.g. "6pm-9pm, 10pm-12am" or "off"):\n\n${summary}`,
    components: dayRows(),
  });
}

export async function handleSetAvailabilityDay(interaction: ButtonInteraction) {
  const weekday = Number(interaction.customId.slice(SETAVAILABILITY_CUSTOM_IDS.dayPrefix.length));
  const label = WEEKDAY_LABELS.find((d) => d.weekday === weekday)?.label ?? "this day";
  const modal = new ModalBuilder()
    .setCustomId(`${SETAVAILABILITY_CUSTOM_IDS.modalPrefix}${weekday}`)
    .setTitle(`${label} availability`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("windows")
          .setLabel('Windows, e.g. "6pm-9pm, 10pm-12am", or "off"')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("6pm-9pm")
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleSetAvailabilityModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const weekday = Number(interaction.customId.slice(SETAVAILABILITY_CUSTOM_IDS.modalPrefix.length));
  const raw = interaction.fields.getTextInputValue("windows");
  const parsed = parseAvailabilityText(raw);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if ("error" in parsed) return interaction.editReply({ content: parsed.error });

  const label = WEEKDAY_LABELS.find((d) => d.weekday === weekday)?.label ?? "That day";
  try {
    await recApi.setSchedulingWindows({ guildId: interaction.guildId, discordId: interaction.user.id, leagueScoped: false, weekday, windows: parsed.windows });
    await interaction.editReply({ content: `${label}: ${formatWindows(parsed.windows)}. Run \`/setavailability\` again to set another day.` });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to save your availability." });
  }
}
