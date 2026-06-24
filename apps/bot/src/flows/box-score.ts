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
import { recApi } from "../lib/rec-api.js";

// ─── Custom IDs ───────────────────────────────────────────────────────────────

export const BOX_SCORE_CUSTOM_IDS = {
  submitConfirm: "rec:box_score:submit_confirm",
  cancel: "rec:box_score:cancel",
  inboxOpen: "rec:league_mgmt:box_score_inbox",
  submissionsOpen: "rec:league_mgmt:box_score_inbox",
  adminWeekSelect: "rec:box_score_admin:week",
  adminGameSelect: "rec:box_score_admin:game",
  adminCancel: "rec:box_score_admin:cancel",
  approvePrefix: "rec:box_score:approve:",      // + submissionId
  denyModalPrefix: "rec:box_score:deny_modal:", // + submissionId
  denyReasonInput: "rec:box_score:deny_reason",
  inboxBack: "rec:box_score:inbox_back",
} as const;

// ─── Timing windows ────────────────────────────────────────────────────────────

const MISSING_FIELDS_MS = 5 * 60 * 1000; // wait for a re-upload with missing fields

// ─── Per-user exchange state (one active upload per user per guild) ────────────

type ExchangePhase = "awaiting_missing";

type Exchange = {
  guildId: string;
  channel: TextChannel;
  userId: string;
  imageUrls: string[];
  userMessageIds: string[];
  botMessageIds: string[];
  phase: ExchangePhase;
  timer: NodeJS.Timeout | null;
  expiresAt: number;
  busy: boolean;
};

const exchanges = new Map<string, Exchange>();
const exKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

type CommissionerSubmissionSession = {
  guildId: string;
  channelId: string;
  userId: string;
  weekNumber: number;
  seasonNumber?: number | null;
  gameId: string;
  gameLabel: string;
};

const commissionerSubmissionSessions = new Map<string, CommissionerSubmissionSession>();

// ─── Server route cache (box scores + pending payouts channels) ───────────────

const routesCache = new Map<string, { routes: any; at: number }>();
const ROUTES_TTL = 60_000;

