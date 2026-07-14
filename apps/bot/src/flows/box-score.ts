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
import { isCfb } from "@rec/shared";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { userFacingError } from "../lib/errors.js";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";
import { getAnnouncementsChannel } from "../lib/route-channels.js";
import { isCfbLeague } from "../lib/league-game.js";
import { refreshConfirmableWagerEmbeds } from "./wagers.js";

// ─── Custom IDs ───────────────────────────────────────────────────────────────

export const BOX_SCORE_CUSTOM_IDS = {
  submitConfirm: "rec:box_score:submit_confirm",
  cancel: "rec:box_score:cancel",
  submissionsOpen: "rec:league_mgmt:box_score_inbox",
  adminWeekSelect: "rec:box_score_admin:week",
  adminGameSelect: "rec:box_score_admin:game",
  adminCancel: "rec:box_score_admin:cancel",
  adminAnotherPrefix: "rec:box_score_admin:another:", // + weekNumber:seasonNumber
  approvePrefix: "rec:box_score:approve:",      // + submissionId
  denyModalPrefix: "rec:box_score:deny_modal:", // + submissionId
  denyReasonInput: "rec:box_score:deny_reason",
  inboxBack: "rec:box_score:inbox_back",
  // Corrections workflow
  correctOpenPrefix: "rec:box_score:corr_open:",     // + submissionId
  correctFieldPrefix: "rec:box_score:corr_field:",   // + submissionId  (string select)
  correctMatchupPrefix: "rec:box_score:corr_match:", // + submissionId  (string select)
  correctCancelPrefix: "rec:box_score:corr_cancel:", // + submissionId
  correctModalPrefix: "rec:box_score:corr_modal:",   // + submissionId:field
  correctInputTeam1: "rec:box_score:corr_t1",
  correctInputTeam2: "rec:box_score:corr_t2",
} as const;

// Stat/score fields a commissioner can correct, in the order shown in the dropdown.
// "score", "quarters" and "matchup" are special; the rest are OCR stat keys.
const CORRECTION_FIELDS: { value: string; label: string; kind: "score" | "quarters" | "matchup" | "stat" }[] = [
  { value: "score", label: "Final Score", kind: "score" },
  { value: "quarters", label: "Quarter Scores", kind: "quarters" },
  { value: "matchup", label: "Matchup / Teams", kind: "matchup" },
  { value: "off_yards_gained", label: "Off Yards Gained", kind: "stat" },
  { value: "off_rush_yards", label: "Off Rush Yards", kind: "stat" },
  { value: "off_pass_yards", label: "Off Pass Yards", kind: "stat" },
  { value: "off_first_down", label: "Off First Downs", kind: "stat" },
  { value: "punt_return_yards", label: "Punt Return Yards", kind: "stat" },
  { value: "kick_return_yards", label: "Kick Return Yards", kind: "stat" },
  { value: "total_yards_gained", label: "Total Yards Gained", kind: "stat" },
  { value: "turnovers", label: "Turnovers", kind: "stat" },
  { value: "third_down_conversions", label: "Third Down Conversions", kind: "stat" },
  { value: "fourth_down_conversions", label: "Fourth Down Conversions", kind: "stat" },
  { value: "two_point_conversions", label: "Two Point Conversions", kind: "stat" },
  { value: "red_zone_off_percentage", label: "Red Zone Off %", kind: "stat" },
];
const CORRECTION_FIELD_BY_VALUE = new Map(CORRECTION_FIELDS.map((f) => [f.value, f]));

