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
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";

// ─── Weekly Scores: upload a League Schedule screenshot to pre-log final scores ──
// Mirrors the box-score commissioner upload + corrections flow. The week's matchups
// come from the saved schedule; the screenshot only supplies scores. Anything the
// OCR can't read shows "?" and is fixable via Corrections before logging.

export const WEEKLY_SCORES_CUSTOM_IDS = {
  uploadOpen: "rec:weekly_scores:upload",
  approvePrefix: "rec:weekly_scores:approve:",        // + weekNumber
  cancelPrefix: "rec:weekly_scores:cancel:",          // + weekNumber
  correctOpenPrefix: "rec:weekly_scores:corr_open:",  // + weekNumber
  correctGameSelectPrefix: "rec:weekly_scores:corr_game:", // (string select)
  correctModalPrefix: "rec:weekly_scores:corr_modal:",     // + gameId
  correctAwayInput: "rec:weekly_scores:corr_away",
  correctHomeInput: "rec:weekly_scores:corr_home",
} as const;

type ReviewGame = {
  gameId: string;
  awayAbbr: string | null;
  homeAbbr: string | null;
  awayName: string | null;
  homeName: string | null;
  awayScore: number | null;
  homeScore: number | null;
  hasBoxScore: boolean;
};

type WeeklyScoreSession = {
  guildId: string;
  userId: string;
  channelId: string;
  weekNumber: number;
  phase: "awaiting_upload" | "review";
  games: ReviewGame[];
  imageUrl: string | null;
  reviewMessageId: string | null;
  at: number;
};

const sessions = new Map<string, WeeklyScoreSession>();
const key = (guildId: string, userId: string) => `${guildId}:${userId}`;
const SESSION_TTL = 15 * 60 * 1000;

function getSession(guildId: string, userId: string): WeeklyScoreSession | null {
  const s = sessions.get(key(guildId, userId));
  if (!s) return null;
  if (Date.now() - s.at > SESSION_TTL) {
    sessions.delete(key(guildId, userId));
    return null;
  }
  return s;
}

function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const apiError = message.match(/^REC API request failed:\s*\d+\s+(\{.*\})$/s);
  if (apiError?.[1]) {
    try {
      const parsed = JSON.parse(apiError[1]) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    } catch {
      /* fall through */
    }
  }
  return message;
}

// Resolve the league's Pending Payouts channel (where screenshot reviews are posted
// for approval). Returns null if not configured or unreachable.
export async function getPendingPayoutsChannel(client: { channels: { fetch: (id: string) => Promise<any> } }, guildId: string): Promise<TextChannel | null> {
  try {
    const cfg = await recApi.getEconomyConfig(guildId);
    const id: string | null = cfg?.routes?.pending_payouts_channel_id ?? null;
    if (!id) return null;
    const ch = await client.channels.fetch(id).catch(() => null);
    if (ch && ch.isTextBased?.() && !ch.isDMBased?.()) return ch as TextChannel;
    return null;
  } catch {
    return null;
  }
}

// ─── Embed / components ─────────────────────────────────────────────────────────

function gameLine(g: ReviewGame): string {
  const a = g.awayScore != null ? `**${g.awayScore}**` : "**?**";
  const h = g.homeScore != null ? `**${g.homeScore}**` : "**?**";
  const lock = g.hasBoxScore ? "  🔒 box score" : "";
  return `${g.awayAbbr ?? "?"} ${a} – ${h} ${g.homeAbbr ?? "?"}${lock}`;
}

function buildReviewEmbed(session: WeeklyScoreSession): EmbedBuilder {
  const unread = session.games.filter((g) => !g.hasBoxScore && (g.awayScore == null || g.homeScore == null));
  const willLog = session.games.filter((g) => !g.hasBoxScore && g.awayScore != null && g.homeScore != null).length;

  const embed = new EmbedBuilder()
    .setTitle(`Weekly Scores — Week ${session.weekNumber}`)
    .setColor(unread.length ? 0xf1c40f : 0x3498db)
    .setDescription(session.games.map(gameLine).join("\n").slice(0, 4096))
    .addFields({
      name: "STATUS",
      value: [
        `**${willLog}** game${willLog === 1 ? "" : "s"} ready to log.`,
        unread.length ? `**${unread.length}** still show **?** — use **Corrections** to fix them before approving.` : "All readable games parsed.",
        "🔒 = already has a box score; its result stays authoritative and won't be overwritten.",
      ].join("\n"),
      inline: false,
    });
  if (session.imageUrl) embed.setImage(session.imageUrl);
  embed.setFooter({ text: "Approve pre-logs these results so the advance needs no manual entry." });
  return embed;
}

