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
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { getAnnouncementsChannel, getHeadlinesChannel, getPowerRankingsChannel } from "../lib/route-channels.js";
import { formatTierEmojiPrefix } from "../lib/tier-emojis.js";

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

// Final step of the advance flow: confirm sending per-coach "what changed for you"
// Advance DMs. These buttons live on the commissioner's menu-session message.
export const ADVANCE_DM_CUSTOM_IDS = {
  send: "rec:advance_dm:send", // + :season:week (labels only; API uses the latest run)
  skip: "rec:advance_dm:skip",
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
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
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

async function publishSeasonXfSummary(guild: Guild, session: AdvanceTimeSession): Promise<number> {
  if (session.completedWeekNumber !== 18) return 0;
  try {
    const cfg = await recApi.getEconomyConfig(session.guildId).catch(() => null);
    const channel = await getAnnouncementsChannel(guild, cfg?.routes ?? {});
    if (!channel || !("send" in channel) || !channel.isTextBased()) return 0;

    const result = await recApi.getSeasonXfBadges(session.guildId, session.completedSeasonNumber).catch(() => null);
    const badges: any[] = result?.badges ?? [];
    if (!badges.length) return 0;

    const byUser = new Map<string, any[]>();
    for (const badge of badges) {
      const key = badge.user_id ?? badge.discordId ?? badge.displayName ?? "coach";
      const rows = byUser.get(key) ?? [];
      rows.push(badge);
      byUser.set(key, rows);
    }

    const lines = [...byUser.values()].map((rows) => {
      const first = rows[0];
      const user = first.discordId ? `<@${first.discordId}>` : first.displayName ?? "Coach";
      const team = first.teamName ? ` (${first.teamName})` : "";
      const badgeLines = rows.map((badge) => {
        const earns = badge.earned_count ? `${badge.earned_count} earns` : "XF season performance";
        return `- **${badge.badgeLabel ?? badge.badge_key}**: ${badge.badgeDescription ?? "Season badge"} (${earns})`;
      });
      return [`**${user}${team}**`, ...badgeLines].join("\n");
    });

    await channel.send({
      content: "@everyone",
      embeds: [new EmbedBuilder()
        .setTitle(`Season ${session.completedSeasonNumber} XF Badge Class`)
        .setColor(0xffd700)
        .setDescription(lines.join("\n\n").slice(0, 4096))],
      allowedMentions: { parse: ["everyone", "users"] },
    });
    return badges.length;
  } catch (error) {
    console.error("[ERROR] Failed to publish season XF summary (non-fatal):", error);
    return 0;
  }
}

export const HEADLINES_CUSTOM_IDS = {
  prevPrefix: "rec:headlines:prev:",
  nextPrefix: "rec:headlines:next:",
} as const;

// Custom ID format: rec:headlines:prev/next:guildId:season:week:currentPage
function buildHeadlinesNavId(dir: "prev" | "next", guildId: string, season: number, week: number, page: number) {
  return `rec:headlines:${dir}:${guildId}:${season}:${week}:${page}`;
}

function buildStoryEmbed(story: any, page: number, total: number, season: number, week: number) {
  const notes = Array.isArray(story.notes) ? story.notes.filter(Boolean) : [];
  const badgeLines = (Array.isArray(story.badges) ? story.badges : [])
    .slice(0, 8)
    .map((badge: any) => {
      const team = badge.teamName ? `${badge.teamName}: ` : "";
      return `${team}${formatTierEmojiPrefix(badge.tier)}${badge.badgeLabel ?? badge.badgeKey ?? "Badge"}`;
    });

  const embed = new EmbedBuilder()
    .setTitle(`📰 Season ${season}, Week ${week} Headlines`)
    .setColor(0xf1c40f)
    .addFields({ name: story.headline ?? "Game Story", value: String(story.body ?? "Game story generated from the approved box score.").slice(0, 1024) });

  if (notes.length) embed.addFields({ name: "Key Notes", value: notes.slice(0, 3).join("\n").slice(0, 1024) });
  if (badgeLines.length) embed.addFields({ name: "Badges Earned", value: badgeLines.join("\n").slice(0, 1024) });
  embed.setFooter({ text: `Story ${page + 1} of ${total}` });
  return embed;
}

function buildHeadlinesNavRow(guildId: string, season: number, week: number, page: number, total: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildHeadlinesNavId("prev", guildId, season, week, page))
      .setLabel("◀ Prev")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildHeadlinesNavId("next", guildId, season, week, page))
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Secondary),
  );
}