// CFB's Box Score screen tracks different (and more granular) stats than Madden's —
// see box-score-cfb.parser.ts. The reused keys (off_yards_gained, off_rush_yards,
// off_pass_yards, off_first_down, punt_return_yards, kick_return_yards,
// total_yards_gained, turnovers, red_zone_off_percentage, conversions) carry the
// same canonical meaning as NFL's, just relabeled for CFB's terminology.
const CFB_CORRECTION_FIELDS: { value: string; label: string; kind: "score" | "quarters" | "matchup" | "stat" }[] = [
  { value: "score", label: "Final Score", kind: "score" },
  { value: "quarters", label: "Quarter Scores", kind: "quarters" },
  { value: "matchup", label: "Matchup / Teams", kind: "matchup" },
  { value: "off_first_down", label: "First Downs", kind: "stat" },
  { value: "off_yards_gained", label: "Total Offense", kind: "stat" },
  { value: "total_plays", label: "Total Plays", kind: "stat" },
  { value: "off_rush_attempts", label: "Rush Attempts", kind: "stat" },
  { value: "off_rush_yards", label: "Rush Yards", kind: "stat" },
  { value: "off_rush_tds", label: "Rush TDs", kind: "stat" },
  { value: "pass_completions", label: "Pass Completions", kind: "stat" },
  { value: "pass_attempts", label: "Pass Attempts", kind: "stat" },
  { value: "off_pass_tds", label: "Pass TDs", kind: "stat" },
  { value: "off_pass_yards", label: "Passing Yards", kind: "stat" },
  { value: "third_down_conversions", label: "3rd Down Conversions", kind: "stat" },
  { value: "fourth_down_conversions", label: "4th Down Conversions", kind: "stat" },
  { value: "two_point_conversions", label: "2-Point Conversions", kind: "stat" },
  { value: "red_zone_tds", label: "Red Zone TDs", kind: "stat" },
  { value: "red_zone_fgs", label: "Red Zone FGs", kind: "stat" },
  { value: "red_zone_off_percentage", label: "Red Zone Off %", kind: "stat" },
  { value: "turnovers", label: "Turnovers", kind: "stat" },
  { value: "fumbles_lost", label: "Fumbles Lost", kind: "stat" },
  { value: "interceptions_thrown", label: "Interceptions", kind: "stat" },
  { value: "punt_return_yards", label: "Punt Return Yards", kind: "stat" },
  { value: "kick_return_yards", label: "Kick Return Yards", kind: "stat" },
  { value: "total_yards_gained", label: "Total Yards", kind: "stat" },
  { value: "punts", label: "Punts", kind: "stat" },
  { value: "penalties", label: "Penalties", kind: "stat" },
  { value: "penalty_yards", label: "Penalty Yards", kind: "stat" },
];
const CFB_CORRECTION_FIELD_BY_VALUE = new Map(CFB_CORRECTION_FIELDS.map((f) => [f.value, f]));

// ─── Per-user exchange state (one active upload per user per guild) ────────────

