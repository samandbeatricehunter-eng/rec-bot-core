import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type Guild,
  type StringSelectMenuInteraction,
} from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { getAnnouncementsChannel, getHeadlinesChannel } from "../lib/route-channels.js";

// Final step of the advance flow: set (or skip) the next scheduled advance time.
// Three dropdowns — date (next 7 days), timezone, and time (remaining hours) — plus
// a Back / Set Time / Skip button row. Setting a time stores it and posts an
// @everyone announcement; skipping leaves no time set and posts nothing.

export const ADVANCE_TIME_CUSTOM_IDS = {
  dateSelect: "rec:advance_time:date",
  tzSelect: "rec:advance_time:tz",
  timeSelect: "rec:advance_time:time",
  setBtn: "rec:advance_time:set",
  skipBtn: "rec:advance_time:skip",
  backBtn: "rec:advance_time:back",
} as const;

const TZ_LABEL_TO_IANA: Record<string, string> = {
  EST: "America/New_York",
  CST: "America/Chicago",
  PST: "America/Los_Angeles",
  AKST: "America/Anchorage",
};
const TZ_LABELS = Object.keys(TZ_LABEL_TO_IANA);
const DEFAULT_TZ = "CST";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type AdvanceTimeSession = {
  guildId: string;
  userId: string;
  headline: string;
  completedSeasonNumber: number;
  completedWeekNumber: number;
  selectedDate: string | null; // YYYY-MM-DD in the selected timezone
  selectedTz: string;
  selectedHour: number | null; // 0–23
};

const sessions = new Map<string, AdvanceTimeSession>();
const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

// ─── Date / time helpers (timezone-aware) ──────────────────────────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function dateValue(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function nowPartsInTz(tzLabel: string): { year: number; month: number; day: number; hour: number } {
  const timeZone = TZ_LABEL_TO_IANA[tzLabel] ?? TZ_LABEL_TO_IANA[DEFAULT_TZ];
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date())) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return { year: +map.year, month: +map.month, day: +map.day, hour: +map.hour };
}

function buildDateChoices(tzLabel: string): { value: string; label: string }[] {
  const now = nowPartsInTz(tzLabel);
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const base = new Date(Date.UTC(now.year, now.month - 1, now.day + i));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    const wd = WEEKDAYS[base.getUTCDay()];
    const pretty = `${wd} ${MONTHS[m - 1]} ${d}`;
    const label = i === 0 ? `Today · ${pretty}` : i === 1 ? `Tomorrow · ${pretty}` : pretty;
    out.push({ value: dateValue(y, m, d), label });
  }
  return out;
}

function hourLabel(h: number) {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}

// Available hours for the chosen date: if it's today (in the chosen tz), only
// hours that haven't already started; otherwise the full day.
function buildHourChoices(tzLabel: string, selectedDate: string | null): number[] {
  const now = nowPartsInTz(tzLabel);
  const todayValue = dateValue(now.year, now.month, now.day);
  const isToday = selectedDate === todayValue;
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) {
    if (isToday && h <= now.hour) continue;
    hours.push(h);
  }
  return hours;
}

// Spell out the scheduled time in every timezone we offer, so it's unambiguous
// regardless of each member's own Discord timezone.
function formatAllZones(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return TZ_LABELS.map((tz) => {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ_LABEL_TO_IANA[tz],
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
    return `**${tz}:** ${s}`;
  }).join("\n");
}