function buildReviewRows(weekNumber: number) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.approvePrefix}${weekNumber}`).setLabel("Approve & Log").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.correctOpenPrefix}${weekNumber}`).setLabel("Corrections").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.cancelPrefix}${weekNumber}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildCorrectionGameRows(session: WeeklyScoreSession) {
  const options = session.games.slice(0, 25).map((g) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${g.awayAbbr ?? "?"} @ ${g.homeAbbr ?? "?"}`.slice(0, 100))
      .setValue(g.gameId)
      .setDescription(`${g.awayScore ?? "?"} – ${g.homeScore ?? "?"}`.slice(0, 100)),
  );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(WEEKLY_SCORES_CUSTOM_IDS.correctGameSelectPrefix).setPlaceholder("Pick a game to correct").addOptions(options),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.cancelPrefix}${session.weekNumber}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Upload entry (button on the Advance panel) ─────────────────────────────────

export async function handleWeeklyScoresUploadOpen(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can log weekly scores.", flags: MessageFlags.Ephemeral });
  }

  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const weekNumber = Math.max(1, Number(week?.league?.current_week ?? 1));

  sessions.set(key(interaction.guildId, interaction.user.id), {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    weekNumber,
    phase: "awaiting_upload",
    games: [],
    imageUrl: null,
    reviewMessageId: null,
    at: Date.now(),
  });

  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`Upload Week ${weekNumber} Scores`)
      .setColor(0x3498db)
      .setDescription([
        `Post the **League Schedule** screenshot(s) for **Week ${weekNumber}** in this channel — attach **1 or 2 images** (top + bottom of the list) to a single message.`,
        "",
        "I'll read the final scores, match them to the schedule, and show a review you can correct before logging.",
      ].join("\n"))],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Screenshot listener (called from messageCreate) ────────────────────────────

export async function handleWeeklyScoresUploadMessage(message: Message): Promise<boolean> {
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
    embeds: [new EmbedBuilder().setTitle("Reading schedule…").setDescription(`Parsing Week ${session.weekNumber} scores from your screenshot${images.length > 1 ? "s" : ""}. This can take ~30–60 seconds.`)],
  }).catch(() => null);

  try {
    const preview = await recApi.previewWeeklyScores({ guildId: session.guildId, weekNumber: session.weekNumber, imageUrls: images });
    // The screenshot is re-hosted by the API; the source message can go now.
    await message.delete().catch(() => undefined);

    session.weekNumber = Number(preview.weekNumber ?? session.weekNumber);
    session.games = (preview.games ?? []) as ReviewGame[];
    session.imageUrl = preview.imageUrl ?? null;
    session.phase = "review";
    session.at = Date.now();

    // Post the review (with Approve/Corrections) to the Pending Payouts channel; fall
    // back to this channel if none is configured.
    const payoutsChannel = await getPendingPayoutsChannel(message.client, session.guildId);
    const target = payoutsChannel ?? channel;
    const reviewMsg = await target.send({ embeds: [buildReviewEmbed(session)], components: buildReviewRows(session.weekNumber) }).catch(() => null);
    session.reviewMessageId = reviewMsg?.id ?? null;
    sessions.set(key(session.guildId, session.userId), session);

    if (payoutsChannel && payoutsChannel.id !== channel.id) {
      await working?.edit({ embeds: [new EmbedBuilder().setTitle("Weekly Scores").setColor(0x2ecc71).setDescription(`Parsed Week ${session.weekNumber} — review sent to <#${payoutsChannel.id}> for approval.`)] }).catch(() => undefined);
    } else {
      await working?.delete().catch(() => undefined);
    }
  } catch (err) {
    await message.delete().catch(() => undefined);
    await working?.edit({
      embeds: [new EmbedBuilder().setTitle("Couldn't read scores").setColor(0xe74c3c).setDescription(userFacingError(err))],
    }).catch(() => undefined);
    sessions.delete(key(session.guildId, session.userId));
  }
  return true;
}

// ─── Review actions ─────────────────────────────────────────────────────────────

function requireReviewSession(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): WeeklyScoreSession | null {
  if (!interaction.inCachedGuild()) return null;
  return getSession(interaction.guildId, interaction.user.id);
}

