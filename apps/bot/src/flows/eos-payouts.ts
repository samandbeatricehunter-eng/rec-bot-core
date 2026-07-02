import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";
import { isEosPayoutEligibleStage } from "@rec/shared";
import { isFullLeagueAdminInteraction, replyFullAdminOnly } from "../lib/admin.js";
import { COLORS } from "../lib/colors.js";
import { userFacingError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";
import { ExpiringSessionStore } from "../lib/session-timeout.js";
import { MENU_CUSTOM_IDS } from "../ui/menu.js";

export const EOS_PAYOUT_CUSTOM_IDS = {
  issueBatchPrefix: "rec:eos_payouts:issue:",
  approveUserPrefix: "rec:eos:ap:",
  denyUserPrefix: "rec:eos:dn:"
} as const;

export const TROUBLESHOOT_EOS_CUSTOM_IDS = {
  eosPrev: "rec:trouble:eos:prev",
  eosNext: "rec:trouble:eos:next",
} as const;

export const eosProjectionSessions = new ExpiringSessionStore<{ pages: any[]; page: number }>();

function formatMoney(n: unknown) {
  return `$${Number(n ?? 0).toLocaleString("en-US")}`;
}

function groupProjectionPages(items: any[]) {
  const byUser = new Map<string, any[]>();
  for (const item of items ?? []) {
    const key = item.payee_discord_id ?? item.user_id ?? "unknown";
    const rows = byUser.get(key) ?? [];
    rows.push(item);
    byUser.set(key, rows);
  }
  return [...byUser.entries()].map(([key, rows]) => ({
    key,
    discordId: rows.find((row) => row.payee_discord_id)?.payee_discord_id ?? null,
    userId: rows[0]?.user_id ?? null,
    total: rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    rows,
  })).sort((a, b) => b.total - a.total);
}

function renderEosProjectionSession(session: { pages: any[]; page: number }) {
  const page = session.pages[session.page] ?? null;
  const totalPages = Math.max(1, session.pages.length);
  const lines = page
    ? [
      `Coach: ${page.discordId ? `<@${page.discordId}>` : page.userId ?? "Unknown"}`,
      `Projected total: **${formatMoney(page.total)}**`,
      "",
      ...page.rows.slice(0, 18).map((item: any) => `- **${formatMoney(item.amount)}** - ${item.payout_label}${item.qualified_tier ? ` (${item.qualified_tier})` : ""}`),
    ]
    : ["No projected EOS payouts were generated from current stats."];
  return {
    embeds: [new EmbedBuilder()
      .setTitle("EOS Projections")
      .setDescription(lines.join("\n").slice(0, 4096))
      .setFooter({ text: `Page ${session.page + 1}/${totalPages}` })],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(TROUBLESHOOT_EOS_CUSTOM_IDS.eosPrev).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(!session.pages.length),
        new ButtonBuilder().setCustomId(TROUBLESHOOT_EOS_CUSTOM_IDS.eosNext).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(!session.pages.length),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtTroubleshoot).setLabel("Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function handleEosProjections(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "view EOS projections");
  await interaction.deferUpdate();
  let result: any;
  try {
    result = await recApi.projectEosPayouts({ guildId: interaction.guildId });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Projections").setColor(COLORS.error).setDescription(userFacingError(err))], components: [] });
  }
  const session = { pages: groupProjectionPages(result.items ?? []), page: 0 };
  eosProjectionSessions.set(interaction.user.id, session);
  return interaction.editReply(renderEosProjectionSession(session));
}

export async function handleEosProjectionPage(interaction: ButtonInteraction, delta: number) {
  const session = eosProjectionSessions.get(interaction.user.id);
  if (!session) return interaction.reply({ content: "EOS projection view expired. Reopen Troubleshoot > EOS Projections.", flags: MessageFlags.Ephemeral });
  const count = Math.max(1, session.pages.length);
  session.page = (session.page + delta + count) % count;
  return interaction.update(renderEosProjectionSession(session));
}

function eosPayoutLine(item: any) {
  const tier = item.qualified_tier ? ` [${item.qualified_tier}]` : "";
  const value = item.qualified_value != null ? ` (${item.qualified_value})` : "";
  return `- **$${Number(item.amount ?? 0)}** - ${item.payout_label}${tier}${value}`;
}

function eosUserGroups(items: any[]) {
  const groups = new Map<string, any[]>();
  for (const item of items) {
    if (item.status !== "pending" || !item.user_id) continue;
    const rows = groups.get(item.user_id) ?? [];
    rows.push(item);
    groups.set(item.user_id, rows);
  }
  return groups;
}

async function postEosReviewEmbeds(interaction: ButtonInteraction, result: any) {
  if (!interaction.guild || !result?.pendingPayoutsChannelId || !result?.batch?.id) return 0;
  const channel = await interaction.guild.channels.fetch(result.pendingPayoutsChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return 0;
  let posted = 0;
  for (const [userId, items] of eosUserGroups(result.items ?? [])) {
    const total = items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const payeeDiscordId = items.find((item) => item.payee_discord_id)?.payee_discord_id ?? null;
    const coach = payeeDiscordId ? `<@${payeeDiscordId}>` : `REC user ${userId}`;
    const lines = items.map(eosPayoutLine);
    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle("EOS PAYOUT REVIEW")
        .setColor(COLORS.warning)
        .setDescription([
          `Coach: ${coach}`,
          `Season: **${result.batch.season_number}**`,
          `Total pending: **$${total}**`,
          "",
          lines.join("\n").slice(0, 3000),
        ].join("\n"))],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${EOS_PAYOUT_CUSTOM_IDS.approveUserPrefix}${result.batch.id}:${userId}`).setLabel("Approve & Pay").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${EOS_PAYOUT_CUSTOM_IDS.denyUserPrefix}${result.batch.id}:${userId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
      )],
      allowedMentions: { users: payeeDiscordId ? [payeeDiscordId] : [] },
    }).catch(() => undefined);
    posted += 1;
  }
  return posted;
}

async function dmEosPayoutResult(interaction: ButtonInteraction, result: any) {
  if (!result?.payeeDiscordId || result.action !== "approve" || Number(result.totalAmount ?? 0) <= 0) return;
  const user = await interaction.client.users.fetch(result.payeeDiscordId).catch(() => null);
  if (!user) return;
  const lines = (result.items ?? []).map(eosPayoutLine);
  await user.send([
    `Your EOS payouts were approved for **$${Number(result.totalAmount ?? 0)}**.`,
    "",
    lines.join("\n").slice(0, 1800),
  ].join("\n")).catch(() => undefined);
}

export async function handleEosPayouts(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "run EOS payouts");
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  const week = interaction.guildId ? await recApi.viewLeagueWeek(interaction.guildId).catch(() => null) : null;
  const currentStage = String(week?.league?.season_stage ?? "regular_season");
  if (!isEosPayoutEligibleStage(currentStage, week?.league?.game ?? null)) {
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle("EOS Payouts").setDescription("EOS payouts cannot be issued until the active regular season concludes. They are available from the start of the postseason through the championship game.")], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let result: any;
  try {
    result = await recApi.prepareEosPayouts({ guildId: interaction.guildId, requestedByDiscordId: interaction.user.id });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Payouts Failed").setColor(COLORS.error).setDescription(userFacingError(err))] });
  }
  const items: any[] = result?.items ?? [];
  const pending = items.filter((item) => item.status === "pending").length;
  const issued = items.filter((item) => item.status === "issued").length;
  const total = Number(result?.totalAmount ?? 0);
  const byCategory = new Map<string, { count: number; amount: number }>();
  for (const item of items) {
    const key = String(item.payout_category ?? "other");
    const row = byCategory.get(key) ?? { count: 0, amount: 0 };
    row.count += 1;
    row.amount += Number(item.amount ?? 0);
    byCategory.set(key, row);
  }
  const categoryLines = [...byCategory.entries()].map(([key, row]) => `${key}: **${row.count}** item${row.count === 1 ? "" : "s"} / **$${row.amount}**`);
  const batchId = result?.batch?.id ? String(result.batch.id) : null;
  const reviewEmbedsPosted = pending > 0 ? await postEosReviewEmbeds(interaction, result) : 0;
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("EOS Payouts Prepared")
      .setColor(COLORS.success)
      .setDescription([
        `Season **${result?.batch?.season_number ?? week?.league?.season_number ?? 1}** EOS payout batch is ready.`,
        "",
        `Pending review items: **${pending}**`,
        `Issued items: **${issued}**`,
        `Total generated amount: **$${total}**`,
        `Review embeds posted: **${reviewEmbedsPosted}**`,
        "",
        categoryLines.length ? categoryLines.join("\n") : "No qualifying EOS payouts were generated.",
        "",
        "This engine uses final regular-season power rankings and approved box-score team stats. Player-level stat imports are not required."
      ].join("\n"))],
    components: batchId && pending > 0
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${EOS_PAYOUT_CUSTOM_IDS.issueBatchPrefix}${batchId}`).setLabel("Issue Pending EOS Payouts").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosActions).setLabel("Back").setStyle(ButtonStyle.Secondary),
        )]
      : [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosActions).setLabel("Back").setStyle(ButtonStyle.Secondary),
        )],
  });
}