type HeadlinePublishResult = {
  posted: number;
  configured: boolean;
  accessible: boolean;
};

type PowerRankingsPublishResult = {
  posted: boolean;
  configured: boolean;
  accessible: boolean;
  count: number;
};

async function publishAdvanceHeadlines(guild: Guild, session: AdvanceTimeSession): Promise<HeadlinePublishResult> {
  try {
    const cfg = await recApi.getEconomyConfig(session.guildId).catch(() => null);
    const channelId = cfg?.routes?.headlines_channel_id ?? null;
    if (!channelId) return { posted: 0, configured: false, accessible: false };

    const channel = await getHeadlinesChannel(guild, cfg?.routes ?? {});
    if (!channel) return { posted: 0, configured: true, accessible: false };

    const result = await recApi.listAdvanceStories({
      guildId: session.guildId,
      seasonNumber: session.completedSeasonNumber,
      weekNumber: session.completedWeekNumber,
    });
    const stories: any[] = result?.stories ?? [];
    if (!stories.length) return { posted: 0, configured: true, accessible: true };

    const season = session.completedSeasonNumber;
    const week = session.completedWeekNumber;
    const total = stories.length;

    const message = await channel.send({
      content: "@everyone",
      embeds: [buildStoryEmbed(stories[0], 0, total, season, week)],
      components: total > 1 ? [buildHeadlinesNavRow(session.guildId, season, week, 0, total)] : [],
    });

    // Mark all stories as posted with the single message they now share.
    for (const story of stories) {
      await recApi.markAdvanceStoryPosted({
        guildId: session.guildId,
        storyId: story.id,
        channelId: channel.id,
        messageId: message.id,
      }).catch((error) => {
        console.error("[ERROR] Failed to stamp posted game story (non-fatal):", error);
      });
    }
    return { posted: total, configured: true, accessible: true };
  } catch (error) {
    console.error("[ERROR] Failed to publish advance headlines (non-fatal):", error);
    return { posted: 0, configured: true, accessible: true };
  }
}

export async function handleHeadlinesNav(interaction: ButtonInteraction, dir: "prev" | "next") {
  if (!interaction.inCachedGuild()) return;
  const parts = interaction.customId.split(":");
  // format: rec:headlines:dir:guildId:season:week:page  (indices 0-6)
  const guildId = parts[3];
  const season = Number(parts[4]);
  const week = Number(parts[5]);
  const currentPage = Number(parts[6]);
  if (!guildId || isNaN(season) || isNaN(week) || isNaN(currentPage)) return;

  const nextPage = dir === "next" ? currentPage + 1 : currentPage - 1;

  const result = await recApi.listAdvanceStories({ guildId, seasonNumber: season, weekNumber: week, includePosted: true }).catch(() => null);
  const stories: any[] = result?.stories ?? [];
  if (!stories.length) return interaction.update({});

  const safePage = ((nextPage % stories.length) + stories.length) % stories.length;
  await interaction.update({
    embeds: [buildStoryEmbed(stories[safePage], safePage, stories.length, season, week)],
    components: [buildHeadlinesNavRow(guildId, season, week, safePage, stories.length)],
  });
}

function headlinePublishLine(result: HeadlinePublishResult) {
  if (result.posted > 0) return `\n\nPosted **${result.posted}** game headline${result.posted === 1 ? "" : "s"}.`;
  if (!result.configured) return "\n\nNo headlines channel is configured, so game stories were not posted.";
  if (!result.accessible) return "\n\nA headlines channel is configured, but I couldn't access it. Check the bot's channel permissions.";
  return "\n\nNo new game headlines were ready to post.";
}

function formatPowerRankingMovement(change: number | null | undefined) {
  if (change == null) return "new";
  if (change > 0) return `up ${change}`;
  if (change < 0) return `down ${Math.abs(change)}`;
  return "same";
}

function buildPowerRankingsEmbed(rankings: any, session: AdvanceTimeSession) {
  const teams: any[] = Array.isArray(rankings?.teams) ? rankings.teams : [];
  const lines = teams.slice(0, 32).map((team) => {
    const humanMarker = team.isHuman ? " *" : "";
    return `#${team.rank} ${team.teamName}${humanMarker} - ${formatPowerRankingMovement(team.change)} (${Number(team.score ?? 0).toFixed(3)})`;
  });
  const topHalf = lines.slice(0, 16).join("\n") || "No rankings available.";
  const bottomHalf = lines.slice(16).join("\n");
  const embed = new EmbedBuilder()
    .setTitle(`Power Rankings - Season ${session.completedSeasonNumber}, Week ${session.completedWeekNumber}`)
    .setColor(0x9b59b6)
    .setDescription(rankings?.hasPreviousWeek ? "Movement is compared to the previous completed week." : "First snapshot for this season.")
    .addFields({ name: "Rankings", value: topHalf.slice(0, 1024), inline: false });
  if (bottomHalf) embed.addFields({ name: "Continued", value: bottomHalf.slice(0, 1024), inline: false });
  embed.setFooter({ text: "* = linked user team" });
  return embed;
}