export async function handleWeeklyScoresApprove(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can log weekly scores.", flags: MessageFlags.Ephemeral });
  }
  const session = requireReviewSession(interaction);
  await interaction.deferUpdate();
  if (!session || session.phase !== "review") {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Weekly Scores").setDescription("This score upload expired. Reopen League Mgmt → Advance → Upload Scores.")], components: [] });
  }

  try {
    const result = await recApi.prelogWeeklyScores({
      guildId: session.guildId,
      weekNumber: session.weekNumber,
      loggedByDiscordId: interaction.user.id,
      games: session.games.map((g) => ({ gameId: g.gameId, awayScore: g.awayScore, homeScore: g.homeScore })),
    });
    sessions.delete(key(session.guildId, session.userId));
    const embed = buildReviewEmbed(session).setColor(0x2ecc71);
    embed.spliceFields(0, 1, {
      name: "LOGGED ✅",
      value: `Pre-logged **${result.logged}** result${result.logged === 1 ? "" : "s"} for Week ${session.weekNumber}${result.skipped ? ` (skipped ${result.skipped}: box-scored or still unread)` : ""}. Advancing the week needs no manual entry for these games.`,
      inline: false,
    });
    return interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    return interaction.editReply({ embeds: [buildReviewEmbed(session)], components: buildReviewRows(session.weekNumber) }).then(() =>
      interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral }),
    );
  }
}

export async function handleWeeklyScoresCancel(interaction: ButtonInteraction) {
  const session = requireReviewSession(interaction);
  if (interaction.inCachedGuild()) sessions.delete(key(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  if (session && session.phase === "review") {
    return interaction.editReply({ embeds: [buildReviewEmbed(session).setColor(0x95a5a6)], components: [] });
  }
  return interaction.editReply({ components: [] }).catch(() => undefined);
}

export async function handleWeeklyScoresCorrectOpen(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct weekly scores.", flags: MessageFlags.Ephemeral });
  }
  const session = requireReviewSession(interaction);
  await interaction.deferUpdate();
  if (!session || session.phase !== "review") {
    return interaction.editReply({ components: [] }).catch(() => undefined);
  }
  return interaction.editReply({ components: buildCorrectionGameRows(session) });
}

export async function handleWeeklyScoresCorrectGameSelect(interaction: StringSelectMenuInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct weekly scores.", flags: MessageFlags.Ephemeral });
  }
  const session = requireReviewSession(interaction);
  if (!session || session.phase !== "review") return interaction.deferUpdate().catch(() => undefined);
  const gameId = interaction.values[0] ?? "";
  const game = session.games.find((g) => g.gameId === gameId);
  if (!game) return interaction.deferUpdate().catch(() => undefined);

  const modal = new ModalBuilder()
    .setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.correctModalPrefix}${gameId}`)
    .setTitle(`Correct ${game.awayAbbr ?? "Away"} @ ${game.homeAbbr ?? "Home"}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(WEEKLY_SCORES_CUSTOM_IDS.correctAwayInput).setLabel(`${game.awayAbbr ?? "Away"} final score`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setValue(game.awayScore != null ? String(game.awayScore) : "").setPlaceholder("numbers only"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(WEEKLY_SCORES_CUSTOM_IDS.correctHomeInput).setLabel(`${game.homeAbbr ?? "Home"} final score`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setValue(game.homeScore != null ? String(game.homeScore) : "").setPlaceholder("numbers only"),
      ),
    );
  return interaction.showModal(modal);
}

function parseScore(raw: string): number | null {
  const v = (raw ?? "").replace(/[^0-9]/g, "");
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

export async function handleWeeklyScoresCorrectModal(interaction: ModalSubmitInteraction) {
  const gameId = interaction.customId.slice(WEEKLY_SCORES_CUSTOM_IDS.correctModalPrefix.length);
  const session = requireReviewSession(interaction);
  await interaction.deferUpdate();
  if (!session || session.phase !== "review") return;
  const game = session.games.find((g) => g.gameId === gameId);
  if (!game) return;

  game.awayScore = parseScore(interaction.fields.getTextInputValue(WEEKLY_SCORES_CUSTOM_IDS.correctAwayInput));
  game.homeScore = parseScore(interaction.fields.getTextInputValue(WEEKLY_SCORES_CUSTOM_IDS.correctHomeInput));
  session.at = Date.now();
  sessions.set(key(session.guildId, session.userId), session);
  return interaction.editReply({ embeds: [buildReviewEmbed(session)], components: buildReviewRows(session.weekNumber) });
}