export async function handleReviewEosUserPayouts(interaction: ButtonInteraction, action: "approve" | "deny") {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, `${action} EOS payouts`);
  const prefix = action === "approve" ? EOS_PAYOUT_CUSTOM_IDS.approveUserPrefix : EOS_PAYOUT_CUSTOM_IDS.denyUserPrefix;
  const [batchId, userId] = interaction.customId.slice(prefix.length).split(":");
  if (!batchId || !userId) return interaction.reply({ content: "EOS payout review payload was missing.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let result: any;
  try {
    result = await recApi.reviewEosPayoutsForUser({
      batchId,
      userId,
      action,
      reviewedByDiscordId: interaction.user.id,
      deniedReason: action === "deny" ? "Denied by commissioner review." : null,
    });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`EOS Payouts ${action === "approve" ? "Approval" : "Denial"} Failed`).setColor(COLORS.error).setDescription(userFacingError(err))] });
  }
  await dmEosPayoutResult(interaction, result);
  if (interaction.message?.editable) {
    const embeds = interaction.message.embeds.map((embed: any) => {
      const builder = EmbedBuilder.from(embed);
      const current = embed.description ?? "";
      builder.setDescription([current, "", `**${action === "approve" ? "Approved and paid" : "Denied"} by <@${interaction.user.id}>**`].join("\n"));
      builder.setColor(action === "approve" ? 0x2ecc71 : 0xe74c3c);
      return builder;
    });
    await interaction.message.edit({ embeds, components: [] }).catch(() => undefined);
  }
  const failed: any[] = result?.failed ?? [];
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(action === "approve" ? "EOS Payouts Approved" : "EOS Payouts Denied")
      .setColor(action === "approve" ? 0x2ecc71 : 0xe74c3c)
      .setDescription([
        `Processed **${result?.items?.length ?? 0}** payout item${(result?.items?.length ?? 0) === 1 ? "" : "s"}.`,
        `Total: **$${Number(result?.totalAmount ?? 0)}**`,
        failed.length ? `Failed: **${failed.length}** item${failed.length === 1 ? "" : "s"}.` : "No failures reported.",
      ].join("\n"))],
  });
}

