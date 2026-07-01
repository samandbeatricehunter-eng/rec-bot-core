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
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";
import { refreshConfirmableWagerEmbeds } from "./wagers.js";

// ─── Weekly Scores: upload a League Schedule screenshot to pre-log final scores ──
// The review is persisted server-side (rec_weekly_score_reviews) so it survives a
// restart, any commissioner can approve it from the Pending Payouts channel, and a
// new upload (or the week advancing) supersedes it. The week's matchups come from
// the saved schedule; the screenshot only supplies scores. Unread cells show "?".

export const WEEKLY_SCORES_CUSTOM_IDS = {
  uploadOpen: "rec:ws:upload",
  approvePrefix: "rec:ws:approve:",        // + reviewId
  cancelPrefix: "rec:ws:cancel:",          // + reviewId
  correctOpenPrefix: "rec:ws:corr_open:",  // + reviewId
  correctGameSelectPrefix: "rec:ws:corr_game:", // + reviewId  (string select; value = gameId)
  correctModalPrefix: "rec:ws:cm:",        // + reviewId:gameId
  correctAwayInput: "rec:ws:corr_away",
  correctHomeInput: "rec:ws:corr_home",
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

type ReviewData = {
  reviewId: string;
  weekNumber: number;
  games: ReviewGame[];
  imageUrl: string | null;
};

// In-memory state is only the short "I'm waiting for your screenshot" window. The
// review itself (after parsing) lives in the DB, keyed by reviewId in the buttons.
type UploadSession = { guildId: string; userId: string; channelId: string; weekNumber: number; at: number };
const uploadSessions = new Map<string, UploadSession>();
const key = (guildId: string, userId: string) => `${guildId}:${userId}`;
const UPLOAD_TTL = 10 * 60 * 1000;

function getUploadSession(guildId: string, userId: string): UploadSession | null {
  const s = uploadSessions.get(key(guildId, userId));
  if (!s) return null;
  if (Date.now() - s.at > UPLOAD_TTL) {
    uploadSessions.delete(key(guildId, userId));
    return null;
  }
  return s;
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

function toReview(raw: any): ReviewData {
  return {
    reviewId: raw.reviewId,
    weekNumber: Number(raw.weekNumber ?? 0),
    games: (raw.games ?? []) as ReviewGame[],
    imageUrl: raw.imageUrl ?? null,
  };
}

// ─── Embed / components ─────────────────────────────────────────────────────────

function gameLine(g: ReviewGame): string {
  const a = g.awayScore != null ? `**${g.awayScore}**` : "**?**";
  const h = g.homeScore != null ? `**${g.homeScore}**` : "**?**";
  const lock = g.hasBoxScore ? "  🔒 box score" : "";
  return `${g.awayAbbr ?? "?"} ${a} – ${h} ${g.homeAbbr ?? "?"}${lock}`;
}

function buildReviewEmbed(review: ReviewData): EmbedBuilder {
  const unread = review.games.filter((g) => !g.hasBoxScore && (g.awayScore == null || g.homeScore == null));
  const willLog = review.games.filter((g) => !g.hasBoxScore && g.awayScore != null && g.homeScore != null).length;

  const embed = new EmbedBuilder()
    .setTitle(`Weekly Scores — Week ${review.weekNumber}`)
    .setColor(unread.length ? 0xf1c40f : 0x3498db)
    .setDescription(review.games.map(gameLine).join("\n").slice(0, 4096))
    .addFields({
      name: "STATUS",
      value: [
        `**${willLog}** game${willLog === 1 ? "" : "s"} ready to log.`,
        unread.length ? `**${unread.length}** still show **?** — use **Corrections** to fix them before approving.` : "All readable games parsed.",
        "🔒 = already has a box score (pending or approved); its result stays authoritative and won't be overwritten.",
      ].join("\n"),
      inline: false,
    });
  if (review.imageUrl) embed.setImage(review.imageUrl);
  embed.setFooter({ text: "Approve pre-logs these results so the advance needs no manual entry." });
  return embed;
}

function buildReviewRows(reviewId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.approvePrefix}${reviewId}`).setLabel("Approve & Log").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.correctOpenPrefix}${reviewId}`).setLabel("Corrections").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.cancelPrefix}${reviewId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildCorrectionGameRows(review: ReviewData) {
  const options = review.games.slice(0, 25).map((g) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${g.awayAbbr ?? "?"} @ ${g.homeAbbr ?? "?"}`.slice(0, 100))
      .setValue(g.gameId)
      .setDescription(`${g.awayScore ?? "?"} – ${g.homeScore ?? "?"}`.slice(0, 100)),
  );
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.correctGameSelectPrefix}${review.reviewId}`).setPlaceholder("Pick a game to correct").addOptions(options),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.cancelPrefix}${review.reviewId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Upload entry (button on the League Mgmt menu) ──────────────────────────────

export async function handleWeeklyScoresUploadOpen(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can log weekly scores.", flags: MessageFlags.Ephemeral });
  }

  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const weekNumber = Math.max(1, Number(week?.league?.current_week ?? 1));
  // Playoff rounds are a short slate, so a single screenshot covers the week.
  const isPlayoff = weekNumber > 18;

  uploadSessions.set(key(interaction.guildId, interaction.user.id), {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    weekNumber,
    at: Date.now(),
  });

  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`Upload Week ${weekNumber} Scores`)
      .setColor(0x3498db)
      .setDescription([
        isPlayoff
          ? `Post the **League Schedule** screenshot for **Week ${weekNumber}** in this channel — the playoff slate is short, so a **single screenshot** is enough.`
          : `Post the **League Schedule** screenshot(s) for **Week ${weekNumber}** in this channel — attach **1 or 2 images** (top + bottom of the list) to a single message.`,
        "",
        "I'll read the final scores, match them to the schedule, and post a review to the Pending Payouts channel for approval.",
      ].join("\n"))],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Screenshot listener (called from messageCreate) ────────────────────────────

export async function handleWeeklyScoresUploadMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot) return false;
  const session = getUploadSession(message.guildId, message.author.id);
  if (!session || session.channelId !== message.channelId) return false;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return false;
  const channel = message.channel as TextChannel;

  const images = [...message.attachments.values()]
    .filter((a) => (a.contentType?.startsWith("image/") ?? false) || /\.(png|jpe?g|webp)$/i.test(a.name ?? ""))
    .map((a) => a.url)
    .slice(0, 2);
  if (images.length === 0) return false;

  uploadSessions.delete(key(session.guildId, session.userId));

  const working = await channel.send({
    embeds: [new EmbedBuilder().setTitle("Reading schedule…").setDescription(`Parsing Week ${session.weekNumber} scores from your screenshot${images.length > 1 ? "s" : ""}. This can take ~30–60 seconds.`)],
  }).catch(() => null);

  try {
    const review = toReview(await recApi.createWeeklyScoreReview({
      guildId: session.guildId,
      weekNumber: session.weekNumber,
      imageUrls: images,
      createdByDiscordId: session.userId,
    }));
    await message.delete().catch(() => undefined);

    const payoutsChannel = await getPendingPayoutsChannel(message.client, session.guildId);
    const target = payoutsChannel ?? channel;
    await target.send({ embeds: [buildReviewEmbed(review)], components: buildReviewRows(review.reviewId) }).catch(() => null);

    if (payoutsChannel && payoutsChannel.id !== channel.id) {
      await working?.edit({ embeds: [new EmbedBuilder().setTitle("Weekly Scores").setColor(0x2ecc71).setDescription(`Parsed Week ${review.weekNumber} — review sent to <#${payoutsChannel.id}> for approval.`)] }).catch(() => undefined);
    } else {
      await working?.delete().catch(() => undefined);
    }
  } catch (err) {
    await message.delete().catch(() => undefined);
    await working?.edit({
      embeds: [new EmbedBuilder().setTitle("Couldn't read scores").setColor(0xe74c3c).setDescription(userFacingError(err))],
    }).catch(() => undefined);
  }
  return true;
}

// ─── Review actions (reviewId carried in the button/select customId) ─────────────

function adminGate(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): boolean {
  return isDiscordAdminInteraction(interaction);
}