async function getGuildRoutes(guildId: string): Promise<any | null> {
  const cached = routesCache.get(guildId);
  if (cached && Date.now() - cached.at < ROUTES_TTL) return cached.routes;
  try {
    const cfg = await recApi.getEconomyConfig(guildId);
    const routes = cfg?.routes ?? null;
    routesCache.set(guildId, { routes, at: Date.now() });
    return routes;
  } catch {
    routesCache.set(guildId, { routes: null, at: Date.now() });
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function prettifyKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function userFacingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const apiError = message.match(/^REC API request failed:\s*\d+\s+(\{.*\})$/s);
  if (apiError?.[1]) {
    try {
      const parsed = JSON.parse(apiError[1]) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    } catch {
      // Fall through to the original message if the API did not return JSON.
    }
  }
  return message;
}

async function deleteMessages(channel: TextChannel, ids: string[]) {
  for (const id of ids) {
    await channel.messages.delete(id).catch(() => undefined);
  }
}

async function clearExchange(ex: Exchange, opts: { deleteUserImages: boolean }) {
  if (ex.timer) clearTimeout(ex.timer);
  exchanges.delete(exKey(ex.guildId, ex.userId));
  await deleteMessages(ex.channel, ex.botMessageIds);
  if (opts.deleteUserImages) await deleteMessages(ex.channel, ex.userMessageIds);
}

function scheduleTimeout(ex: Exchange, ms: number, onExpire: () => void) {
  if (ex.timer) clearTimeout(ex.timer);
  ex.expiresAt = Date.now() + ms;
  ex.timer = setTimeout(onExpire, ms);
  if (typeof ex.timer.unref === "function") ex.timer.unref();
}

async function dmUser(ex: Exchange, content: string) {
  try {
    const user = await ex.channel.client.users.fetch(ex.userId);
    await user.send(content);
  } catch {
    /* DMs closed — nothing we can do */
  }
}

async function onExchangeTimeout(ex: Exchange, dmReason: string) {
  if (exchanges.get(exKey(ex.guildId, ex.userId)) !== ex) return;
  await clearExchange(ex, { deleteUserImages: false });
  await dmUser(ex, dmReason);
}

// ─── Channel listener (called from messageCreate) ─────────────────────────────

export async function handleBoxScoreChannelMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot) return;

  const routes = await getGuildRoutes(message.guildId);
  const boxChannelId: string | null = routes?.box_scores_channel_id ?? null;
  if (!boxChannelId || message.channelId !== boxChannelId) return;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return;
  const channel = message.channel as TextChannel;

  const attachments = [...message.attachments.values()];
  const imageAttachments = attachments.filter(
    (a) => (a.contentType?.startsWith("image/") ?? false) || /\.(png|jpe?g|webp)$/i.test(a.name ?? ""),
  );

  // Channel rule: a message here must be exactly one box-score image and nothing
  // else. Anything else (text, files, multiple images) is removed with a notice.
  if (imageAttachments.length !== 1 || attachments.length !== imageAttachments.length) {
    await message.delete().catch(() => undefined);
    const reason =
      imageAttachments.length === 0
        ? "Only box score **images** can be posted in this channel."
        : imageAttachments.length > 1
          ? "Upload **one** box score image per message — not several."
          : "Post **only** the box score image — no other files.";
    const notice = await channel.send({
      content: `<@${message.author.id}> ${reason} Your message was removed.`,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => null);
    if (notice) setTimeout(() => void notice.delete().catch(() => undefined), 10_000);
    return;
  }

  const images = imageAttachments.map((a) => a.url);

  const key = exKey(message.guildId, message.author.id);
  const existing = exchanges.get(key);

  // First image in a new upload pass — gate before OCR.
  if (!existing) {
    try {
      const eligibility = await recApi.getBoxScoreUploadEligibility({ guildId: message.guildId, discordId: message.author.id });
      if (eligibility.hasApprovedForWeek) return;
      if (!eligibility.teamId) {
        await channel.send({
          content: `<@${message.author.id}>`,
          embeds: [new EmbedBuilder()
            .setTitle("Box Score Not Accepted")
            .setColor(0xe74c3c)
            .setDescription("You aren't linked to a team in this league. Open **/menu → Teams → Request Team** first.")],
        }).catch(() => undefined);
        return;
      }
      if (!eligibility.hasScheduledGame) {
        await channel.send({
          content: `<@${message.author.id}>`,
          embeds: [new EmbedBuilder()
            .setTitle("Box Score Not Accepted")
            .setColor(0xe74c3c)
            .setDescription(`You don't have a scheduled game in Week ${eligibility.weekNumber}. Box scores are only accepted when your team has an H2H or CPU matchup this week.`)],
        }).catch(() => undefined);
        return;
      }
    } catch (err) {
      await channel.send({
        content: `<@${message.author.id}>`,
        embeds: [new EmbedBuilder()
          .setTitle("Box Score Check Failed")
          .setColor(0xe74c3c)
          .setDescription(userFacingError(err))],
      }).catch(() => undefined);
      return;
    }
  }

  let ex = existing;
  if (!ex) {
    ex = {
      guildId: message.guildId,
      channel,
      userId: message.author.id,
      imageUrls: [],
      userMessageIds: [],
      botMessageIds: [],
      phase: "awaiting_missing",
      timer: null,
      expiresAt: 0,
      busy: false,
    };
    exchanges.set(key, ex);
  }

  ex.channel = channel;
  ex.imageUrls.push(...images);
  ex.userMessageIds.push(message.id);

  if (ex.busy) return; // a parse is already in flight; the new images are captured for next pass
  ex.busy = true;
  try {
    await advanceExchange(ex);
  } finally {
    ex.busy = false;
  }
}

export async function handleCommissionerBoxScoreSubmissionMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot) return false;
  const key = exKey(message.guildId, message.author.id);
  const session = commissionerSubmissionSessions.get(key);
  if (!session || session.channelId !== message.channelId) return false;
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return false;
  const channel = message.channel as TextChannel;

  const images = [...message.attachments.values()]
    .filter((a) => (a.contentType?.startsWith("image/") ?? false) || /\.(png|jpe?g|webp)$/i.test(a.name ?? ""))
    .map((a) => a.url);
  if (images.length === 0) return false;

  // Don't delete the message yet — the Discord CDN URL expires once the message is
  // deleted, and Tesseract OCR can take 15-30s. We delete after submission completes.
  commissionerSubmissionSessions.delete(key);

  if (images.length !== 1) {
    await message.delete().catch(() => undefined);
    await channel.send({
      content: `<@${message.author.id}>`,
      embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setColor(0xe74c3c).setDescription("Upload exactly one box score image for commissioner submissions.")],
    }).catch(() => undefined);
    return true;
  }

  const working = await channel.send({
    embeds: [new EmbedBuilder().setTitle("Reading box score...").setDescription(`Validating ${session.gameLabel} for Week ${session.weekNumber}.`)],
  }).catch(() => null);

  try {
    const preview = await recApi.parseBoxScore({
      guildId: session.guildId,
      discordId: session.userId,
      imageUrls: images,
      seasonNumber: session.seasonNumber ?? null,
      weekNumber: session.weekNumber,
      commissionerSubmission: true,
    });
    const missing: string[] = preview.missingRequired ?? [];
    if (missing.length > 0) {
      await message.delete().catch(() => undefined);
      await working?.edit({
        embeds: [new EmbedBuilder()
          .setTitle("Missing required fields")
          .setColor(0xf1c40f)
          .setDescription(`I couldn't read these required field(s):\n\n${missing.map((m) => `• **${m}**`).join("\n")}\n\nStart Box Score Submissions again and upload a clearer image.`)],
      }).catch(() => undefined);
      return true;
    }

    const result = await recApi.submitBoxScore({
      guildId: session.guildId,
      discordId: session.userId,
      imageUrls: images,
      discordChannelId: channel.id,
      discordMessageId: message.id,
      seasonNumber: session.seasonNumber ?? null,
      weekNumber: session.weekNumber,
      expectedGameId: session.gameId,
      commissionerSubmission: true,
    });

    // Image is no longer needed — delete the message now that submission is saved.
    await message.delete().catch(() => undefined);

    const routes = await getGuildRoutes(session.guildId);
    const payoutsChannelId: string | null = routes?.pending_payouts_channel_id ?? null;
    let posted = false;
    if (payoutsChannelId) {
      const ch = await channel.client.channels.fetch(payoutsChannelId).catch(() => null);
      if (ch && ch.isTextBased() && !ch.isDMBased()) {
        await (ch as TextChannel).send({ embeds: [buildPayoutReviewEmbed(result)], components: buildPayoutReviewRows(result.submissionId) });
        posted = true;
      }
    }

    await working?.edit({
      embeds: [new EmbedBuilder()
        .setTitle("Box Score Submitted")
        .setColor(0x2ecc71)
        .setDescription(posted
          ? `Parsed ${session.gameLabel} and sent it to Pending Payouts for commissioner approval.`
          : `Parsed ${session.gameLabel}, but no Pending Payouts channel is configured.`)],
    }).catch(() => undefined);
  } catch (err) {
    await message.delete().catch(() => undefined);
    await working?.edit({
      embeds: [new EmbedBuilder().setTitle("Box Score Submission Failed").setColor(0xe74c3c).setDescription(userFacingError(err))],
    }).catch(() => undefined);
  }
  return true;
}