async function publishPowerRankings(guild: Guild, session: AdvanceTimeSession): Promise<PowerRankingsPublishResult> {
  if (session.completedWeekNumber < 1 || session.completedWeekNumber > 22) {
    return { posted: false, configured: true, accessible: true, count: 0 };
  }
  try {
    const cfg = await recApi.getEconomyConfig(session.guildId).catch(() => null);
    const channelId = cfg?.routes?.power_rankings_channel_id ?? null;
    if (!channelId) return { posted: false, configured: false, accessible: false, count: 0 };
    const channel = await getPowerRankingsChannel(guild, cfg?.routes ?? {});
    if (!channel) return { posted: false, configured: true, accessible: false, count: 0 };

    const rankings = await recApi.getPowerRankings(session.guildId, null, session.completedWeekNumber);
    const teams: any[] = Array.isArray(rankings?.teams) ? rankings.teams : [];
    if (!teams.length) return { posted: false, configured: true, accessible: true, count: 0 };
    await channel.send({
      content: "@everyone",
      embeds: [buildPowerRankingsEmbed(rankings, session)],
      allowedMentions: { parse: ["everyone"] },
    });
    return { posted: true, configured: true, accessible: true, count: teams.length };
  } catch (error) {
    console.error("[ERROR] Failed to publish power rankings (non-fatal):", error);
    return { posted: false, configured: true, accessible: true, count: 0 };
  }
}

function powerRankingsPublishLine(result: PowerRankingsPublishResult) {
  if (result.posted) return `\n\nPosted power rankings for **${result.count}** team${result.count === 1 ? "" : "s"}.`;
  if (!result.configured) return "\n\nNo power rankings channel is configured, so rankings were not posted.";
  if (!result.accessible) return "\n\nA power rankings channel is configured, but I couldn't access it. Check the bot's channel permissions.";
  return "\n\nNo power rankings were ready to post.";
}

export async function handleAdvanceTimeSet(interaction: ButtonInteraction, _buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
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
  const powerRankings = await publishPowerRankings(interaction.guild, session);
  const announced = await announceAdvance(interaction.guild, session.guildId, session.headline, result.epochSeconds);
  const xfPosted = await publishSeasonXfSummary(interaction.guild, session);
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
        headlinePublishLine(headlines) +
        powerRankingsPublishLine(powerRankings) +
        (xfPosted ? `\n\nPosted **${xfPosted}** XF season badge announcement${xfPosted === 1 ? "" : "s"}.` : "") +
        advanceDmPromptLine(),
      )],
    components: [buildAdvanceDmConfirmRow(session.completedSeasonNumber, session.completedWeekNumber)],
  });
}

export async function handleAdvanceTimeSkip(interaction: ButtonInteraction, _buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  const headline = session?.headline ?? "League advanced.";
  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  const headlines = session ? await publishAdvanceHeadlines(interaction.guild, session) : { posted: 0, configured: true, accessible: true };
  const powerRankings = session ? await publishPowerRankings(interaction.guild, session) : { posted: false, configured: true, accessible: true, count: 0 };
  await announceAdvance(interaction.guild, interaction.guildId, headline, null);
  const xfPosted = session ? await publishSeasonXfSummary(interaction.guild, session) : 0;
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Week Advanced")
      .setColor(0x95a5a6)
      .setDescription(`${headline}\n\nNo next advance time was set. The advance was announced to @everyone.${headlinePublishLine(headlines)}${powerRankingsPublishLine(powerRankings)}${xfPosted ? `\n\nPosted **${xfPosted}** XF season badge announcement${xfPosted === 1 ? "" : "s"}.` : ""}${advanceDmPromptLine()}`)],
    components: [buildAdvanceDmConfirmRow(session?.completedSeasonNumber ?? 0, session?.completedWeekNumber ?? 0)],
  });
}