export async function handleWeeklyScoresApprove(interaction: ButtonInteraction) {
  if (!adminGate(interaction)) {
    return interaction.reply({ content: "Only commissioners can log weekly scores.", flags: MessageFlags.Ephemeral });
  }
  const reviewId = interaction.customId.slice(WEEKLY_SCORES_CUSTOM_IDS.approvePrefix.length);
  await interaction.deferUpdate();
  try {
    const result = await recApi.approveWeeklyScoreReview({ reviewId, loggedByDiscordId: interaction.user.id });
    if (interaction.inCachedGuild()) void refreshConfirmableWagerEmbeds(interaction.client, interaction.guildId);
    const base = interaction.message.embeds[0];
    const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Weekly Scores")).setColor(0x2ecc71);
    embed.spliceFields(0, embed.data.fields?.length ?? 0, {
      name: "LOGGED ✅",
      value: `Pre-logged **${result.logged}** result${result.logged === 1 ? "" : "s"} for Week ${result.weekNumber}${result.skipped ? ` (skipped ${result.skipped}: box-scored or still unread)` : ""}. Advancing the week needs no manual entry for these games.`,
      inline: false,
    });
    return interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    return interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function handleWeeklyScoresCancel(interaction: ButtonInteraction) {
  if (!adminGate(interaction)) {
    return interaction.reply({ content: "Only commissioners can manage weekly scores.", flags: MessageFlags.Ephemeral });
  }
  const reviewId = interaction.customId.slice(WEEKLY_SCORES_CUSTOM_IDS.cancelPrefix.length);
  await interaction.deferUpdate();
  await recApi.cancelWeeklyScoreReview(reviewId).catch(() => undefined);
  const base = interaction.message.embeds[0];
  const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Weekly Scores")).setColor(0x95a5a6);
  return interaction.editReply({ embeds: [embed], components: [] }).catch(() => undefined);
}

export async function handleWeeklyScoresCorrectOpen(interaction: ButtonInteraction) {
  if (!adminGate(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct weekly scores.", flags: MessageFlags.Ephemeral });
  }
  const reviewId = interaction.customId.slice(WEEKLY_SCORES_CUSTOM_IDS.correctOpenPrefix.length);
  await interaction.deferUpdate();
  try {
    const review = toReview(await recApi.getWeeklyScoreReview(reviewId));
    return interaction.editReply({ components: buildCorrectionGameRows(review) });
  } catch (err) {
    return interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function handleWeeklyScoresCorrectGameSelect(interaction: StringSelectMenuInteraction) {
  if (!adminGate(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct weekly scores.", flags: MessageFlags.Ephemeral });
  }
  const reviewId = interaction.customId.slice(WEEKLY_SCORES_CUSTOM_IDS.correctGameSelectPrefix.length);
  const gameId = interaction.values[0] ?? "";
  let game: ReviewGame | undefined;
  try {
    const review = toReview(await recApi.getWeeklyScoreReview(reviewId));
    game = review.games.find((g) => g.gameId === gameId);
  } catch {
    /* show an empty modal if the review couldn't be re-read */
  }

  const modal = new ModalBuilder()
    .setCustomId(`${WEEKLY_SCORES_CUSTOM_IDS.correctModalPrefix}${reviewId}:${gameId}`)
    .setTitle(`Correct ${game?.awayAbbr ?? "Away"} @ ${game?.homeAbbr ?? "Home"}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(WEEKLY_SCORES_CUSTOM_IDS.correctAwayInput).setLabel(`${game?.awayAbbr ?? "Away"} final score`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setValue(game?.awayScore != null ? String(game.awayScore) : "").setPlaceholder("numbers only"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(WEEKLY_SCORES_CUSTOM_IDS.correctHomeInput).setLabel(`${game?.homeAbbr ?? "Home"} final score`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setValue(game?.homeScore != null ? String(game.homeScore) : "").setPlaceholder("numbers only"),
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
  if (!adminGate(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct weekly scores.", flags: MessageFlags.Ephemeral });
  }
  const rest = interaction.customId.slice(WEEKLY_SCORES_CUSTOM_IDS.correctModalPrefix.length);
  const sep = rest.indexOf(":");
  const reviewId = sep >= 0 ? rest.slice(0, sep) : rest;
  const gameId = sep >= 0 ? rest.slice(sep + 1) : "";
  const awayScore = parseScore(interaction.fields.getTextInputValue(WEEKLY_SCORES_CUSTOM_IDS.correctAwayInput));
  const homeScore = parseScore(interaction.fields.getTextInputValue(WEEKLY_SCORES_CUSTOM_IDS.correctHomeInput));

  await interaction.deferUpdate();
  try {
    const review = toReview(await recApi.correctWeeklyScoreReview({ reviewId, gameId, awayScore, homeScore }));
    return interaction.editReply({ embeds: [buildReviewEmbed(review)], components: buildReviewRows(reviewId) });
  } catch (err) {
    await interaction.editReply({ components: buildReviewRows(reviewId) }).catch(() => undefined);
    return interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}