async function advanceExchange(ex: Exchange) {
  // Drop any prior bot prompt so only the latest guidance is visible.
  if (ex.botMessageIds.length) {
    await deleteMessages(ex.channel, ex.botMessageIds);
    ex.botMessageIds = [];
  }
  if (ex.timer) { clearTimeout(ex.timer); ex.timer = null; }

  // Parse (stateless — no DB write yet).
  const working = await ex.channel.send({
    embeds: [new EmbedBuilder().setTitle("Reading box score…").setDescription("Running OCR on your screenshot. This can take 15–30 seconds.")],
  }).catch(() => null);
  if (working) ex.botMessageIds.push(working.id);

  let preview: any;
  try {
    preview = await recApi.parseBoxScore({ guildId: ex.guildId, discordId: ex.userId, imageUrls: ex.imageUrls });
  } catch (err) {
    await deleteMessages(ex.channel, ex.botMessageIds);
    ex.botMessageIds = [];
    await clearExchange(ex, { deleteUserImages: false });
    await ex.channel.send({
      content: `<@${ex.userId}>`,
      embeds: [new EmbedBuilder()
        .setTitle("Box Score Failed")
        .setColor(0xe74c3c)
        .setDescription(userFacingError(err))],
    }).catch(() => undefined);
    return;
  }

  const missing: string[] = preview.missingRequired ?? [];
  if (missing.length > 0) {
    ex.phase = "awaiting_missing";
    await deleteMessages(ex.channel, ex.botMessageIds);
    ex.botMessageIds = [];
    const msg = await ex.channel.send({
      content: `<@${ex.userId}>`,
      embeds: [new EmbedBuilder()
        .setTitle("Missing required fields")
        .setColor(0xf1c40f)
        .setDescription(
          `I couldn't read these required field(s):\n\n${missing.map((m) => `• **${m}**`).join("\n")}\n\n` +
          "Post another screenshot that clearly shows them within **5 minutes**, or this submission will be discarded."
        )],
    }).catch(() => null);
    if (msg) ex.botMessageIds.push(msg.id);
    scheduleTimeout(ex, MISSING_FIELDS_MS, () => {
      void onExchangeTimeout(ex, "Your box score was discarded — the missing fields weren't supplied within 5 minutes. Feel free to post again in the box scores channel.");
    });
    return;
  }

  // Complete — submit automatically and post the payout ledger.
  let result: any;
  try {
    result = await recApi.submitBoxScore({
      guildId: ex.guildId,
      discordId: ex.userId,
      imageUrls: ex.imageUrls,
      discordChannelId: ex.channel.id,
      discordMessageId: ex.userMessageIds[0] ?? null,
    });
  } catch (err) {
    await deleteMessages(ex.channel, ex.botMessageIds);
    ex.botMessageIds = [];
    await clearExchange(ex, { deleteUserImages: false });
    await ex.channel.send({
      content: `<@${ex.userId}>`,
      embeds: [new EmbedBuilder()
        .setTitle("Box Score Submission Failed")
        .setColor(0xe74c3c)
        .setDescription(userFacingError(err))],
    }).catch(() => undefined);
    return;
  }

  await deleteMessages(ex.channel, ex.botMessageIds);
  ex.botMessageIds = [];
  ex.userMessageIds = [];
  exchanges.delete(exKey(ex.guildId, ex.userId));

  const routes = await getGuildRoutes(ex.guildId);
  const payoutsChannelId: string | null = routes?.pending_payouts_channel_id ?? null;

  const ledgerMsg = await ex.channel.send({
    content: `<@${ex.userId}>`,
    embeds: [buildPayoutReviewEmbed(result)],
  }).catch(() => null);

  if (ledgerMsg?.id) {
    await recApi.updateBoxScoreLedgerMessage({
      submissionId: result.submissionId,
      ledgerDiscordMessageId: ledgerMsg.id,
    }).catch(() => undefined);
  }

  if (payoutsChannelId) {
    try {
      const ch = await ex.channel.client.channels.fetch(payoutsChannelId);
      if (ch && ch.isTextBased() && !ch.isDMBased()) {
        await (ch as TextChannel).send({ embeds: [buildPayoutReviewEmbed(result)], components: buildPayoutReviewRows(result.submissionId) });
      }
    } catch {
      /* pending payouts channel unavailable */
    }
  }

  const flagged: boolean = !!result.flagged;
  if (flagged) {
    const roleId: string | null = routes?.commissioner_role_id ?? null;
    const reasons: string[] = result.flagReasons ?? [];
    await ex.channel.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      embeds: [new EmbedBuilder()
        .setTitle("⚠️ Box score flagged for review")
        .setColor(0xf1c40f)
        .setDescription(
          `<@${ex.userId}>'s box score couldn't be auto-verified:\n\n${reasons.map((r) => `• ${r}`).join("\n")}\n\n` +
          "A commissioner should confirm this matchup before approving the payout."
        )],
      allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
    }).catch(() => undefined);
  }
}

