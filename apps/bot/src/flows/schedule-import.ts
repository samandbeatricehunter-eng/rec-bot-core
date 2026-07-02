import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type Message,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { isCfb, regularSeasonWeeks } from "@rec/shared";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";
import { getPendingPayoutsChannel } from "./schedule-scores.js";

// ─── Schedule import: parse a League Schedule screenshot into a week's matchups ──
// Wizard mode walks the full regular season; one-week mode does a single chosen
// week. Both share the upload → preview → review → save (replaceScheduleWeek)
// loop. The RESULT-column abbreviations and MATCHUP nicknames are matched to
// league teams server-side. Bounds/labels are game-aware (CFB: 12 regular weeks +
// 5-week postseason; Madden: 18 regular weeks + 4-week postseason) — the OCR
// layout parsing itself is still Madden-shaped pending real CFB screenshot samples.
const CFB_POSTSEASON_LABELS = ["CFP First Round", "CFP Quarterfinals", "CFP Semifinals", "Bye Week", "National Championship"];
const NFL_POSTSEASON_LABELS = ["Wild Card", "Divisional", "Conference Championship", "Super Bowl"];

function maxImportWeek(game: string | null): number {
  return regularSeasonWeeks(game ?? null);
}
// One-week mode can import any week including the postseason; the wizard still
// walks the regular season only.
function maxSingleImportWeek(game: string | null): number {
  return isCfb(game) ? 17 : 22;
}
function importWeekLabel(week: number, game: string | null) {
  const lastRegularWeek = regularSeasonWeeks(game ?? null);
  if (week <= lastRegularWeek) return `Week ${week}`;
  const labels = isCfb(game) ? CFB_POSTSEASON_LABELS : NFL_POSTSEASON_LABELS;
  return `Week ${week} — ${labels[week - lastRegularWeek - 1] ?? "Postseason"}`;
}

export const SCHEDULE_IMPORT_CUSTOM_IDS = {
  weekSelect: "rec:sched_import:week",
  savePrefix: "rec:sched_import:save:",   // + weekNumber
  cancel: "rec:sched_import:cancel",
} as const;

type ImportGame = {
  awayTeamId: string | null;
  homeTeamId: string | null;
  awayLabel: string;
  homeLabel: string;
  matched: boolean;
};

type ImportSession = {
  guildId: string;
  userId: string;
  channelId: string;
  game: string | null;
  mode: "wizard" | "one_week";
  weekNumber: number;
  phase: "awaiting_upload" | "review";
  games: ImportGame[];
  expectedGames: number;
  imageUrl: string | null;
  at: number;
};

const sessions = new Map<string, ImportSession>();
const key = (guildId: string, userId: string) => `${guildId}:${userId}`;
const SESSION_TTL = 20 * 60 * 1000;

function getSession(guildId: string, userId: string): ImportSession | null {
  const s = sessions.get(key(guildId, userId));
  if (!s) return null;
  if (Date.now() - s.at > SESSION_TTL) {
    sessions.delete(key(guildId, userId));
    return null;
  }
  return s;
}

function uploadPrompt(weekNumber: number, mode: "wizard" | "one_week") {
  return new EmbedBuilder()
    .setTitle(`${mode === "wizard" ? "Schedule Wizard" : "Upload One Week"} — Week ${weekNumber}`)
    .setColor(COLORS.info)
    .setDescription([
      `Post the **League Schedule** screenshot(s) for **Week ${weekNumber}** in this channel — attach **1 or 2 images** (top + bottom of the list) to a single message.`,
      "",
      "I'll read the matchups, match them to your league's teams, and show a review before saving.",
    ].join("\n"));
}

// ─── Entry points ────────────────────────────────────────────────────────────────

export async function startScheduleImportWizard(interaction: ButtonInteraction, buildScheduleRows: () => any[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can import the schedule.", flags: MessageFlags.Ephemeral });
  }
  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  sessions.set(key(interaction.guildId, interaction.user.id), {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    game: week?.league?.game ?? null,
    mode: "wizard",
    weekNumber: 1,
    phase: "awaiting_upload",
    games: [],
    expectedGames: 0,
    imageUrl: null,
    at: Date.now(),
  });
  return interaction.update({ embeds: [uploadPrompt(1, "wizard")], components: buildScheduleRows() });
}