type Exchange = {
  guildId: string;
  channel: TextChannel;
  userId: string;
  imageUrls: string[];
  userMessageIds: string[];
  botMessageIds: string[];
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

// ─── Correction sessions (one open correction flow per user per guild) ─────────
// Captured when the Corrections button is clicked so the field select / modal /
// matchup steps can prefill current values and list the week's games without
// re-fetching on every interaction.
type CorrectionSession = {
  submissionId: string;
  weekNumber: number;
  seasonNumber: number | null;
  team1Abbr: string;
  team2Abbr: string;
  stats: Record<string, { team1: string; team2: string }>;
  quarterScores: { team1: number[]; team2: number[] } | null;
  team1Score: number | null;
  team2Score: number | null;
  isCfb: boolean;
  at: number;
};

function correctionFieldsFor(isCfb: boolean) {
  return isCfb ? CFB_CORRECTION_FIELDS : CORRECTION_FIELDS;
}

function correctionFieldByValueFor(isCfb: boolean) {
  return isCfb ? CFB_CORRECTION_FIELD_BY_VALUE : CORRECTION_FIELD_BY_VALUE;
}
const correctionSessions = new Map<string, CorrectionSession>();
const CORRECTION_SESSION_TTL = 15 * 60 * 1000;

function getCorrectionSession(guildId: string, userId: string): CorrectionSession | null {
  const s = correctionSessions.get(exKey(guildId, userId));
  if (!s) return null;
  if (Date.now() - s.at > CORRECTION_SESSION_TTL) {
    correctionSessions.delete(exKey(guildId, userId));
    return null;
  }
  return s;
}

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

// ─── Background OCR job polling ────────────────────────────────────────────────
// submitBoxScore now returns a jobId immediately; the API runs OCR in the
// background. We poll until it finishes so the submit request never times out.

const BOX_SCORE_POLL_INTERVAL_MS = 2_500;
const BOX_SCORE_POLL_MAX_MS = 180_000; // OCR can queue behind other submissions

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Kick off a submission and wait for the OCR job to finish. Resolves with the
// parsed payout result, or throws an Error whose message is safe to show the user.
async function submitAndAwaitBoxScore(input: Parameters<typeof recApi.submitBoxScore>[0]): Promise<any> {
  const started = await recApi.submitBoxScore(input);
  if (!started?.jobId) throw new Error("Box score could not be queued for processing. Please try again.");

  const deadline = Date.now() + BOX_SCORE_POLL_MAX_MS;
  for (;;) {
    await sleep(BOX_SCORE_POLL_INTERVAL_MS);
    let job: any;
    try {
      job = await recApi.getBoxScoreJob(started.jobId);
    } catch {
      // Transient network/API hiccup — keep polling until the deadline.
      if (Date.now() > deadline) throw new Error("Box score processing timed out. Please re-upload your screenshot.");
      continue;
    }
    if (job?.status === "done") return job.result;
    if (job?.status === "failed") throw new Error(job.error || "Box score processing failed.");
    if (job?.status === "not_found") throw new Error("Box score processing was interrupted. Please re-upload your screenshot.");
    if (Date.now() > deadline) throw new Error("Box score is taking longer than expected. Please re-upload your screenshot in a moment.");
    // status === "processing" → keep polling
  }
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

// ─── Channel listener (called from messageCreate) ─────────────────────────────

const EXCHANGE_WINDOW_MS = 2 * 60 * 1000;

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

  const imageUrl = imageAttachments[0].url;

  const key = exKey(message.guildId, message.author.id);
  const existing = exchanges.get(key);

  // First image in a new upload pass — gate before OCR, and route around starting a
  // fresh exchange if this game already has a submission (either the coach's own
  // pending one from an earlier pass, or their H2H opponent's).
  if (!existing) {
    try {
      const eligibility = await recApi.getBoxScoreUploadEligibility({ guildId: message.guildId, discordId: message.author.id });
      if (eligibility.hasApprovedForWeek) return;
      if (!eligibility.teamId) {
        await channel.send({
          content: `<@${message.author.id}>`,
          embeds: [new EmbedBuilder()
            .setTitle("Box Score Not Accepted")
            .setColor(COLORS.error)
            .setDescription("You aren't linked to a team in this league. Open **/menu → Teams → Request Team** first.")],
        }).catch(() => undefined);
        return;
      }
      if (!eligibility.hasScheduledGame) {
        await channel.send({
          content: `<@${message.author.id}>`,
          embeds: [new EmbedBuilder()
            .setTitle("Box Score Not Accepted")
            .setColor(COLORS.error)
            .setDescription(`You don't have a scheduled game in Week ${eligibility.weekNumber}. Box scores are only accepted when your team has an H2H or CPU matchup this week.`)],
        }).catch(() => undefined);
        return;
      }
      const existingSubmission = eligibility.existingSubmission;
      if (existingSubmission) {
        const isMine = existingSubmission.submittedByDiscordId === message.author.id;
        if (isMine && existingSubmission.status === "pending") {
          // A late second (or third) screenshot for the coach's own already-pending
          // submission — the earlier exchange already finalized and forwarded it to
          // the commissioner inbox, so append instead of starting a new one.
          try {
            await recApi.appendBoxScoreImage({ guildId: message.guildId, discordId: message.author.id, imageUrl });
            await message.react("✅").catch(() => undefined);
            const notice = await channel.send({
              content: `<@${message.author.id}> Added to your pending box score submission — a commissioner will review it.`,
              allowedMentions: { users: [message.author.id] },
            }).catch(() => null);
            if (notice) setTimeout(() => void notice.delete().catch(() => undefined), 10_000);
          } catch (err) {
            await channel.send({
              content: `<@${message.author.id}>`,
              embeds: [new EmbedBuilder().setTitle("Box Score Update Failed").setColor(COLORS.error).setDescription(userFacingError(err))],
            }).catch(() => undefined);
          }
          return;
        }
        if (!isMine) {
          // The other side of this H2H matchup already submitted (or was paid out) —
          // this coach doesn't need to submit their own.
          await message.delete().catch(() => undefined);
          const statusText = existingSubmission.status === "approved" ? "already been reviewed and paid out" : "already submitted";
          const notice = await channel.send({
            content: `<@${message.author.id}>`,
            embeds: [new EmbedBuilder()
              .setTitle("Box Score Not Needed")
              .setColor(COLORS.info)
              .setDescription(`Your opponent's box score for this game has ${statusText} — you don't need to submit your own. Your message was removed.`)],
          }).catch(() => null);
          if (notice) setTimeout(() => void notice.delete().catch(() => undefined), 15_000);
          return;
        }
        // isMine && approved: already handled by hasApprovedForWeek above in practice;
        // fall through defensively and let it start a fresh exchange rather than block.
      }
    } catch (err) {
      await channel.send({
        content: `<@${message.author.id}>`,
        embeds: [new EmbedBuilder()
          .setTitle("Box Score Check Failed")
          .setColor(COLORS.error)
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
      timer: null,
      expiresAt: 0,
      busy: false,
    };
    exchanges.set(key, ex);
  }

  ex.channel = channel;
  ex.imageUrls.push(imageUrl);
  ex.userMessageIds.push(message.id);

  if (ex.busy) return; // a submit is already in flight; further images just sit captured
  if (ex.imageUrls.length >= 2) {
    // Second screenshot arrived — no need to wait out the rest of the window.
    ex.busy = true;
    try {
      await finalizeExchange(ex, { timedOut: false });
    } finally {
      ex.busy = false;
    }
    return;
  }

  // First screenshot of this pass — arm the 2-minute window for the second (top/bottom)
  // screenshot instead of submitting right away.
  if (ex.timer) clearTimeout(ex.timer);
  ex.expiresAt = Date.now() + EXCHANGE_WINDOW_MS;
  ex.timer = setTimeout(() => { void finalizeOnTimeout(ex!); }, EXCHANGE_WINDOW_MS);

  const notice = await channel.send({
    content: `<@${message.author.id}> Screenshot received. Post your **second** box score screenshot (scroll down for the bottom of the stats page) within 2 minutes.`,
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);
  if (notice) ex.botMessageIds.push(notice.id);
}

async function finalizeOnTimeout(ex: Exchange) {
  const current = exchanges.get(exKey(ex.guildId, ex.userId));
  if (!current || current !== ex || ex.busy) return; // already finalized by a second image
  ex.busy = true;
  try {
    await finalizeExchange(ex, { timedOut: true });
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

  // Keep the original message. The API re-hosts the image for commissioner review,
  // and the bot acknowledges this exact post after parsing completes.
  commissionerSubmissionSessions.delete(key);

  if (images.length !== 1) {
    await message.delete().catch(() => undefined);
    await channel.send({
      content: `<@${message.author.id}>`,
      embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setColor(COLORS.error).setDescription("Upload exactly one box score image for commissioner submissions.")],
    }).catch(() => undefined);
    return true;
  }

  try {
    // OCR misses no longer block: any unread field is flagged with "?" on the
    // pending payout, and a commissioner can repair it via Corrections.
    const result = await submitAndAwaitBoxScore({
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

    void result;
    await message.react("✅").catch(() => undefined);
  } catch (err) {
    await message.reply({ embeds: [new EmbedBuilder().setTitle("Box Score Submission Failed").setColor(COLORS.error).setDescription(userFacingError(err))] }).catch(() => undefined);
  }
  return true;
}

// Submits whatever screenshots were captured (1 or 2) and, when finalized by the
// 2-minute timeout with only one screenshot in hand, DMs the coach a reminder that a
// second (top + bottom of the stats page) screenshot is expected — the submission
// itself still goes to the commissioner inbox either way so nothing is ever dropped.
async function finalizeExchange(ex: Exchange, opts: { timedOut: boolean }) {
  // Drop any prior bot prompt so only the latest guidance is visible.
  if (ex.botMessageIds.length) {
    await deleteMessages(ex.channel, ex.botMessageIds);
    ex.botMessageIds = [];
  }
  if (ex.timer) { clearTimeout(ex.timer); ex.timer = null; }

  // OCR misses no longer block: submit immediately, flag any unread cell with "?"
  // on the payout, and let a commissioner repair it via Corrections. submitBoxScore
  // runs the OCR and applies the same self-serve validation the preview used to.
  let result: any;
  try {
    result = await submitAndAwaitBoxScore({
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
        .setColor(COLORS.error)
        .setDescription(userFacingError(err))],
    }).catch(() => undefined);
    return;
  }

  const sourceMessageId = ex.userMessageIds[0] ?? null;
  const userId = ex.userId;
  const imageCount = ex.imageUrls.length;
  const client = ex.channel.client;
  ex.botMessageIds = [];
  exchanges.delete(exKey(ex.guildId, ex.userId));
  void result;
  if (sourceMessageId) {
    const sourceMessage = await ex.channel.messages.fetch(sourceMessageId).catch(() => null);
    await sourceMessage?.react("✅").catch(() => undefined);
  }

  if (opts.timedOut && imageCount < 2) {
    try {
      const discordUser = await client.users.fetch(userId);
      await discordUser.send({
        embeds: [new EmbedBuilder()
          .setTitle("Box Score Reminder")
          .setColor(COLORS.warning)
          .setDescription("Each box score needs **2 screenshots**: one from the **top** of the stats page and one from the **bottom** (scroll down in-game). We forwarded what you posted to the commissioners for review — if you still have the second screenshot, post it in the box scores channel and it'll be added to your pending submission.")],
      });
    } catch { /* DMs closed — non-fatal */ }
  }
}

// Safety-net sweep for exchanges whose timer was somehow lost (called on an interval) —
// finalizes with whatever was captured instead of silently dropping it.
export function sweepBoxScoreExchanges() {
  const now = Date.now();
  for (const ex of [...exchanges.values()]) {
    if (ex.expiresAt && now > ex.expiresAt + 10_000) {
      void finalizeOnTimeout(ex);
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
    if (interaction.inCachedGuild()) await postXfSeasonBadgeAnnouncements(interaction, result).catch(() => undefined);
    // This game now has a confirmed result — flip any pending wager embeds on it.
    if (interaction.inCachedGuild()) void refreshConfirmableWagerEmbeds(interaction.client, interaction.guildId);
    const paidPlayerList = formatPaidPlayers(result);
    const badgeBonusText = result.badgeBonusCount ? `, including ${result.badgeBonusCount} badge bonus(es)` : "";
    const warningsText = result.warnings?.length ? `\n⚠️ ${result.warnings.join(" ")}` : "";
    const statusValue = `✅ Approved by <@${interaction.user.id}> — $${result.totalPaid} paid to ${result.playersPaid ?? result.playersPayd} player(s)${paidPlayerList ? `: ${paidPlayerList}` : ""}${badgeBonusText}.${warningsText}`;

    if (result.ledgerChannelId && result.ledgerMessageId && interaction.inCachedGuild()) {
      const ledgerChannel = await interaction.guild.channels.fetch(result.ledgerChannelId).catch(() => null);
      if (ledgerChannel?.isTextBased()) {
        const ledgerMessage = await ledgerChannel.messages.fetch(result.ledgerMessageId).catch(() => null);
        if (ledgerMessage?.embeds[0]) {
          const ledgerEmbed = EmbedBuilder.from(ledgerMessage.embeds[0]).setColor(COLORS.success);
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
    const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Box Score")).setColor(COLORS.success);
    embed.addFields({ name: "STATUS", value: statusValue });
    return interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setColor(COLORS.error).setDescription(err instanceof Error ? err.message : String(err))],
      components: [],
    });
  }
}

async function postXfSeasonBadgeAnnouncements(interaction: ButtonInteraction, result: any) {
  const events: any[] = Array.isArray(result?.xfSeasonBadgeEvents) ? result.xfSeasonBadgeEvents : [];
  if (!events.length || !interaction.inCachedGuild()) return;

  const cfg = await recApi.getEconomyConfig(interaction.guildId).catch(() => null);
  const channel = await getAnnouncementsChannel(interaction.guild, cfg?.routes ?? {});
  if (!channel || !("send" in channel) || !channel.isTextBased()) return;

  for (const event of events) {
    const userMention = event.userDiscordId ? `<@${event.userDiscordId}>` : event.userDisplayName ? `@${event.userDisplayName}` : "A coach";
    const snapshot = event.stats_snapshot ?? {};
    const qualified = Number(snapshot.earnedCount ?? 0) >= 7
      ? `${snapshot.earnedCount} total earns this season`
      : "reached XF season status";
    await channel.send({
      content: "@everyone",
      embeds: [new EmbedBuilder()
        .setTitle("XF Season Badge Earned")
        .setColor(COLORS.gold)
        .setDescription([
          `${userMention} acquired **${event.badgeLabel ?? event.badge_key ?? "a season badge"}** at **XF** level.`,
          "",
          `**Badge:** ${event.badgeDescription ?? "Season-long badge achievement."}`,
          `**Qualified By:** ${qualified}${snapshot.bestStreak ? `, best streak ${snapshot.bestStreak}` : ""}.`,
        ].join("\n"))],
      allowedMentions: { parse: ["everyone", "users"] },
    }).catch(() => undefined);
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
    const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Box Score")).setColor(COLORS.error);
    embed.addFields({ name: "STATUS", value: `⛔ Denied by <@${interaction.user.id}>${reason ? ` — ${reason}` : ""}.` });
    return interaction.editReply({ embeds: [embed], components: [] });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Error").setColor(COLORS.error).setDescription(err instanceof Error ? err.message : String(err))],
      components: [],
    });
  }
}

// ─── Commissioner corrections (repair any logged field on a pending payout) ────

function team1ScoresFromRow(sub: any): { team1Score: number | null; team2Score: number | null } {
  const team1IsHome = !!(sub.team1_id && sub.home_team_id && sub.home_team_id === sub.team1_id);
  return {
    team1Score: (team1IsHome ? sub.home_score : sub.away_score) ?? null,
    team2Score: (team1IsHome ? sub.away_score : sub.home_score) ?? null,
  };
}

function buildCorrectionFieldRows(submissionId: string, isCfb: boolean) {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${BOX_SCORE_CUSTOM_IDS.correctFieldPrefix}${submissionId}`)
        .setPlaceholder("Pick a field to correct")
        .addOptions(correctionFieldsFor(isCfb).map((f) => new StringSelectMenuOptionBuilder().setLabel(f.label).setValue(f.value))),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.correctCancelPrefix}${submissionId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function correctionInputs(label1: string, value1: string, label2: string, value2: string, placeholder: string) {
  return [
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.correctInputTeam1).setLabel(label1.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setValue(value1).setPlaceholder(placeholder),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.correctInputTeam2).setLabel(label2.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(false).setValue(value2).setPlaceholder(placeholder),
    ),
  ];
}

function buildCorrectionModal(submissionId: string, field: string, session: CorrectionSession): ModalBuilder {
  const def = correctionFieldByValueFor(session.isCfb).get(field);
  const t1 = session.team1Abbr || "Top/Away";
  const t2 = session.team2Abbr || "Bottom/Home";
  const modal = new ModalBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.correctModalPrefix}${submissionId}:${field}`);

  if (field === "score") {
    modal.setTitle("Correct Final Score");
    modal.addComponents(...correctionInputs(`${t1} — final score`, String(session.team1Score ?? ""), `${t2} — final score`, String(session.team2Score ?? ""), "numbers only"));
  } else if (field === "quarters") {
    modal.setTitle("Correct Quarter Scores");
    const q1 = (session.quarterScores?.team1 ?? []).join(",");
    const q2 = (session.quarterScores?.team2 ?? []).join(",");
    modal.addComponents(...correctionInputs(`${t1} — quarters`, q1, `${t2} — quarters`, q2, "e.g. 7,0,7,7"));
  } else {
    const label = def?.label ?? field;
    const cur = session.stats[field] ?? { team1: "", team2: "" };
    modal.setTitle(`Correct ${label}`.slice(0, 45));
    modal.addComponents(...correctionInputs(`${t1} — ${label}`, cur.team1 ?? "", `${t2} — ${label}`, cur.team2 ?? "", "numbers only"));
  }
  return modal;
}

function buildCorrectionMatchupRows(submissionId: string, games: any[]) {
  const options = games.slice(0, 25).map((game: any) => {
    const away = teamLabel(game.away_team);
    const home = teamLabel(game.home_team);
    return new StringSelectMenuOptionBuilder().setLabel(`${away} at ${home}`.slice(0, 100)).setValue(String(game.id));
  });
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${BOX_SCORE_CUSTOM_IDS.correctMatchupPrefix}${submissionId}`)
        .setPlaceholder("Re-link to the correct scheduled game")
        .addOptions(options.length ? options : [new StringSelectMenuOptionBuilder().setLabel("No scheduled games found").setValue("none")]),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.correctCancelPrefix}${submissionId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// Click "Corrections": load the submission, stash a session for prefills, and swap
// the Approve/Deny/Corrections row for the field picker. Embed + image stay put.
export async function handleBoxScoreCorrectionsOpen(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct box scores.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.correctOpenPrefix.length);

  await interaction.deferUpdate();
  try {
    const [sub, isCfb] = await Promise.all([recApi.getBoxScore(submissionId), isCfbLeague(interaction.guildId)]);
    if (sub?.status && sub.status !== "pending") {
      return interaction.followUp({ content: "This box score is already approved or denied — corrections are only available while pending.", flags: MessageFlags.Ephemeral });
    }
    const { team1Score, team2Score } = team1ScoresFromRow(sub);
    correctionSessions.set(exKey(interaction.guildId, interaction.user.id), {
      submissionId,
      weekNumber: Number(sub.week_number ?? 1),
      seasonNumber: sub.season_number ?? null,
      team1Abbr: sub.team1_abbr ?? "",
      team2Abbr: sub.team2_abbr ?? "",
      stats: (sub.team_stats as Record<string, { team1: string; team2: string }>) ?? {},
      quarterScores: (sub.quarter_scores as { team1: number[]; team2: number[] } | null) ?? null,
      team1Score,
      team2Score,
      isCfb,
      at: Date.now(),
    });
    return interaction.editReply({ components: buildCorrectionFieldRows(submissionId, isCfb) });
  } catch (err) {
    return interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral });
  }
}

export async function handleBoxScoreCorrectionsFieldSelect(interaction: StringSelectMenuInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct box scores.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return;
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.correctFieldPrefix.length);
  const field = interaction.values[0] ?? "";
  let session = getCorrectionSession(interaction.guildId, interaction.user.id);
  const isCfb = session ? session.isCfb : await isCfbLeague(interaction.guildId);
  const def = correctionFieldByValueFor(isCfb).get(field);

  if (def?.kind === "matchup") {
    await interaction.deferUpdate();
    try {
      const weekNumber = session?.weekNumber ?? Number((await recApi.getBoxScore(submissionId))?.week_number ?? 1);
      const result = await recApi.listBoxScoreGames({ guildId: interaction.guildId, weekNumber });
      return interaction.editReply({ components: buildCorrectionMatchupRows(submissionId, result?.games ?? []) });
    } catch (err) {
      return interaction.editReply({ components: buildCorrectionFieldRows(submissionId, isCfb) }).then(() =>
        interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral }),
      );
    }
  }

  // Stat / score / quarters → modal. Re-hydrate the session if it expired so the
  // modal can still prefill (the modal is the first response, so no defer here).
  if (!session) {
    try {
      const sub = await recApi.getBoxScore(submissionId);
      const { team1Score, team2Score } = team1ScoresFromRow(sub);
      session = {
        submissionId,
        weekNumber: Number(sub.week_number ?? 1),
        seasonNumber: sub.season_number ?? null,
        team1Abbr: sub.team1_abbr ?? "",
        team2Abbr: sub.team2_abbr ?? "",
        stats: (sub.team_stats as Record<string, { team1: string; team2: string }>) ?? {},
        quarterScores: (sub.quarter_scores as { team1: number[]; team2: number[] } | null) ?? null,
        team1Score,
        team2Score,
        isCfb,
        at: Date.now(),
      };
    } catch {
      session = { submissionId, weekNumber: 1, seasonNumber: null, team1Abbr: "", team2Abbr: "", stats: {}, quarterScores: null, team1Score: null, team2Score: null, isCfb, at: Date.now() };
    }
  }
  return interaction.showModal(buildCorrectionModal(submissionId, field, session));
}

export async function handleBoxScoreCorrectionsMatchupSelect(interaction: StringSelectMenuInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct box scores.", flags: MessageFlags.Ephemeral });
  }
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.correctMatchupPrefix.length);
  const gameId = interaction.values[0] ?? "";

  await interaction.deferUpdate();
  if (!gameId || gameId === "none") {
    return interaction.editReply({ components: buildPayoutReviewRows(submissionId) });
  }
  try {
    const result = await recApi.correctBoxScore({ submissionId, reviewedByDiscordId: interaction.user.id, field: "matchup", gameId });
    if (interaction.inCachedGuild()) correctionSessions.delete(exKey(interaction.guildId, interaction.user.id));
    return interaction.editReply({ embeds: [buildPayoutReviewEmbed(result)], components: buildPayoutReviewRows(submissionId) });
  } catch (err) {
    await interaction.editReply({ components: buildPayoutReviewRows(submissionId) });
    return interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral });
  }
}

export async function handleBoxScoreCorrectionsModal(interaction: ModalSubmitInteraction) {
  const rest = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.correctModalPrefix.length);
  const sep = rest.indexOf(":");
  const submissionId = sep >= 0 ? rest.slice(0, sep) : rest;
  const field = sep >= 0 ? rest.slice(sep + 1) : "";
  const team1 = interaction.fields.getTextInputValue(BOX_SCORE_CUSTOM_IDS.correctInputTeam1);
  const team2 = interaction.fields.getTextInputValue(BOX_SCORE_CUSTOM_IDS.correctInputTeam2);

  await interaction.deferUpdate();
  try {
    const result = await recApi.correctBoxScore({ submissionId, reviewedByDiscordId: interaction.user.id, field, team1, team2 });
    if (interaction.inCachedGuild()) correctionSessions.delete(exKey(interaction.guildId, interaction.user.id));
    return interaction.editReply({ embeds: [buildPayoutReviewEmbed(result)], components: buildPayoutReviewRows(submissionId) });
  } catch (err) {
    await interaction.editReply({ components: buildPayoutReviewRows(submissionId) }).catch(() => undefined);
    return interaction.followUp({ content: userFacingError(err), flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export async function handleBoxScoreCorrectionsCancel(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can correct box scores.", flags: MessageFlags.Ephemeral });
  }
  const submissionId = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.correctCancelPrefix.length);
  if (interaction.inCachedGuild()) correctionSessions.delete(exKey(interaction.guildId, interaction.user.id));
  await interaction.deferUpdate();
  return interaction.editReply({ components: buildPayoutReviewRows(submissionId) });
}

// ─── Commissioner review (on the Pending Payouts embed) ────────────────────────

export async function handleBoxScoreSubmissions(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can submit prior box scores.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });

  const week = await recApi.viewLeagueWeek(interaction.guildId).catch(() => null);
  const game = week?.league?.game ?? null;
  const currentWeek = Math.max(isCfb(game) ? 0 : 1, Number(week?.league?.current_week ?? 1));
  const seasonNumber = Number(week?.league?.season_number ?? week?.league?.display_season_number ?? 1);

  commissionerSubmissionSessions.delete(exKey(interaction.guildId, interaction.user.id));
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Box Score Submissions")
      .setDescription("Select the game week first, then choose the scheduled game. After that, upload one box score image in this channel. The bot deletes the image after parsing and sends the review to Commissioner Notifications.")],
    components: buildAdminWeekRows(currentWeek, seasonNumber, game),
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
        embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setColor(COLORS.warning).setDescription(`No scheduled games are logged for Week ${weekNumber}. Upload the schedule first, then try again.`)],
        components: [buildAdminCancelRow()],
      });
    }
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setDescription(`Select the scheduled game for Week ${weekNumber}.`)],
      components: buildAdminGameRows(games, weekNumber, result?.league?.seasonNumber ?? null),
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setColor(COLORS.error).setDescription(err instanceof Error ? err.message : String(err))],
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
    components: [buildAdminAnotherRow(weekNumber, seasonNumber)],
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
    .setColor(COLORS.info)
    .addFields(
      { name: "GAME", value: `**${result.team1Abbr ?? "?"}** ${result.team1Score ?? "?"} – ${result.team2Score ?? "?"} **${result.team2Abbr ?? "?"}** — Week ${result.weekNumber ?? "?"}`, inline: false },
      { name: "QUARTER SCORES", value: qText.slice(0, 512), inline: false },
      { name: "TEAM STATS  (T1 / T2)", value: statLines(result?.stats, 16).slice(0, 1024), inline: false },
      { name: "DEFENSE  (T1 / T2)", value: defensiveSummary(result?.stats).slice(0, 1024), inline: false },
      { name: "SUBMITTED BY", value: `<@${result.submittedByDiscordId}>`, inline: true },
    );
  if (result?.flagged && (result.flagReasons ?? []).length) {
    embed.setColor(COLORS.warning);
    embed.addFields({ name: "⚠️ FLAGGED", value: (result.flagReasons as string[]).map((r) => `• ${r}`).join("\n").slice(0, 1024), inline: false });
  } else if (!result?.gameMatched) {
    embed.addFields({ name: "⚠️ NOTICE", value: "Could not auto-match to a scheduled game. You can still approve.", inline: false });
  }
  if (result?.imageUrl) embed.setImage(String(result.imageUrl));
  embed.setFooter({ text: `Submission ${result.submissionId} • Use Corrections to fix any “?” field` });
  return embed;
}

// ─── Component builders ───────────────────────────────────────────────────────

function buildPayoutReviewRows(submissionId: string) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.approvePrefix}${submissionId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.denyModalPrefix}${submissionId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${BOX_SCORE_CUSTOM_IDS.correctOpenPrefix}${submissionId}`).setLabel("Corrections").setStyle(ButtonStyle.Primary),
    ),
  ];
}

function buildInboxBackRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.inboxBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Secondary)
  );
}