export async function handleIssueEosPayoutBatch(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "issue EOS payouts");
  const batchId = interaction.customId.slice(EOS_PAYOUT_CUSTOM_IDS.issueBatchPrefix.length);
  if (!batchId) return interaction.reply({ content: "EOS payout batch was missing.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  let result: any;
  try {
    result = await recApi.issueEosPayoutBatch({ batchId, reviewedByDiscordId: interaction.user.id });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Payout Issue Failed").setColor(COLORS.error).setDescription(userFacingError(err))], components: [] });
  }
  const failed: any[] = result?.failed ?? [];
  const issuedCount = Number(result?.issuedCount ?? 0);
  const remainingPending = (result?.items ?? []).filter((item: any) => item.status === "pending").length;
  const issuedByDiscord = new Map<string, any[]>();
  for (const item of result?.issuedItems ?? []) {
    if (!item.payee_discord_id) continue;
    const rows = issuedByDiscord.get(item.payee_discord_id) ?? [];
    rows.push(item);
    issuedByDiscord.set(item.payee_discord_id, rows);
  }
  for (const [discordId, rows] of issuedByDiscord.entries()) {
    const user = await interaction.client.users.fetch(discordId).catch(() => null);
    const totalForUser = rows.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    await user?.send([
      `Your EOS payouts were issued for **$${totalForUser}**.`,
      "",
      rows.map(eosPayoutLine).join("\n").slice(0, 1800),
    ].join("\n")).catch(() => undefined);
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle(failed.length ? "EOS Payouts Partially Issued" : "EOS Payouts Issued")
      .setColor(failed.length ? 0xf1c40f : 0x2ecc71)
      .setDescription([
        `Issued **${issuedCount}** pending EOS payout${issuedCount === 1 ? "" : "s"}.`,
        `Remaining pending: **${remainingPending}**`,
        failed.length ? `Failed: **${failed.length}** item${failed.length === 1 ? "" : "s"}. Check API logs for details.` : "No failures reported."
      ].join("\n"))],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtEosActions).setLabel("Back").setStyle(ButtonStyle.Secondary),
    )],
  });
}