export async function startScheduleImportOneWeek(interaction: ButtonInteraction, buildScheduleRows: () => any[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can import the schedule.", flags: MessageFlags.Ephemeral });
  }
  sessions.delete(key(interaction.guildId, interaction.user.id));
  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const game: string | null = week?.league?.game ?? null;
  const select = new StringSelectMenuBuilder()
    .setCustomId(SCHEDULE_IMPORT_CUSTOM_IDS.weekSelect)
    .setPlaceholder("Select the week to import")
    .addOptions(Array.from({ length: maxSingleImportWeek(game) }, (_, i) => new StringSelectMenuOptionBuilder().setLabel(importWeekLabel(i + 1, game)).setValue(String(i + 1))));
  return interaction.update({
    embeds: [new EmbedBuilder().setTitle("Upload One Week").setDescription("Pick the week you're importing, then upload its schedule screenshot(s).")],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), ...buildScheduleRows()],
  });
}

export async function handleScheduleImportWeekSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can import the schedule.", flags: MessageFlags.Ephemeral });
  }
  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const game: string | null = week?.league?.game ?? null;
  const weekNumber = Math.max(1, Math.min(maxSingleImportWeek(game), Number(interaction.values[0] ?? 1)));
  sessions.set(key(interaction.guildId, interaction.user.id), {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    game,
    mode: "one_week",
    weekNumber,
    phase: "awaiting_upload",
    games: [],
    expectedGames: 0,
    imageUrl: null,
    at: Date.now(),
  });
  return interaction.update({ embeds: [uploadPrompt(weekNumber, "one_week")], components: [] });
}

// ─── Review embed / rows ──────────────────────────────────────────────────────────

function buildReviewEmbed(session: ImportSession): EmbedBuilder {
  const lines = session.games.map((g) => (g.matched ? `✓ ${g.awayLabel} @ ${g.homeLabel}` : `⚠ ${g.awayLabel} @ ${g.homeLabel} — couldn't match`));
  const embed = new EmbedBuilder()
    .setTitle(`Schedule Import — Week ${session.weekNumber}`)
    .setColor(session.games.some((g) => !g.matched) || session.games.filter((g) => g.matched).length < session.expectedGames ? 0xf1c40f : 0x3498db)
    .setDescription(lines.length ? lines.join("\n").slice(0, 4096) : "No matchups could be read from the screenshot.")
    .addFields({
      name: "STATUS",
      value: [
        `Matched **${session.games.filter((g) => g.matched).length}/${session.expectedGames}** games.`,
        session.games.filter((g) => g.matched).length < session.expectedGames
          ? "Some games are missing or unmatched — Save logs what matched; add the rest with **Set Manually**, or re-upload a clearer/second screenshot."
          : "All games matched.",
      ].join("\n"),
      inline: false,
    });
  if (session.imageUrl) embed.setImage(session.imageUrl);
  return embed;
}

function buildReviewRows(session: ImportSession) {
  const last = session.mode === "wizard" && session.weekNumber >= maxImportWeek(session.game);
  const saveLabel = session.mode === "wizard" ? (last ? "Save & Finish" : "Save & Next Week") : "Save Week";
  const matched = session.games.filter((g) => g.matched).length;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${SCHEDULE_IMPORT_CUSTOM_IDS.savePrefix}${session.weekNumber}`).setLabel(saveLabel).setStyle(ButtonStyle.Success).setDisabled(matched === 0),
      new ButtonBuilder().setCustomId(SCHEDULE_IMPORT_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Screenshot listener ───────────────────────────────────────────────────────────

export async function handleScheduleImportUploadMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot) return false;
  const session = getSession(message.guildId, message.author.id);
  if (!session || session.phase !== "awaiting_upload" || session.channelId !== message.channelId) return false;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return false;
  const channel = message.channel as TextChannel;

  const images = [...message.attachments.values()]
    .filter((a) => (a.contentType?.startsWith("image/") ?? false) || /\.(png|jpe?g|webp)$/i.test(a.name ?? ""))
    .map((a) => a.url)
    .slice(0, 2);
  if (images.length === 0) return false;

  const working = await channel.send({
    embeds: [new EmbedBuilder().setTitle("Reading schedule…").setDescription(`Parsing Week ${session.weekNumber} matchups. This can take ~30–60 seconds.`)],
  }).catch(() => null);

  try {
    const preview = await recApi.previewScheduleImport({ guildId: session.guildId, weekNumber: session.weekNumber, imageUrls: images });
    await message.delete().catch(() => undefined);

    session.games = (preview.games ?? []) as ImportGame[];
    session.expectedGames = Number(preview.expectedGames ?? session.games.length);
    session.imageUrl = preview.imageUrl ?? null;
    session.phase = "review";
    session.at = Date.now();
    sessions.set(key(session.guildId, session.userId), session);

    const payoutsChannel = await getPendingPayoutsChannel(message.client, session.guildId);
    const target = payoutsChannel ?? channel;
    await target.send({ embeds: [buildReviewEmbed(session)], components: buildReviewRows(session) }).catch(() => null);
    if (payoutsChannel && payoutsChannel.id !== channel.id) {
      await working?.edit({ embeds: [new EmbedBuilder().setTitle("Schedule Import").setColor(COLORS.success).setDescription(`Parsed Week ${session.weekNumber} — review sent to <#${payoutsChannel.id}>.`)] }).catch(() => undefined);
    } else {
      await working?.delete().catch(() => undefined);
    }
  } catch (err) {
    await message.delete().catch(() => undefined);
    await working?.edit({ embeds: [new EmbedBuilder().setTitle("Couldn't read schedule").setColor(COLORS.error).setDescription(userFacingError(err))] }).catch(() => undefined);
    sessions.delete(key(session.guildId, session.userId));
  }
  return true;
}