function buildAdminWeekRows(currentWeek: number, seasonNumber: number, game: string | null = null) {
  // CFB's regular season starts at Week 0; Madden's starts at Week 1.
  const firstWeek = isCfb(game) ? 0 : 1;
  const highestWeek = Math.min(Math.max(currentWeek, firstWeek), firstWeek + 24);
  const maxOptions = highestWeek - firstWeek + 1;
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(BOX_SCORE_CUSTOM_IDS.adminWeekSelect)
        .setPlaceholder("Select week")
        .addOptions(Array.from({ length: maxOptions }, (_, idx) => {
          const week = firstWeek + idx;
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

function buildAdminAnotherRow(weekNumber: number, seasonNumber: number | null) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOX_SCORE_CUSTOM_IDS.adminAnotherPrefix}${weekNumber}:${seasonNumber ?? ""}`)
      .setLabel("Upload Another")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BOX_SCORE_CUSTOM_IDS.inboxBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Secondary),
  );
}

export async function handleBoxScoreAdminAnother(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) return;
  if (!interaction.inCachedGuild()) return;
  const payload = interaction.customId.slice(BOX_SCORE_CUSTOM_IDS.adminAnotherPrefix.length);
  const [weekStr, seasonStr] = payload.split(":");
  const weekNumber = Number(weekStr);
  const seasonNumber = seasonStr ? Number(seasonStr) : null;
  await interaction.deferUpdate();
  try {
    const result = await recApi.listBoxScoreGames({ guildId: interaction.guildId, weekNumber });
    const games = result?.games ?? [];
    if (!games.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setColor(COLORS.warning).setDescription(`No remaining scheduled games found for Week ${weekNumber}.`)],
        components: [buildAdminCancelRow()],
      });
    }
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setDescription(`Select the scheduled game for Week ${weekNumber}.`)],
      components: buildAdminGameRows(games, weekNumber, seasonNumber ?? result?.league?.seasonNumber ?? null),
    });
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Box Score Submissions").setColor(COLORS.error).setDescription(err instanceof Error ? err.message : String(err))],
      components: [buildAdminCancelRow()],
    });
  }
}
