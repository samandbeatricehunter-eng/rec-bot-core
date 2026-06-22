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
} from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";

// ─── Custom IDs ───────────────────────────────────────────────────────────────

export const BOX_SCORE_CUSTOM_IDS = {
  submitConfirmPrefix: "rec:box_score:submit_confirm:",  // + submissionId
  cancel: "rec:box_score:cancel",
  inboxOpen: "rec:league_mgmt:box_score_inbox",
  approvePrefix: "rec:box_score:approve:",              // + submissionId
  denyModalPrefix: "rec:box_score:deny_modal:",         // + submissionId
  denyReasonInput: "rec:box_score:deny_reason",
  inboxBack: "rec:box_score:inbox_back",
} as const;

// ─── Pending upload store ─────────────────────────────────────────────────────
// Keyed by `${userId}:${channelId}` — allows one pending upload per user per channel.

type PendingUpload = { guildId: string; channelId: string; userId: string; expiresAt: number };
const pendingUploads = new Map<string, PendingUpload>();

export function registerPendingUpload(userId: string, channelId: string, guildId: string) {
  const key = `${userId}:${channelId}`;
  pendingUploads.set(key, { guildId, channelId, userId, expiresAt: Date.now() + 5 * 60 * 1000 });
}

export function popPendingUpload(userId: string, channelId: string): PendingUpload | null {
  const key = `${userId}:${channelId}`;
  const pending = pendingUploads.get(key);
  if (!pending) return null;
  if (Date.now() > pending.expiresAt) { pendingUploads.delete(key); return null; }
  pendingUploads.delete(key);
  return pending;
}

export function cleanupExpiredUploads() {
  const now = Date.now();
  for (const [key, val] of pendingUploads) {
    if (now > val.expiresAt) pendingUploads.delete(key);
  }
}

// ─── Box score button handler ─────────────────────────────────────────────────

export async function handleBoxScoreButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "This action requires a guild context.", flags: MessageFlags.Ephemeral });
  }
  registerPendingUpload(interaction.user.id, interaction.channelId, interaction.guildId);
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Box Score Upload")
        .setDescription(
          "Upload **both box score screenshots** in this channel now.\n\n" +
          "• Take the first screenshot on the default **Box Score** tab\n" +
          "• Scroll down and take the second screenshot to capture the remaining stats\n" +
          "• Attach both images in a **single message**\n\n" +
          "You have **5 minutes**. Type anything else or wait and the request will expire."
        )
        .setFooter({ text: "Only your next message with 2 images will be processed." }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Message handler (called from messageCreate in index-timeout.ts) ──────────

export async function handleBoxScoreMessage(message: Message) {
  if (!message.inGuild()) return false;

  const pending = popPendingUpload(message.author.id, message.channelId);
  if (!pending) return false;

  const images = message.attachments
    .filter((a) => a.contentType?.startsWith("image/") ?? false)
    .map((a) => a.url);

  if (images.length < 2) {
    await message.reply({
      content: "I need **2 screenshots** (Box Score page 1 + page 2). Please click 'Box Score & Scoring Summary' again and attach both images at once.",
    }).catch(() => undefined);
    return true;
  }

  // Send a "processing" reply first
  const processingMsg = await message.reply({
    embeds: [new EmbedBuilder().setTitle("Parsing Box Score...").setDescription("Running OCR on your screenshots. This may take 15–30 seconds.")],
  }).catch(() => null);

  try {
    const result = await recApi.parseBoxScore({
      guildId: pending.guildId,
      discordId: message.author.id,
      imageUrl1: images[0],
      imageUrl2: images[1],
      discordChannelId: message.channelId,
      discordMessageId: message.id,
    });

    const embed = buildParsedResultEmbed(result);
    const rows = buildConfirmRows(result.submissionId);

    if (processingMsg) {
      await processingMsg.edit({ embeds: [embed], components: rows });
    } else {
      await message.reply({ embeds: [embed], components: rows });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const failEmbed = new EmbedBuilder()
      .setTitle("Parse Failed")
      .setColor(0xe74c3c)
      .setDescription(`Could not parse your box score screenshots.\n\n\`${errMsg}\`\n\nPlease try again or contact your commissioner.`);
    if (processingMsg) {
      await processingMsg.edit({ embeds: [failEmbed], components: [] });
    } else {
      await message.reply({ embeds: [failEmbed] });
    }
  }

  return true;
}

// ─── Confirm / cancel buttons ─────────────────────────────────────────────────

export async function handleBoxScoreSubmitConfirm(interaction: ButtonInteraction) {
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.submitConfirmPrefix.length);

  await interaction.deferUpdate();
  try {
    await recApi.submitBoxScore({ submissionId, discordId: interaction.user.id });
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Box Score Submitted")
          .setColor(0x2ecc71)
          .setDescription("Your box score has been submitted for commissioner review. You and your opponent will be paid once it's approved."),
      ],
      components: [],
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Submission Failed")
          .setColor(0xe74c3c)
          .setDescription(`Could not submit: ${err instanceof Error ? err.message : String(err)}`),
      ],
      components: [],
    });
  }
}

export async function handleBoxScoreCancel(interaction: ButtonInteraction) {
  return interaction.update({
    embeds: [new EmbedBuilder().setTitle("Cancelled").setDescription("Box score submission cancelled.")],
    components: [],
  });
}