// Safety-net sweep for exchanges whose timer was lost (called on an interval).
export function sweepBoxScoreExchanges() {
  const now = Date.now();
  for (const ex of [...exchanges.values()]) {
    if (ex.expiresAt && now > ex.expiresAt + 10_000) {
      void clearExchange(ex, { deleteUserImages: false });
    }
  }
}

// ─── Confirm / cancel (in the box scores channel) ─────────────────────────────

export async function handleBoxScoreSubmitConfirm(interaction: ButtonInteraction) {
  return interaction.reply({
    content: "This confirmation step is no longer used. Post your box score screenshot directly in the box scores channel.",
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleBoxScoreCancel(interaction: ButtonInteraction) {
  await interaction.deferUpdate().catch(() => undefined);
  if (!interaction.inCachedGuild()) return;
  const ex = exchanges.get(exKey(interaction.guildId, interaction.user.id));
  if (ex) await clearExchange(ex, { deleteUserImages: false });
}

// ─── Commissioner review (on the Pending Payouts embed or the pull inbox) ──────

export async function handleBoxScoreApprove(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can approve box scores.", flags: MessageFlags.Ephemeral });
  }
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.approvePrefix.length);

  await interaction.deferUpdate();
  try {
    const result = await recApi.reviewBoxScore({ submissionId, action: "approve", reviewedByDiscordId: interaction.user.id });
    const paidPlayerList = formatPaidPlayers(result);
    const statusValue = `✅ Approved by <@${interaction.user.id}> — $${result.totalPaid} paid to ${result.playersPaid ?? result.playersPayd} player(s)${paidPlayerList ? `: ${paidPlayerList}` : ""}.`;

    if (result.ledgerChannelId && result.ledgerMessageId && interaction.inCachedGuild()) {
      const ledgerChannel = await interaction.guild.channels.fetch(result.ledgerChannelId).catch(() => null);
      if (ledgerChannel?.isTextBased()) {
        const ledgerMessage = await ledgerChannel.messages.fetch(result.ledgerMessageId).catch(() => null);
        if (ledgerMessage?.embeds[0]) {
          const ledgerEmbed = EmbedBuilder.from(ledgerMessage.embeds[0]).setColor(0x2ecc71);
          ledgerEmbed.addFields({ name: "STATUS", value: statusValue });
          await ledgerMessage?.edit({ embeds: [ledgerEmbed], components: [] }).catch(() => undefined);
        }
      }
    }

    if (result.sourceChannelId && result.sourceMessageId && interaction.inCachedGuild()) {
      const sourceChannel = await interaction.guild.channels.fetch(result.sourceChannelId).catch(() => null);
      if (sourceChannel?.isTextBased()) {
        const sourceMessage = await sourceChannel.messages.fetch(result.sourceMessageId).catch(() => null);
        await sourceMessage?.react("✅").catch(() => undefined);
      }
    }

    const base = interaction.message.embeds[0];
    const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Box Score")).setColor(0x2ecc71);
    embed.addFields({ name: "STATUS", value: statusValue });
    return interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [],
    });
  }
}

function formatPaidPlayers(result: any): string {
  const paidPlayers = Array.isArray(result?.paidPlayers) ? result.paidPlayers : [];
  return paidPlayers
    .map((player: any) => player?.discordId ? `<@${player.discordId}>` : player?.displayName ? `@${player.displayName}` : null)
    .filter(Boolean)
    .join(", ");
}