// ─── Save / cancel ───────────────────────────────────────────────────────────────

export async function handleScheduleImportSave(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can save the schedule.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.guildId, interaction.user.id);
  await interaction.deferUpdate();
  if (!session || session.phase !== "review") {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Schedule Import").setDescription("This import expired. Reopen League Mgmt → Schedule.")], components: [] });
  }

  const matched = session.games.filter((g) => g.matched && g.awayTeamId && g.homeTeamId).map((g) => ({ awayTeamId: g.awayTeamId!, homeTeamId: g.homeTeamId! }));
  if (!matched.length) {
    return interaction.editReply({ embeds: [buildReviewEmbed(session)], components: buildReviewRows(session) }).then(() =>
      interaction.followUp({ content: "No matched games to save. Re-upload a clearer screenshot or use Set Manually.", flags: MessageFlags.Ephemeral }),
    );
  }

  try {
    await recApi.replaceScheduleWeek({ guildId: session.guildId, weekNumber: session.weekNumber, games: matched, requestedByDiscordId: interaction.user.id });
  } catch (err) {
    return interaction.editReply({ embeds: [buildReviewEmbed(session)], components: buildReviewRows(session) }).then(() =>
      interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral }),
    );
  }

  const savedWeek = session.weekNumber;
  const savedEmbed = buildReviewEmbed(session).setColor(COLORS.success);
  savedEmbed.spliceFields(0, 1, { name: "SAVED ✅", value: `Saved **${matched.length}** matchup${matched.length === 1 ? "" : "s"} for Week ${savedWeek}.`, inline: false });
  await interaction.editReply({ embeds: [savedEmbed], components: [] });

  // The next prompt / completion notice goes back to the upload channel (where the
  // commissioner posts screenshots), which may differ from the pending-payouts
  // channel this Save button lives in.
  const uploadChannel = await interaction.client.channels.fetch(session.channelId).catch(() => null);
  const promptTarget = uploadChannel?.isTextBased() && !uploadChannel.isDMBased() ? (uploadChannel as TextChannel) : null;

  // Wizard: advance to the next week (or finish at the end of the regular season).
  if (session.mode === "wizard" && savedWeek < maxImportWeek(session.game)) {
    session.weekNumber = savedWeek + 1;
    session.phase = "awaiting_upload";
    session.games = [];
    session.expectedGames = 0;
    session.imageUrl = null;
    session.at = Date.now();
    sessions.set(key(session.guildId, session.userId), session);
    await promptTarget?.send({ embeds: [uploadPrompt(session.weekNumber, "wizard")] }).catch(() => undefined);
  } else {
    sessions.delete(key(session.guildId, session.userId));
    await promptTarget?.send({
      embeds: [new EmbedBuilder().setTitle("Schedule Import Complete").setColor(COLORS.success).setDescription(session.mode === "wizard" ? "All weeks imported. Review with **View Schedule**." : `Week ${savedWeek} saved. Review with **View Schedule**.`)],
    }).catch(() => undefined);
  }
}

export async function handleScheduleImportCancel(interaction: ButtonInteraction) {
  if (interaction.inCachedGuild()) sessions.delete(key(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Schedule Import").setColor(COLORS.neutral).setDescription("Import cancelled.")], components: [] }).catch(() => undefined);
}
