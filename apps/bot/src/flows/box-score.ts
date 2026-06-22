import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Message,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";

// ─── Custom IDs ───────────────────────────────────────────────────────────────

export const BOX_SCORE_CUSTOM_IDS = {
  submitConfirm: "rec:box_score:submit_confirm",
  cancel: "rec:box_score:cancel",
  inboxOpen: "rec:league_mgmt:box_score_inbox",
  approvePrefix: "rec:box_score:approve:",      // + submissionId
  denyModalPrefix: "rec:box_score:deny_modal:", // + submissionId
  denyReasonInput: "rec:box_score:deny_reason",
  inboxBack: "rec:box_score:inbox_back",
} as const;

// ─── Timing windows ────────────────────────────────────────────────────────────

const MISSING_FIELDS_MS = 5 * 60 * 1000; // wait for a re-upload with missing fields
const REVIEW_MS = 5 * 60 * 1000;         // wait for the submitter to confirm

// ─── Per-user exchange state (one active upload per user per guild) ────────────

type ExchangePhase = "awaiting_missing" | "review";

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
  // Only act if this is still the active exchange for the user.
  if (exchanges.get(exKey(ex.guildId, ex.userId)) !== ex) return;
  await clearExchange(ex, { deleteUserImages: true });
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

  const images = [...message.attachments.values()]
    .filter((a) => (a.contentType?.startsWith("image/") ?? false) || /\.(png|jpe?g|webp)$/i.test(a.name ?? ""))
    .map((a) => a.url);

  // Ignore plain chatter — we only act on image uploads.
  if (images.length === 0) return;

  const key = exKey(message.guildId, message.author.id);
  let ex = exchanges.get(key);
  if (!ex) {
    ex = {
      guildId: message.guildId,
      channel,
      userId: message.author.id,
      imageUrls: [],
      userMessageIds: [],
      botMessageIds: [],
      phase: "review",
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

async function advanceExchange(ex: Exchange) {
  // Drop any prior bot prompt so only the latest guidance is visible.
  if (ex.botMessageIds.length) {
    await deleteMessages(ex.channel, ex.botMessageIds);
    ex.botMessageIds = [];
  }
  if (ex.timer) { clearTimeout(ex.timer); ex.timer = null; }

  // Parse (stateless — no DB write yet).
  const working = await ex.channel.send({
    embeds: [new EmbedBuilder().setTitle("Reading box score…").setDescription("Running OCR on your screenshots. This can take 15–30 seconds.")],
  }).catch(() => null);
  if (working) ex.botMessageIds.push(working.id);

  let preview: any;
  try {
    preview = await recApi.parseBoxScore({ guildId: ex.guildId, discordId: ex.userId, imageUrls: ex.imageUrls });
  } catch (err) {
    await deleteMessages(ex.channel, ex.botMessageIds);
    ex.botMessageIds = [];
    await clearExchange(ex, { deleteUserImages: true });
    await dmUser(ex, `Your box score couldn't be processed: ${err instanceof Error ? err.message : String(err)}. Please try again in the box scores channel.`);
    return;
  }

  // Remove the "reading…" placeholder.
  await deleteMessages(ex.channel, ex.botMessageIds);
  ex.botMessageIds = [];

  const missing: string[] = preview.missingRequired ?? [];
  if (missing.length > 0) {
    ex.phase = "awaiting_missing";
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
      void onExchangeTimeout(ex, "Your box score was discarded — the missing fields weren't supplied within 5 minutes. Feel free to start over in the box scores channel.");
    });
    return;
  }

  // Complete — ask the submitter to confirm.
  ex.phase = "review";
  const confirmMsg = await ex.channel.send({
    content: `<@${ex.userId}> here's what I read — confirm to send it to your commissioners for approval.`,
    embeds: [buildPreviewEmbed(preview)],
    components: buildConfirmRows(),
  }).catch(() => null);
  if (confirmMsg) ex.botMessageIds.push(confirmMsg.id);
  scheduleTimeout(ex, REVIEW_MS, () => {
    void onExchangeTimeout(ex, "Your box score confirmation timed out, so it was discarded. Feel free to start over in the box scores channel.");
  });
}

// Safety-net sweep for exchanges whose timer was lost (called on an interval).
export function sweepBoxScoreExchanges() {
  const now = Date.now();
  for (const ex of [...exchanges.values()]) {
    if (ex.expiresAt && now > ex.expiresAt + 10_000) {
      void clearExchange(ex, { deleteUserImages: true });
    }
  }
}

// ─── Confirm / cancel (in the box scores channel) ─────────────────────────────