// ─── Commissioner inbox ───────────────────────────────────────────────────────

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
    const embed = buildInboxItemEmbed(first, submissions.length);
    const rows = buildReviewRows(first.id, submissions.length > 1);

    return interaction.editReply({ embeds: [embed], components: rows });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildInboxBackRow()],
    });
  }
}

export async function handleBoxScoreApprove(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can approve box scores.", flags: MessageFlags.Ephemeral });
  }
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.approvePrefix.length);

  await interaction.deferUpdate();
  try {
    const result = await recApi.reviewBoxScore({ submissionId, action: "approve", reviewedByDiscordId: interaction.user.id });
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Box Score Approved")
          .setColor(0x2ecc71)
          .setDescription(`Game result recorded. $${result.payoutAmount} paid to ${result.playersPayd} player(s).`),
      ],
      components: [buildInboxBackRow()],
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildInboxBackRow()],
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
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Box Score Denied").setColor(0xe74c3c).setDescription("Submission has been denied.")],
      components: [buildInboxBackRow()],
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildInboxBackRow()],
    });
  }
}

// ─── Embed builders ───────────────────────────────────────────────────────────

function buildParsedResultEmbed(result: Awaited<ReturnType<typeof recApi.parseBoxScore>>) {
  const { parsed, team1Name, team2Name, gameMatched } = result;
  const score = parsed.score;

  const scoreText = score
    ? [
        `**${score.team1Abbr}** (${team1Name ?? "Unknown"})  **${score.team1Score}**`,
        `**${score.team2Abbr}** (${team2Name ?? "Unknown"})  **${score.team2Score}**`,
        score.team1Quarters.length > 0
          ? `Qtrs: ${score.team1Quarters.join(" | ")} — ${score.team2Quarters.join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "*Score could not be parsed*";

  const statEntries = Object.entries(parsed.stats as Record<string, { team1: string; team2: string }>);
  const statsText = statEntries.length > 0
    ? statEntries
        .map(([key, vals]) => {
          const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          return `${label}: **${vals?.team1 || "?"}** / **${vals?.team2 || "?"}**`;
        })
        .join("\n")
    : "*No stats parsed*";

  const warnings = parsed.warnings.length > 0
    ? `⚠️ ${parsed.warnings.slice(0, 3).join("\n⚠️ ")}`
    : null;

  const embed = new EmbedBuilder()
    .setTitle("Box Score Parsed — Review & Submit")
    .addFields(
      { name: "SCORE", value: scoreText.slice(0, 1024), inline: false },
      { name: "TEAM STATS  (Team 1 / Team 2)", value: statsText.slice(0, 1024), inline: false }
    );

  if (!gameMatched) embed.addFields({ name: "⚠️ NOTICE", value: "Game could not be auto-matched to the current week's schedule. The commissioner can still approve.", inline: false });
  if (warnings) embed.addFields({ name: "PARSE WARNINGS", value: warnings.slice(0, 1024), inline: false });
  embed.setFooter({ text: "Review the data above. If it looks correct, click Submit for Review." });

  return embed;
}

function buildInboxItemEmbed(sub: any, totalPending: number) {
  const stats = sub.team_stats as Record<string, { team1: string; team2: string } | null> | null;
  const statText = stats
    ? Object.entries(stats)
        .slice(0, 10)
        .map(([k, v]) => {
          const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          return `${label}: **${v?.team1 || "?"}** / **${v?.team2 || "?"}**`;
        })
        .join("\n")
    : "*No stat data*";

  const quarterScores = sub.quarter_scores as { team1: number[]; team2: number[] } | null;
  const quarterText = quarterScores
    ? `${sub.team1_abbr ?? "T1"}: ${quarterScores.team1.join(" | ")}\n${sub.team2_abbr ?? "T2"}: ${quarterScores.team2.join(" | ")}`
    : "*Not available*";

  return new EmbedBuilder()
    .setTitle(`Box Score Inbox (${totalPending} pending)`)
    .addFields(
      { name: "GAME", value: `**${sub.team1_abbr ?? "?"}** ${sub.home_score ?? "?"} – ${sub.away_score ?? "?"} **${sub.team2_abbr ?? "?"}** — Week ${sub.week_number ?? "?"}`, inline: false },
      { name: "QUARTER SCORES", value: quarterText.slice(0, 512), inline: false },
      { name: "KEY STATS  (T1 / T2)", value: statText.slice(0, 1024), inline: false },
      { name: "SUBMITTED BY", value: `<@${sub.submitted_by_discord_id}>`, inline: true },
    )
    .setFooter({ text: `ID: ${sub.id}` });
}

// ─── Component builders ───────────────────────────────────────────────────────

function buildConfirmRows(submissionId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BOX_SCORE_CUSTOM_IDS.submitConfirmPrefix}${submissionId}`)
        .setLabel("Submit for Review")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(BOX_SCORE_CUSTOM_IDS.cancel)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildReviewRows(submissionId: string, hasMore: boolean) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOX_SCORE_CUSTOM_IDS.approvePrefix}${submissionId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${BOX_SCORE_CUSTOM_IDS.denyModalPrefix}${submissionId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(BOX_SCORE_CUSTOM_IDS.inboxBack)
      .setLabel("Back to League Mgmt")
      .setStyle(ButtonStyle.Secondary)
  );
  return [row];
}

function buildInboxBackRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BOX_SCORE_CUSTOM_IDS.inboxBack)
      .setLabel("Back to League Mgmt")
      .setStyle(ButtonStyle.Secondary)
  );
}
