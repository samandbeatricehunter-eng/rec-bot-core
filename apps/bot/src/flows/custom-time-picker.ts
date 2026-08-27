// Discord modals can only contain text inputs -- there is no native date/time picker component
// available inside a ModalBuilder. This gives Propose Time / Counter real dropdown pickers
// instead: Today/Tomorrow/+2 days plus a "Custom date" fallback (a one-field date modal, since
// far-future dates aren't worth a long dropdown), a 24-hour dropdown, and a minute dropdown.
import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ModalBuilder, ModalSubmitInteraction,
  StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { recApi } from "../lib/rec-api.js";

export const CUSTOM_TIME_PICKER_CUSTOM_IDS = {
  date: "rec:gamesched:ctp:date:",
  hour: "rec:gamesched:ctp:hour:",
  minute: "rec:gamesched:ctp:minute:",
  submit: "rec:gamesched:ctp:submit:",
  customDateModal: "rec:gamesched:ctp:datemodal:",
};

type Session = {
  kind: "propose" | "counter";
  gameId: string;
  proposalId?: string;
  discordId: string;
  localDate: string; // YYYY-MM-DD
  hour: number; // 0-23
  minute: string; // "00" | "15" | "30" | "45"
};

const sessions = new Map<string, Session>();
let tokenCounter = 0;
function newToken(): string {
  tokenCounter = (tokenCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${tokenCounter.toString(36)}`;
}

function quickDates(): Array<{ label: string; date: string }> {
  const out: Array<{ label: string; date: string }> = [];
  const now = new Date();
  const labels = ["Today", "Tomorrow"];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    out.push({ label: labels[i] ?? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), date: d.toISOString().slice(0, 10) });
  }
  return out;
}

function fmtHour(h: number): string {
  const meridiem = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${meridiem}`;
}

function buildPickerMessage(token: string, session: Session) {
  const days = quickDates();
  const isQuickDate = days.some((d) => d.date === session.localDate);
  const dateSelect = new StringSelectMenuBuilder().setCustomId(`${CUSTOM_TIME_PICKER_CUSTOM_IDS.date}${token}`).setPlaceholder("Date")
    .addOptions([
      ...days.map((d) => new StringSelectMenuOptionBuilder().setLabel(d.label).setValue(d.date).setDefault(d.date === session.localDate)),
      new StringSelectMenuOptionBuilder().setLabel("Custom date…").setValue("custom").setDefault(!isQuickDate),
    ]);
  const hourSelect = new StringSelectMenuBuilder().setCustomId(`${CUSTOM_TIME_PICKER_CUSTOM_IDS.hour}${token}`).setPlaceholder("Hour")
    .addOptions(Array.from({ length: 24 }, (_, h) => h).map((h) => new StringSelectMenuOptionBuilder().setLabel(fmtHour(h)).setValue(String(h)).setDefault(h === session.hour)));
  const minuteSelect = new StringSelectMenuBuilder().setCustomId(`${CUSTOM_TIME_PICKER_CUSTOM_IDS.minute}${token}`).setPlaceholder("Minute")
    .addOptions(["00", "15", "30", "45"].map((m) => new StringSelectMenuOptionBuilder().setLabel(m).setValue(m).setDefault(m === session.minute)));

  const dateLabel = days.find((d) => d.date === session.localDate)?.label ?? session.localDate;
  return {
    content: `Selected: **${dateLabel} at ${fmtHour(session.hour)}:${session.minute}**\nAdjust below, then hit Submit.`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dateSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(hourSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(minuteSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_TIME_PICKER_CUSTOM_IDS.submit}${token}`).setLabel("Submit").setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

export async function openCustomTimePicker(interaction: StringSelectMenuInteraction, kind: "propose" | "counter", gameId: string, proposalId?: string) {
  const token = newToken();
  const session: Session = { kind, gameId, proposalId, discordId: interaction.user.id, localDate: quickDates()[0]!.date, hour: 20, minute: "00" };
  sessions.set(token, session);
  await interaction.update(buildPickerMessage(token, session));
}

function tokenFrom(prefix: string, customId: string): string {
  return customId.slice(prefix.length);
}

export async function handleCustomTimeDateSelect(interaction: StringSelectMenuInteraction) {
  const token = tokenFrom(CUSTOM_TIME_PICKER_CUSTOM_IDS.date, interaction.customId);
  const session = sessions.get(token);
  if (!session) return interaction.update({ content: "This picker expired — reopen it from Propose Time / Counter.", components: [] });
  const value = interaction.values[0]!;
  if (value === "custom") {
    const modal = new ModalBuilder()
      .setCustomId(`${CUSTOM_TIME_PICKER_CUSTOM_IDS.customDateModal}${token}`)
      .setTitle("Custom date")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("date").setLabel("Date (YYYY-MM-DD)").setStyle(TextInputStyle.Short).setPlaceholder(session.localDate).setRequired(true),
      ));
    await interaction.showModal(modal);
    return;
  }
  session.localDate = value;
  await interaction.update(buildPickerMessage(token, session));
}

export async function handleCustomTimeDateModal(interaction: ModalSubmitInteraction) {
  if (!interaction.isFromMessage()) return;
  const token = tokenFrom(CUSTOM_TIME_PICKER_CUSTOM_IDS.customDateModal, interaction.customId);
  const session = sessions.get(token);
  if (!session) return interaction.reply({ content: "This picker expired — reopen it from Propose Time / Counter.", ephemeral: true });
  const raw = interaction.fields.getTextInputValue("date").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return interaction.reply({ content: 'Date must be YYYY-MM-DD, e.g. "2026-09-01".', ephemeral: true });
  }
  session.localDate = raw;
  await interaction.update(buildPickerMessage(token, session));
}

export async function handleCustomTimeHourSelect(interaction: StringSelectMenuInteraction) {
  const token = tokenFrom(CUSTOM_TIME_PICKER_CUSTOM_IDS.hour, interaction.customId);
  const session = sessions.get(token);
  if (!session) return interaction.update({ content: "This picker expired — reopen it from Propose Time / Counter.", components: [] });
  session.hour = Number(interaction.values[0]);
  await interaction.update(buildPickerMessage(token, session));
}

export async function handleCustomTimeMinuteSelect(interaction: StringSelectMenuInteraction) {
  const token = tokenFrom(CUSTOM_TIME_PICKER_CUSTOM_IDS.minute, interaction.customId);
  const session = sessions.get(token);
  if (!session) return interaction.update({ content: "This picker expired — reopen it from Propose Time / Counter.", components: [] });
  session.minute = interaction.values[0]!;
  await interaction.update(buildPickerMessage(token, session));
}

export async function userTimezoneOrDefault(guildId: string, discordId: string): Promise<string> {
  try {
    const profile = await recApi.getSchedulingProfile({ guildId, discordId });
    return profile.profile.timezone ?? "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

export async function handleCustomTimeSubmit(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const token = tokenFrom(CUSTOM_TIME_PICKER_CUSTOM_IDS.submit, interaction.customId);
  const session = sessions.get(token);
  if (!session) return interaction.update({ content: "This picker expired — reopen it from Propose Time / Counter.", components: [] });
  sessions.delete(token);

  const localTime = `${session.hour === 0 ? 12 : session.hour > 12 ? session.hour - 12 : session.hour}:${session.minute} ${session.hour >= 12 ? "PM" : "AM"}`;
  await interaction.update({ content: "Submitting…", components: [] });
  try {
    const timezone = await userTimezoneOrDefault(interaction.guildId, interaction.user.id);
    if (session.kind === "propose") {
      await recApi.proposeSchedulingTime({ guildId: interaction.guildId, discordId: interaction.user.id, gameId: session.gameId, localDate: session.localDate, localTime, timezone });
    } else {
      await recApi.respondToSchedulingProposal({ guildId: interaction.guildId, discordId: interaction.user.id, gameId: session.gameId, proposalId: session.proposalId!, action: "counter", localDate: session.localDate, localTime, timezone });
    }
    await interaction.editReply({ content: `${session.kind === "propose" ? "Proposed" : "Countered with"} **${session.localDate} ${localTime} (${timezone})**. Your opponent has been notified in the channel to accept or counter.`, components: [] });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "That didn't work.", components: [] }).catch(() => undefined);
  }
}