export async function handleBoxScoreDenyModal(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can deny box scores.", flags: MessageFlags.Ephemeral });
  }
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.denyModalPrefix.length);

  const modal = new ModalBuilder()
    .setCustomId(`${BOX_SCORE_CUSTOM_IDS.denyModalPrefix}${submissionId}`)
    .setTitle("Deny Box Score")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(BOX_SCORE_CUSTOM_IDS.denyReasonInput)
          .setLabel("Reason for denial (shown to submitter)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(200)
      )
    );

  return interaction.showModal(modal);
}

export async function handleBoxScoreDenySubmit(interaction: ModalSubmitInteraction) {
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.denyModalPrefix.length);
  const reason = interaction.fields.getTextInputValue(BOX_SCORE_CUSTOM_IDS.denyReasonInput).trim() || null;

  await interaction.deferUpdate();
  try {
    await recApi.reviewBoxScore({ submissionId, action: "deny", reviewedByDiscordId: interaction.user.id, deniedReason: reason });
    const base = interaction.message?.embeds?.[0];
    const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Box Score")).setColor(0xe74c3c);
    embed.addFields({ name: "STATUS", value: `⛔ Denied by <@${interaction.user.id}>${reason ? ` — ${reason}` : ""}.` });
    return interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [],
    });
  }
}

// ─── Commissioner review (on the Pending Payouts embed or the pull inbox) ──────

export async function handleBoxScoreInbox(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can access the box score inbox.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });

  await interaction.deferUpdate();
  try {
    const { submissions } = await recApi.listPendingBoxScores(interaction.guildId);

    if (submissions.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Box Score Inbox").setDescription("No pending box score submissions.")],
        components: [buildInboxBackRow()],
      });
    }

    const first = submissions[0];
    return interaction.editReply({
      embeds: [buildInboxItemEmbed(first, submissions.length)],
      components: buildInboxReviewRows(first.id),
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildInboxBackRow()],
    });
  }
}

export async function handleBoxScoreSubmissions(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can submit prior box scores.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });

  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const currentWeek = Math.max(1, Number(week?.league?.current_week ?? 1));
  const seasonNumber = Number(week?.league?.season_number ?? week?.league?.display_season_number ?? 1);

  commissionerSubmissionSessions.delete(exKey(interaction.guildId, interaction.user.id));
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Box Score Submissions")
      .setDescription("Select the game week first, then choose the scheduled game. After that, upload one box score image in this channel. The bot deletes the image after parsing and sends the payout review to Pending Payouts.")],
    components: buildAdminWeekRows(currentWeek, seasonNumber),
  });
}

export async function handleBoxScoreAdminWeekSelect(interaction: StringSelectMenuInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can submit prior box scores.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const weekNumber = Number(interaction.values[0] ?? 1);
  await interaction.deferUpdate();
  try {
    const result = await recApi.listBoxScoreGames({ guildId: interaction.guildId, weekNumber });
    const games = result?.games ?? [];
    if (!games.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setColor(0xf1c40f).setDescription(`No scheduled games are logged for Week ${weekNumber}. Upload the schedule first, then try again.`)],
        components: [buildAdminCancelRow()],
      });
    }
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setDescription(`Select the scheduled game for Week ${weekNumber}.`)],
      components: buildAdminGameRows(games, weekNumber, result?.league?.seasonNumber ?? null),
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildAdminCancelRow()],
    });
  }
}

export async function handleBoxScoreAdminGameSelect(interaction: StringSelectMenuInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can submit prior box scores.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });

  const parts = (interaction.values[0] ?? "").split(":");
  const weekNumber = Number(parts[0]);
  const seasonNumber = parts[1] ? Number(parts[1]) : null;
  const gameId = parts[2];
  const matchup = parts.slice(3).join(":").trim();
  const gameLabel = matchup || `Week ${weekNumber} selected game`;
  commissionerSubmissionSessions.set(exKey(interaction.guildId, interaction.user.id), {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    weekNumber,
    seasonNumber,
    gameId,
    gameLabel,
  });

  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Upload Box Score")
      .setDescription(`Now upload exactly one box score image for **${gameLabel}** — Week ${weekNumber} — in this channel. The image will be deleted after parsing.`)],
    components: [buildAdminCancelRow()],
  });
}