export async function handleAdvanceTimeBack(interaction: ButtonInteraction, _buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  const session = sessions.get(sessionKey(interaction.guildId, interaction.user.id));
  const headline = session?.headline ?? "League advanced.";
  sessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  const headlines = session ? await publishAdvanceHeadlines(interaction.guild, session) : { posted: 0, configured: true, accessible: true };
  const powerRankings = session ? await publishPowerRankings(interaction.guild, session) : { posted: false, configured: true, accessible: true, count: 0 };
  await announceAdvance(interaction.guild, interaction.guildId, headline, null);
  const xfPosted = session ? await publishSeasonXfSummary(interaction.guild, session) : 0;
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Week Advanced")
      .setColor(0x95a5a6)
      .setDescription(`${headline}\n\nReturned without setting a next advance time. The advance was announced to @everyone.${headlinePublishLine(headlines)}${powerRankingsPublishLine(powerRankings)}${xfPosted ? `\n\nPosted **${xfPosted}** XF season badge announcement${xfPosted === 1 ? "" : "s"}.` : ""}${advanceDmPromptLine()}`)],
    components: [buildAdvanceDmConfirmRow(session?.completedSeasonNumber ?? 0, session?.completedWeekNumber ?? 0)],
  });
}

// ─── Advance DMs (final confirmation step) ──────────────────────────────────────

function advanceDmPromptLine(): string {
  return "\n\n**Final step:** send each active, linked coach a DM summarizing their transactions, payouts, badge changes, EOS progress, and power-ranking movement this advance — or skip.";
}

function buildAdvanceDmConfirmRow(season: number, week: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${ADVANCE_DM_CUSTOM_IDS.send}:${season}:${week}`).setLabel("Send Advance DMs").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${ADVANCE_DM_CUSTOM_IDS.skip}:${season}:${week}`).setLabel("Skip DMs").setStyle(ButtonStyle.Secondary),
  );
}

function buildAdvanceDmEmbed(user: any, payload: any): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Week ${payload.fromWeek ?? "?"} Advance Summary`)
    .setColor(0x3498db)
    .setDescription(`Here's what changed for you this advance${payload.toWeek ? ` — the league is now on Week ${payload.toWeek}` : ""}.`);
  const s = user.sections ?? {};
  if (s.powerRanking) embed.addFields({ name: "📊 Power Ranking", value: String(s.powerRanking).slice(0, 1024) });
  if (s.transactions) embed.addFields({ name: "💰 Transactions", value: String(s.transactions).slice(0, 1024) });
  if (s.badges) embed.addFields({ name: "🏅 Badges", value: String(s.badges).slice(0, 1024) });
  if (s.eosProgress) embed.addFields({ name: "📈 EOS Payout Progress", value: String(s.eosProgress).slice(0, 1024) });
  return embed;
}

export async function handleAdvanceDmSend(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can send Advance DMs.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Sending Advance DMs…").setColor(0x3498db).setDescription("Generating per-coach summaries and delivering DMs.")],
    components: [],
  });

  let payload: any;
  try {
    payload = await recApi.generateAdvanceDms({ guildId: interaction.guildId });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Advance DMs Failed").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: buildAdvanceRows(),
    });
  }

  const recipients: any[] = Array.isArray(payload?.users) ? payload.users : [];
  if (!recipients.length) {
    const why = payload?.reason === "no_linked_users"
      ? "There are no active, linked coaches to DM."
      : payload?.reason === "no_run"
        ? "No completed advance was found to summarize."
        : "There was nothing to send.";
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("No Advance DMs Sent").setColor(0x95a5a6).setDescription(why)],
      components: buildAdvanceRows(),
    });
  }

  let sent = 0;
  let failed = 0;
  for (const user of recipients) {
    try {
      const discordUser = await interaction.client.users.fetch(user.discordId);
      await discordUser.send({ embeds: [buildAdvanceDmEmbed(user, payload)] });
      sent += 1;
    } catch {
      failed += 1; // closed DMs / left server — don't abort the batch
    }
  }

  const failLine = failed ? ` ${failed} could not be delivered (DMs closed or user left).` : "";
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Advance DMs Sent ✅")
      .setColor(0x2ecc71)
      .setDescription(`Delivered **${sent}** Advance DM${sent === 1 ? "" : "s"} for Week ${payload.fromWeek ?? "?"}.${failLine}`)],
    components: buildAdvanceRows(),
  });
}

export async function handleAdvanceDmSkip(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Advance Complete").setColor(0x95a5a6).setDescription("Advance DMs were skipped. No DMs were sent for this advance.")],
    components: buildAdvanceRows(),
  });
}