export async function handleBoxScoreSubmitConfirm(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  }
  const key = exKey(interaction.guildId, interaction.user.id);
  const ex = exchanges.get(key);
  if (!ex || ex.phase !== "review") {
    return interaction.reply({
      content: "This box score submission is no longer active. Please re-post your screenshots in the box scores channel.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();
  if (ex.timer) { clearTimeout(ex.timer); ex.timer = null; }

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
    return interaction.editReply({
      content: "",
      embeds: [new EmbedBuilder().setTitle("Submission failed").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [],
    });
  }

  // Post the approve/deny embed into the Pending Payouts channel.
  const routes = await getGuildRoutes(ex.guildId);
  const payoutsChannelId: string | null = routes?.pending_payouts_channel_id ?? null;
  let posted = false;
  if (payoutsChannelId) {
    try {
      const ch = await interaction.client.channels.fetch(payoutsChannelId);
      if (ch && ch.isTextBased() && !ch.isDMBased()) {
        await (ch as TextChannel).send({ embeds: [buildPayoutReviewEmbed(result)], components: buildPayoutReviewRows(result.submissionId) });
        posted = true;
      }
    } catch {
      /* couldn't post to payouts channel — fall through to inbox-only note */
    }
  }

  // Flagged submission (submitter/opponent mismatch): alert a commissioner on
  // the box scores channel so it gets a closer look before approval.
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

  exchanges.delete(key);

  return interaction.editReply({
    content: "",
    embeds: [new EmbedBuilder()
      .setTitle("Submitted for approval ✅")
      .setColor(flagged ? 0xf1c40f : 0x2ecc71)
      .setDescription(
        (flagged ? "⚠️ Heads up: I couldn't auto-verify this matchup, so it's been flagged for a commissioner to confirm.\n\n" : "") +
        (posted
          ? "Sent to your commissioners for approval. Winners are paid $100 and the other player $50 once it's approved."
          : "Submitted for review. No Pending Payouts channel is configured, so commissioners can review it from **League Mgmt → Box Score Inbox**."))],
    components: [],
  });
}

export async function handleBoxScoreCancel(interaction: ButtonInteraction) {
  await interaction.deferUpdate().catch(() => undefined);
  if (!interaction.inCachedGuild()) return;
  const ex = exchanges.get(exKey(interaction.guildId, interaction.user.id));
  if (ex) await clearExchange(ex, { deleteUserImages: true });
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
    const base = interaction.message.embeds[0];
    const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Box Score")).setColor(0x2ecc71);
    embed.addFields({ name: "STATUS", value: `✅ Approved by <@${interaction.user.id}> — $${result.totalPaid} paid to ${result.playersPayd} player(s).` });
    return interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [],
    });
  }
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

// ─── /menu button → point the user at the box scores channel ──────────────────

export async function handleBoxScoreButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "This action requires a guild context.", flags: MessageFlags.Ephemeral });
  }
  const routes = await getGuildRoutes(interaction.guildId);
  const boxChannelId: string | null = routes?.box_scores_channel_id ?? null;
  const where = boxChannelId ? `<#${boxChannelId}>` : "the designated **Box Scores** channel";

  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle("Upload Box Score")
      .setColor(0x3498db)
      .setDescription(
        `Post your **box score screenshot** in ${where}.\n\n` +
        "• Just the default **Box Score** tab — no need to scroll\n\n" +
        "The bot reads it automatically and walks you through confirming before it goes to your commissioners. " +
        "If it can't read a required stat, it'll tell you exactly what to re-screenshot." +
        (boxChannelId ? "" : "\n\n*No Box Scores channel is configured yet — an admin can set one in Server Setup.*")
      )],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Commissioner pull inbox (League Mgmt → Box Score Inbox) ──────────────────

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

// ─── Embed builders ───────────────────────────────────────────────────────────

function statLines(stats: Record<string, { team1: string; team2: string } | null> | null | undefined, limit: number): string {
  if (!stats) return "*No stats parsed*";
  const lines = Object.entries(stats)
    .filter(([, v]) => v && ((v.team1 ?? "").trim() || (v.team2 ?? "").trim()))
    .slice(0, limit)
    .map(([k, v]) => `${prettifyKey(k)}: **${v?.team1 || "?"}** / **${v?.team2 || "?"}**`);
  return lines.length ? lines.join("\n") : "*No stats parsed*";
}

// Each team's defensive view is the mirror of the opponent's offense: turnovers
// a team committed are "generated turnovers" for the other side, and the
// opponent's yardage is what this team allowed.
function defensiveSummary(stats: Record<string, { team1: string; team2: string } | null> | null | undefined): string {
  if (!stats) return "*n/a*";
  const to = stats["turnovers"];
  const yds = stats["total_yards_gained"] ?? stats["off_yards_gained"];
  const g1 = to?.team2 || "?", g2 = to?.team1 || "?";
  const a1 = yds?.team2 || "?", a2 = yds?.team1 || "?";
  return `Generated TO: **${g1}** / **${g2}**\nYards Allowed: **${a1}** / **${a2}**`;
}

function buildPreviewEmbed(preview: any): EmbedBuilder {
  const score = preview?.parsed?.score;
  const scoreText = score
    ? `**${score.team1Abbr}** ${score.team1Score} – ${score.team2Score} **${score.team2Abbr}**` +
      (score.team1Quarters?.length ? `\nQtrs: ${score.team1Quarters.join(" | ")} — ${score.team2Quarters.join(" | ")}` : "")
    : "*Score not parsed*";

  const embed = new EmbedBuilder()
    .setTitle("Box Score Parsed — Confirm to Submit")
    .setColor(0x3498db)
    .addFields(
      { name: "SCORE", value: scoreText.slice(0, 1024), inline: false },
      { name: `TEAM STATS  (${preview?.team1Name ?? "Team 1"} / ${preview?.team2Name ?? "Team 2"})`, value: statLines(preview?.parsed?.stats, 14).slice(0, 1024), inline: false },
      { name: "DEFENSE  (T1 / T2)", value: defensiveSummary(preview?.parsed?.stats).slice(0, 1024), inline: false },
    );
  if (!preview?.gameMatched) {
    embed.addFields({ name: "⚠️ NOTICE", value: "Couldn't auto-match this to a scheduled game — a commissioner can still approve it.", inline: false });
  }
  embed.setFooter({ text: "If this looks right, click Confirm & Submit. Otherwise Cancel and re-post clearer screenshots." });
  return embed;
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
      { name: "TEAM STATS  (T1 / T2)", value: statLines(result?.stats, 12).slice(0, 1024), inline: false },
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

function buildConfirmRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.submitConfirm).setLabel("Confirm & Submit").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

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