export async function handleBoxScoreAdminCancel(interaction: ButtonInteraction) {
  if (interaction.inCachedGuild()) commissionerSubmissionSessions.delete(exKey(interaction.guildId, interaction.user.id));
  return interaction.update({
    embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setDescription("Submission workflow cancelled.")],
    components: [buildInboxBackRow()],
  });
}

// ─── Embed builders ───────────────────────────────────────────────────────────

function statLines(stats: Record<string, { team1: string; team2: string } | null> | null | undefined, limit: number): string {
  if (!stats) return "*No stats parsed*";
  const preferredOrder = [
    "off_yards_gained",
    "off_rush_yards",
    "off_pass_yards",
    "off_first_down",
    "punt_return_yards",
    "kick_return_yards",
    "total_yards_gained",
    "turnovers",
    "third_down_conversions",
    "fourth_down_conversions",
    "two_point_conversions",
    "red_zone_off_percentage",
    "red_zone_off_td",
    "red_zone_off_fg",
    "penalty_yards",
  ];
  const keys = [
    ...preferredOrder.filter((key) => stats[key]),
    ...Object.keys(stats).filter((key) => !preferredOrder.includes(key)),
  ];
  const lines = keys
    .filter((key) => {
      const v = stats[key];
      return v && ((v.team1 ?? "").trim().length > 0 || (v.team2 ?? "").trim().length > 0);
    })
    .slice(0, limit)
    .map((key) => {
      const v = stats[key];
      const t1 = (v?.team1 ?? "").trim();
      const t2 = (v?.team2 ?? "").trim();
      return `${prettifyKey(key)}: **${t1 || "?"}** / **${t2 || "?"}**`;
    });
  return lines.length ? lines.join("\n") : "*No stats parsed*";
}

// Each team's defensive view is the mirror of the opponent's offense: turnovers
// a team committed are "generated turnovers" for the other side, and the
// opponent's yardage is what this team allowed.
function defensiveSummary(stats: Record<string, { team1: string; team2: string } | null> | null | undefined): string {
  if (!stats) return "*n/a*";
  const to = stats["turnovers"];
  const yds = stats["total_yards_gained"] ?? stats["off_yards_gained"];
  const rz = stats["red_zone_def_percentage"];
  const g1 = to?.team2 || "?", g2 = to?.team1 || "?";
  const a1 = yds?.team2 || "?", a2 = yds?.team1 || "?";
  const rz1 = rz?.team1 || "?", rz2 = rz?.team2 || "?";
  return `Generated TO: **${g1}** / **${g2}**\nYards Allowed: **${a1}** / **${a2}**\nRed Zone Def %: **${rz1}** / **${rz2}**`;
}

function buildPayoutReviewEmbed(result: any): EmbedBuilder {
  const q = result?.quarterScores;
  const qText = q
    ? `${result.team1Abbr ?? "T1"}: ${(q.team1 ?? []).join(" | ")}\n${result.team2Abbr ?? "T2"}: ${(q.team2 ?? []).join(" | ")}`
    : "*Not available*";

  const embed = new EmbedBuilder()
    .setTitle("Box Score — Pending Approval")
    .setColor(0x3498db)
    .addFields(
      { name: "GAME", value: `**${result.team1Abbr ?? "?"}** ${result.team1Score ?? "?"} – ${result.team2Score ?? "?"} **${result.team2Abbr ?? "?"}** — Week ${result.weekNumber ?? "?"}`, inline: false },
      { name: "QUARTER SCORES", value: qText.slice(0, 512), inline: false },
      { name: "TEAM STATS  (T1 / T2)", value: statLines(result?.stats, 16).slice(0, 1024), inline: false },
      { name: "DEFENSE  (T1 / T2)", value: defensiveSummary(result?.stats).slice(0, 1024), inline: false },
      { name: "SUBMITTED BY", value: `<@${result.submittedByDiscordId}>`, inline: true },
    );
  if (result?.flagged && (result.flagReasons ?? []).length) {
    embed.setColor(0xf1c40f);
    embed.addFields({ name: "⚠️ FLAGGED", value: (result.flagReasons as string[]).map((r) => `• ${r}`).join("\n").slice(0, 1024), inline: false });
  } else if (!result?.gameMatched) {
    embed.addFields({ name: "⚠️ NOTICE", value: "Could not auto-match to a scheduled game. You can still approve.", inline: false });
  }
  embed.setFooter({ text: `Submission ${result.submissionId}` });
  return embed;
}

