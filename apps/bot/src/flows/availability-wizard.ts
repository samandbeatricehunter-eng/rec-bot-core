// In-place (single ephemeral message, interaction.update between steps) availability wizard.
// Replaces the old /setavailability day-grid+modal flow and the League Availability panel's
// "This Week" flow -- both now fold into this one wizard so there's a single UI for both
// routine (recurring weekly) and temporary (this-week override) availability instead of two
// drifting implementations of the same idea.
import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ModalBuilder,
  ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction,
  TextInputBuilder, TextInputStyle, MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { formatWindows, parseAvailabilityText, WEEKDAY_LABELS } from "../lib/availability-text.js";
import { ExpiringSessionStore } from "../lib/session-timeout.js";
import { ZONE_OPTIONS } from "./settimezone-slash.js";

export const AVAILABILITY_WIZARD_CUSTOM_IDS = {
  modeRoutine: "rec:availwiz:mode:routine",
  modeTemporary: "rec:availwiz:mode:temporary",
  dayPrefix: "rec:availwiz:day:",
  datePrefix: "rec:availwiz:date:",
  dayModalPrefix: "rec:availwiz:daymodal:",
  dateModalPrefix: "rec:availwiz:datemodal:",
  next: "rec:availwiz:next",
  back: "rec:availwiz:back",
  done: "rec:availwiz:done",
  tzSelect: "rec:availwiz:tzselect",
  tzOtherModal: "rec:availwiz:tzothermodal",
};

type WizardStep = "mode" | "days" | "timezone";
type WizardDraft = { step: WizardStep; mode: "routine" | "temporary" | null };

const wizardSessions = new ExpiringSessionStore<WizardDraft>();

function currentWeekDates(): Array<{ date: string; weekday: number; label: string; passed: boolean }> {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const jsDay = now.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(now.getTime());
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  const out: Array<{ date: string; weekday: number; label: string; passed: boolean }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const weekday = d.getUTCDay();
    const label = WEEKDAY_LABELS.find((w) => w.weekday === weekday)?.label.slice(0, 3) ?? "Day";
    out.push({ date: iso, weekday, label, passed: iso < todayIso });
  }
  return out;
}

function rowsOf3<T>(items: T[], toButton: (item: T) => ButtonBuilder): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < items.length; i += 3) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(items.slice(i, i + 3).map(toButton)));
  }
  return rows;
}