function describeSelection(session: AdvanceTimeSession): string {
  const datePretty = (() => {
    if (!session.selectedDate) return "—";
    const [y, m, d] = session.selectedDate.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, d));
    return `${WEEKDAYS[base.getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
  })();
  const timePretty = session.selectedHour == null ? "—" : hourLabel(session.selectedHour);
  return `**Date:** ${datePretty}\n**Timezone:** ${session.selectedTz}\n**Time:** ${timePretty}`;
}

// ─── Rendering ──────────────────────────────────────────────────────────────────

function renderStep(session: AdvanceTimeSession) {
  // Reconcile state with what's currently selectable (tz changes can shift "today").
  const dateChoices = buildDateChoices(session.selectedTz);
  if (session.selectedDate && !dateChoices.some((c) => c.value === session.selectedDate)) {
    session.selectedDate = null;
  }
  const hourChoices = buildHourChoices(session.selectedTz, session.selectedDate);
  if (session.selectedHour != null && !hourChoices.includes(session.selectedHour)) {
    session.selectedHour = null;
  }

  const embed = new EmbedBuilder()
    .setTitle("Set Next Advance Time")
    .setColor(0x3498db)
    .setDescription(
      `${session.headline}\n\n` +
      "Pick when the **next advance** happens, then press **Set Time** to save and announce it — or **Skip** to set no time.\n\n" +
      describeSelection(session),
    );

  const dateMenu = new StringSelectMenuBuilder()
    .setCustomId(ADVANCE_TIME_CUSTOM_IDS.dateSelect)
    .setPlaceholder("Select date (next 7 days)")
    .addOptions(
      dateChoices.map((c) =>
        new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.value).setDefault(c.value === session.selectedDate),
      ),
    );

  const tzMenu = new StringSelectMenuBuilder()
    .setCustomId(ADVANCE_TIME_CUSTOM_IDS.tzSelect)
    .setPlaceholder("Select timezone")
    .addOptions(
      TZ_LABELS.map((tz) =>
        new StringSelectMenuOptionBuilder().setLabel(tz).setValue(tz).setDefault(tz === session.selectedTz),
      ),
    );

  const timeMenu = new StringSelectMenuBuilder().setCustomId(ADVANCE_TIME_CUSTOM_IDS.timeSelect);
  if (hourChoices.length === 0) {
    timeMenu
      .setPlaceholder("No times left today — choose a later date")
      .setDisabled(true)
      .addOptions(new StringSelectMenuOptionBuilder().setLabel("—").setValue("__none__"));
  } else {
    timeMenu
      .setPlaceholder("Select time")
      .addOptions(
        hourChoices.map((h) =>
          new StringSelectMenuOptionBuilder().setLabel(hourLabel(h)).setValue(String(h)).setDefault(h === session.selectedHour),
        ),
      );
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dateMenu),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tzMenu),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(timeMenu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ADVANCE_TIME_CUSTOM_IDS.backBtn).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ADVANCE_TIME_CUSTOM_IDS.setBtn).setLabel("Set Time").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(ADVANCE_TIME_CUSTOM_IDS.skipBtn).setLabel("Skip").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ─── Entry point (called by the advance wizard once the week has flipped) ───────

export async function enterAdvanceTimeStep(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  headline: string,
  completed: { seasonNumber: number; weekNumber: number },
) {
  if (!interaction.inCachedGuild()) return;
  const session: AdvanceTimeSession = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    headline,
    completedSeasonNumber: completed.seasonNumber,
    completedWeekNumber: completed.weekNumber,
    selectedDate: null,
    selectedTz: DEFAULT_TZ,
    selectedHour: null,
  };
  sessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
  return interaction.editReply(renderStep(session));
}

// ─── Dropdown handlers ──────────────────────────────────────────────────────────

async function handleSelect(interaction: StringSelectMenuInteraction, apply: (s: AdvanceTimeSession) => void) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  if (!session) {
    return interaction.reply({ content: "This advance step expired. Reopen League Mgmt → Advance.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  apply(session);
  return interaction.editReply(renderStep(session));
}

export function handleAdvanceTimeDateSelect(interaction: StringSelectMenuInteraction) {
  return handleSelect(interaction, (s) => { s.selectedDate = interaction.values[0] ?? null; });
}

export function handleAdvanceTimeTzSelect(interaction: StringSelectMenuInteraction) {
  return handleSelect(interaction, (s) => { s.selectedTz = interaction.values[0] ?? DEFAULT_TZ; });
}

export function handleAdvanceTimeTimeSelect(interaction: StringSelectMenuInteraction) {
  return handleSelect(interaction, (s) => {
    const v = interaction.values[0];
    s.selectedHour = v && v !== "__none__" ? Number(v) : null;
  });
}

// ─── Button handlers ──────────────────────────────────────────────────────────

// Always announce the advance to @everyone on the announcements channel. If a
// next-advance time was set, include it spelled out in all four timezones.
async function announceAdvance(guild: Guild, guildId: string, headline: string, epochSeconds: number | null): Promise<boolean> {
  try {
    const cfg = await recApi.getEconomyConfig(guildId).catch(() => null);
    const channel = await getAnnouncementsChannel(guild, cfg?.routes ?? {});
    if (!channel) return false;
    const lines = [headline];
    if (epochSeconds != null) {
      lines.push("", `**Next advance** (<t:${epochSeconds}:R>):`, formatAllZones(epochSeconds));
    }
    await channel.send({
      content: "@everyone",
      embeds: [new EmbedBuilder().setTitle("📣 League Advanced").setColor(0x2ecc71).setDescription(lines.join("\n"))],
      allowedMentions: { parse: ["everyone"] },
    });
    return true;
  } catch {
    return false;
  }
}

function formatTier(tier?: string | null) {
  const normalized = String(tier ?? "normal");
  return normalized === "normal" ? "" : ` (${normalized})`;
}

function buildStoryEmbed(story: any) {
  const notes = Array.isArray(story.notes) ? story.notes.filter(Boolean) : [];
  const badgeLines = (Array.isArray(story.badges) ? story.badges : [])
    .slice(0, 8)
    .map((badge: any) => {
      const team = badge.teamName ? `${badge.teamName}: ` : "";
      return `${team}${badge.badgeLabel ?? badge.badgeKey ?? "Badge"}${formatTier(badge.tier)}`;
    });

  const embed = new EmbedBuilder()
    .setTitle(String(story.headline ?? "REC Game Story").slice(0, 256))
    .setColor(0xf1c40f)
    .setDescription(String(story.body ?? "Game story generated from the approved box score.").slice(0, 4096))
    .setFooter({ text: `Season ${story.season}, Week ${story.week}` });

  if (notes.length) embed.addFields({ name: "Key Notes", value: notes.slice(0, 3).join("\n").slice(0, 1024) });
  if (badgeLines.length) embed.addFields({ name: "Badges", value: badgeLines.join("\n").slice(0, 1024) });
  return embed;
}

async function publishAdvanceHeadlines(guild: Guild, session: AdvanceTimeSession): Promise<{ posted: number; configured: boolean }> {
  try {
    const cfg = await recApi.getEconomyConfig(session.guildId).catch(() => null);
    const channel = await getHeadlinesChannel(guild, cfg?.routes ?? {});
    if (!channel) return { posted: 0, configured: false };

    const result = await recApi.listAdvanceStories({
      guildId: session.guildId,
      seasonNumber: session.completedSeasonNumber,
      weekNumber: session.completedWeekNumber,
    });
    const stories: any[] = result?.stories ?? [];
    let posted = 0;
    for (const story of stories) {
      const message = await channel.send({ embeds: [buildStoryEmbed(story)] });
      posted += 1;
      await recApi.markAdvanceStoryPosted({
        guildId: session.guildId,
        storyId: story.id,
        channelId: channel.id,
        messageId: message.id,
      }).catch((error) => {
        console.error("[ERROR] Failed to stamp posted game story (non-fatal):", error);
      });
    }
    return { posted, configured: true };
  } catch (error) {
    console.error("[ERROR] Failed to publish advance headlines (non-fatal):", error);
    return { posted: 0, configured: true };
  }
}

function headlinePublishLine(result: { posted: number; configured: boolean }) {
  if (result.posted > 0) return `\n\nPosted **${result.posted}** game headline${result.posted === 1 ? "" : "s"}.`;
  if (!result.configured) return "\n\nNo headlines channel is configured, so game stories were not posted.";
  return "\n\nNo new game headlines were ready to post.";
}

export async function handleAdvanceTimeSet(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can set the advance time.", flags: MessageFlags.Ephemeral });
  }
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  if (!session) {
    return interaction.reply({ content: "This advance step expired. Reopen League Mgmt → Advance.", flags: MessageFlags.Ephemeral });
  }
  if (!session.selectedDate || session.selectedHour == null) {
    return interaction.reply({ content: "Pick a date, timezone, and time first — or press Skip.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();
  const [year, month, day] = session.selectedDate.split("-").map(Number);

  let result: { epochSeconds: number; tzLabel: string };
  try {
    result = await recApi.setNextAdvance({
      guildId: session.guildId,
      year,
      month,
      day,
      hour: session.selectedHour,
      minute: 0,
      tzLabel: session.selectedTz,
    });
  } catch (err) {
    // Keep the picker open so the commissioner can adjust and retry.
    const step = renderStep(session);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Couldn't set advance time").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: step.components,
    });
  }

  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));

  const headlines = await publishAdvanceHeadlines(interaction.guild, session);
  const announced = await announceAdvance(interaction.guild, session.guildId, session.headline, result.epochSeconds);
  const announcementLine = announced
    ? "\n\nPosted to the announcements channel."
    : "\n\nNo announcements channel is configured, so the advance announcement was not posted.";

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Next Advance Time Set ✅")
      .setColor(0x2ecc71)
      .setDescription(
        `${session.headline}\n\n**Next advance** (<t:${result.epochSeconds}:R>):\n${formatAllZones(result.epochSeconds)}` +
        announcementLine +
        headlinePublishLine(headlines),
      )],
    components: buildAdvanceRows(),
  });
}

export async function handleAdvanceTimeSkip(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  const headline = session?.headline ?? "League advanced.";
  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  const headlines = session ? await publishAdvanceHeadlines(interaction.guild, session) : { posted: 0, configured: true };
  await announceAdvance(interaction.guild, interaction.guildId, headline, null);
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Week Advanced")
      .setColor(0x95a5a6)
      .setDescription(`${headline}\n\nNo next advance time was set. The advance was announced to @everyone.${headlinePublishLine(headlines)}`)],
    components: buildAdvanceRows(),
  });
}

export async function handleAdvanceTimeBack(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  const headline = session?.headline ?? "League advanced.";
  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  const headlines = session ? await publishAdvanceHeadlines(interaction.guild, session) : { posted: 0, configured: true };
  await announceAdvance(interaction.guild, interaction.guildId, headline, null);
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Week Advanced")
      .setColor(0x95a5a6)
      .setDescription(`${headline}\n\nReturned without setting a next advance time. The advance was announced to @everyone.${headlinePublishLine(headlines)}`)],
    components: buildAdvanceRows(),
  });
}