function buildInboxItemEmbed(sub: any, totalPending: number): EmbedBuilder {
  const quarterScores = sub.quarter_scores as { team1: number[]; team2: number[] } | null;
  const quarterText = quarterScores
    ? `${sub.team1_abbr ?? "T1"}: ${quarterScores.team1.join(" | ")}\n${sub.team2_abbr ?? "T2"}: ${quarterScores.team2.join(" | ")}`
    : "*Not available*";

  return new EmbedBuilder()
    .setTitle(`Box Score Inbox (${totalPending} pending)`)
    .addFields(
      { name: "GAME", value: `**${sub.team1_abbr ?? "?"}** ${sub.home_score ?? "?"} – ${sub.away_score ?? "?"} **${sub.team2_abbr ?? "?"}** — Week ${sub.week_number ?? "?"}`, inline: false },
      { name: "QUARTER SCORES", value: quarterText.slice(0, 512), inline: false },
      { name: "KEY STATS  (T1 / T2)", value: statLines(sub.team_stats, 10).slice(0, 1024), inline: false },
      { name: "SUBMITTED BY", value: `<@${sub.submitted_by_discord_id}>`, inline: true },
    )
    .setFooter({ text: `ID: ${sub.id}` });
}

// ─── Component builders ───────────────────────────────────────────────────────

function buildPayoutReviewRows(submissionId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.approvePrefix}${submissionId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.denyModalPrefix}${submissionId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildInboxReviewRows(submissionId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.approvePrefix}${submissionId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.denyModalPrefix}${submissionId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.inboxBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildInboxBackRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.inboxBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Secondary)
  );
}

function buildAdminWeekRows(currentWeek: number, seasonNumber: number) {
  const maxOptions = Math.min(Math.max(currentWeek, 1), 25);
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(BOX_SCORE_CUSTOM_IDS.adminWeekSelect)
        .setPlaceholder("Select week")
        .addOptions(Array.from({ length: maxOptions }, (_, idx) => {
          const week = idx + 1;
          return new StringSelectMenuOptionBuilder().setLabel(`Week ${week}`).setValue(String(week)).setDescription(`Season ${seasonNumber}, Week ${week}`);
        }))
    ),
    buildAdminCancelRow(),
  ];
}

function teamLabel(team: any) {
  return team?.display_abbr ?? team?.abbreviation ?? team?.name ?? "TBD";
}

function buildAdminGameRows(games: any[], weekNumber: number, seasonNumber: number | null) {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(BOX_SCORE_CUSTOM_IDS.adminGameSelect)
        .setPlaceholder("Select scheduled game")
        .addOptions(games.slice(0, 25).map((game: any) => {
          const away = teamLabel(game.away_team);
          const home = teamLabel(game.home_team);
          const label = `${away} at ${home}`.slice(0, 100);
          // Carry the matchup in the value so the upload prompt can name the game.
          return new StringSelectMenuOptionBuilder()
            .setLabel(label)
            .setValue(`${weekNumber}:${seasonNumber ?? ""}:${game.id}:${label}`.slice(0, 100))
            .setDescription(`Week ${weekNumber}`.slice(0, 100));
        }))
    ),
    buildAdminCancelRow(),
  ];
}

function buildAdminCancelRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.adminCancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.inboxBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Secondary)
  );
}