async function buildModeWindow(): Promise<{ content: string; components: ActionRowBuilder<ButtonBuilder>[] }> {
  return {
    content: "**Set Availability**\n\nWould you like to set your normal weekly schedule, or just adjust this week?",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.modeRoutine).setLabel("Routine (every week)").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.modeTemporary).setLabel("Temporary (this week only)").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function buildDaysWindow(interaction: { guildId: string; user: { id: string } }, mode: "routine" | "temporary"): Promise<{ content: string; components: ActionRowBuilder<ButtonBuilder>[] }> {
  const profile = await recApi.getSchedulingProfile({ guildId: interaction.guildId, discordId: interaction.user.id }).catch(() => null);

  if (mode === "routine") {
    const byWeekday = new Map<number, Array<{ startMinute: number; endMinute: number }>>();
    for (const w of profile?.windows ?? []) byWeekday.set(w.weekday, [...(byWeekday.get(w.weekday) ?? []), { startMinute: w.startMinute, endMinute: w.endMinute }]);
    const dayButtons = WEEKDAY_LABELS.map((d) => {
      const set = (byWeekday.get(d.weekday) ?? []).length > 0;
      return new ButtonBuilder()
        .setCustomId(`${AVAILABILITY_WIZARD_CUSTOM_IDS.dayPrefix}${d.weekday}`)
        .setLabel(`${set ? "✅" : "⬜"} ${d.label.slice(0, 3)}`)
        .setStyle(ButtonStyle.Secondary);
    });
    const summary = WEEKDAY_LABELS.map((d) => `**${d.label}**: ${formatWindows(byWeekday.get(d.weekday) ?? [])}`).join("\n");
    const rows = rowsOf3(dayButtons, (b) => b);
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.back).setLabel("◀ Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.next).setLabel("Next: Timezone ▶").setStyle(ButtonStyle.Primary),
    ));
    return { content: `**Routine Availability**\n\nTap a day to set when you're normally available.\n\n${summary}`, components: rows };
  }

  const week = currentWeekDates();
  // Best-effort UTC-date match against each override's startsAt -- good enough for a status
  // hint on the button label, not authoritative (getEffectiveAvailability is the source of truth).
  const overrideDates = new Set((profile?.overrides ?? []).map((o: any) => String(o.startsAt ?? "").slice(0, 10)));
  const dayButtons = week.map((d) => {
    const set = overrideDates.has(d.date);
    return new ButtonBuilder()
      .setCustomId(`${AVAILABILITY_WIZARD_CUSTOM_IDS.datePrefix}${d.date}`)
      .setLabel(`${set ? "✅" : "⬜"} ${d.label}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(d.passed);
  });
  const rows = rowsOf3(dayButtons, (b) => b);
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.back).setLabel("◀ Back").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.next).setLabel("Next: Timezone ▶").setStyle(ButtonStyle.Primary),
  ));
  return { content: "**Temporary Availability (this week)**\n\nTap a day to set an exception to your normal schedule. Already-passed days are disabled.", components: rows };
}

async function buildTimezoneWindow(interaction: { guildId: string; user: { id: string } }): Promise<{ content: string; components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> }> {
  const profile = await recApi.getSchedulingProfile({ guildId: interaction.guildId, discordId: interaction.user.id }).catch(() => null);
  const current = profile?.profile?.timezone ? `Current timezone: **${profile.profile.timezone}**` : "⚠️ You haven't set a timezone yet.";
  const select = new StringSelectMenuBuilder()
    .setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.tzSelect)
    .setPlaceholder("Choose your timezone")
    .addOptions(ZONE_OPTIONS.map((z) => ({ label: z.label, value: z.value })));
  return {
    content: `**Timezone**\n\n${current}\n\nThis is used for game scheduling on both Discord and the site.`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.back).setLabel("◀ Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.done).setLabel("Done").setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

async function renderStep(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, draft: WizardDraft) {
  if (draft.step === "mode") return buildModeWindow();
  if (draft.step === "days") return buildDaysWindow(interaction as any, draft.mode ?? "routine");
  return buildTimezoneWindow(interaction as any);
}

export async function startAvailabilityWizard(interaction: ButtonInteraction | ChatInputCommandInteraction, initialMode: "routine" | "temporary" | null = null) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const draft: WizardDraft = { step: initialMode ? "days" : "mode", mode: initialMode };
  wizardSessions.set(interaction.user.id, draft);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const view = await renderStep(interaction as any, draft);
  await interaction.editReply(view);
}

export async function handleAvailabilityWizardButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const draft = wizardSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "This wizard expired. Use the Set Availability button again.", flags: MessageFlags.Ephemeral });

  if (interaction.customId === AVAILABILITY_WIZARD_CUSTOM_IDS.modeRoutine) {
    draft.step = "days"; draft.mode = "routine";
  } else if (interaction.customId === AVAILABILITY_WIZARD_CUSTOM_IDS.modeTemporary) {
    draft.step = "days"; draft.mode = "temporary";
  } else if (interaction.customId === AVAILABILITY_WIZARD_CUSTOM_IDS.next) {
    draft.step = "timezone";
  } else if (interaction.customId === AVAILABILITY_WIZARD_CUSTOM_IDS.back) {
    draft.step = draft.step === "timezone" ? "days" : "mode";
  } else if (interaction.customId === AVAILABILITY_WIZARD_CUSTOM_IDS.done) {
    wizardSessions.delete(interaction.user.id);
    return interaction.update({ content: "✅ Availability saved.", components: [] });
  } else if (interaction.customId.startsWith(AVAILABILITY_WIZARD_CUSTOM_IDS.dayPrefix)) {
    const weekday = Number(interaction.customId.slice(AVAILABILITY_WIZARD_CUSTOM_IDS.dayPrefix.length));
    const label = WEEKDAY_LABELS.find((d) => d.weekday === weekday)?.label ?? "this day";
    const modal = new ModalBuilder()
      .setCustomId(`${AVAILABILITY_WIZARD_CUSTOM_IDS.dayModalPrefix}${weekday}`)
      .setTitle(`${label} availability`)
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("windows").setLabel('Windows, e.g. "6pm-9pm, 10pm-12am", or "off"').setStyle(TextInputStyle.Short).setPlaceholder("6pm-9pm").setRequired(true),
      ));
    return interaction.showModal(modal);
  } else if (interaction.customId.startsWith(AVAILABILITY_WIZARD_CUSTOM_IDS.datePrefix)) {
    const date = interaction.customId.slice(AVAILABILITY_WIZARD_CUSTOM_IDS.datePrefix.length);
    const modal = new ModalBuilder()
      .setCustomId(`${AVAILABILITY_WIZARD_CUSTOM_IDS.dateModalPrefix}${date}`)
      .setTitle(`Exception for ${date}`)
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("windows").setLabel('Windows (e.g. "6pm-9pm"), or "off"').setStyle(TextInputStyle.Short).setPlaceholder("off").setRequired(true),
      ));
    return interaction.showModal(modal);
  } else {
    return;
  }

  wizardSessions.set(interaction.user.id, draft);
  await interaction.deferUpdate();
  const view = await renderStep(interaction, draft);
  await interaction.editReply(view);
}

export async function handleAvailabilityWizardDayModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const draft = wizardSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "This wizard expired. Use the Set Availability button again.", flags: MessageFlags.Ephemeral });

  const weekday = Number(interaction.customId.slice(AVAILABILITY_WIZARD_CUSTOM_IDS.dayModalPrefix.length));
  const raw = interaction.fields.getTextInputValue("windows");
  const parsed = parseAvailabilityText(raw);
  if ("error" in parsed) return interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });

  try {
    await recApi.setSchedulingWindows({ guildId: interaction.guildId, discordId: interaction.user.id, leagueScoped: false, weekday, windows: parsed.windows });
  } catch (error) {
    return interaction.reply({ content: error instanceof Error ? error.message : "Failed to save your availability.", flags: MessageFlags.Ephemeral });
  }

  const view = await renderStep(interaction, draft);
  if (interaction.isFromMessage()) return interaction.update(view);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(view);
}

export async function handleAvailabilityWizardDateModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const draft = wizardSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "This wizard expired. Use the Set Availability button again.", flags: MessageFlags.Ephemeral });

  const localDate = interaction.customId.slice(AVAILABILITY_WIZARD_CUSTOM_IDS.dateModalPrefix.length);
  const raw = interaction.fields.getTextInputValue("windows");
  const parsed = parseAvailabilityText(raw);
  if ("error" in parsed) return interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });

  try {
    const profile = await recApi.getSchedulingProfile({ guildId: interaction.guildId, discordId: interaction.user.id });
    const timezone = profile.profile?.timezone ?? "America/Chicago";
    if (!parsed.windows.length) {
      await recApi.setSchedulingOverride({ guildId: interaction.guildId, discordId: interaction.user.id, scope: "week", localDate, timezone, unavailable: true });
    } else {
      for (const w of parsed.windows) {
        await recApi.setSchedulingOverride({ guildId: interaction.guildId, discordId: interaction.user.id, scope: "week", localDate, timezone, startMinute: w.startMinute, endMinute: w.endMinute % 1440, unavailable: false });
      }
    }
  } catch (error) {
    return interaction.reply({ content: error instanceof Error ? error.message : "Failed to save that exception.", flags: MessageFlags.Ephemeral });
  }

  const view = await renderStep(interaction, draft);
  if (interaction.isFromMessage()) return interaction.update(view);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(view);
}

export async function handleAvailabilityWizardTimezoneSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const draft = wizardSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "This wizard expired. Use the Set Availability button again.", flags: MessageFlags.Ephemeral });

  const choice = ZONE_OPTIONS.find((z) => z.value === interaction.values[0]);
  if (!choice) return interaction.reply({ content: "Unknown timezone selection.", flags: MessageFlags.Ephemeral });

  if (choice.value === "other") {
    const modal = new ModalBuilder()
      .setCustomId(AVAILABILITY_WIZARD_CUSTOM_IDS.tzOtherModal)
      .setTitle("Enter your timezone")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("iana_tz").setLabel("IANA timezone (e.g. Europe/London)").setStyle(TextInputStyle.Short).setPlaceholder("America/Chicago").setRequired(true),
      ));
    return interaction.showModal(modal);
  }

  try {
    await recApi.setSchedulingTimezone({ guildId: interaction.guildId, discordId: interaction.user.id, timezone: choice.iana, source: "discord_manual" });
  } catch (error) {
    return interaction.reply({ content: error instanceof Error ? error.message : "Failed to save your timezone.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const view = await renderStep(interaction, draft);
  await interaction.editReply(view);
}

export async function handleAvailabilityWizardTimezoneOtherModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const draft = wizardSessions.get(interaction.user.id);
  if (!draft) return interaction.reply({ content: "This wizard expired. Use the Set Availability button again.", flags: MessageFlags.Ephemeral });

  const iana = interaction.fields.getTextInputValue("iana_tz").trim();
  try {
    await recApi.setSchedulingTimezone({ guildId: interaction.guildId, discordId: interaction.user.id, timezone: iana, source: "discord_manual" });
  } catch (error) {
    return interaction.reply({ content: error instanceof Error ? error.message : "Failed to save your timezone. Make sure it's a valid IANA zone name.", flags: MessageFlags.Ephemeral });
  }

  const view = await renderStep(interaction, draft);
  if (interaction.isFromMessage()) return interaction.update(view);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(view);
}
