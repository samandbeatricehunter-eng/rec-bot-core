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
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { americanFromDecimal } from "@rec/shared";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";

export const WAGER_CUSTOM_IDS = {
  gameSelect: "rec:wager:game",
  marketSelect: "rec:wager:market",
  sideSelect: "rec:wager:side",
  stakeModal: "rec:wager:stake_modal",
  stakeInput: "rec:wager:stake_input",
  approvePrefix: "rec:wager:approve:", // + wagerId (pending-payout review)
  cancelPrefix: "rec:wager:void:",     // + wagerId (pending-payout review)
} as const;

type WagerSession = {
  options: any | null;          // getWagerOptions payload for the selected game
  gameId: string | null;
  gameLabel: string | null;
  market: string | null;
  marketLabel: string | null;
  pick: string | null;
  sideLabel: string | null;
  odds: number | null;
  line: number | null;
  at: number;
};

const sessions = new Map<string, WagerSession>();
const SESSION_TTL = 10 * 60 * 1000;

function getSession(userId: string): WagerSession {
  const s = sessions.get(userId);
  if (s && Date.now() - s.at < SESSION_TTL) return s;
  const fresh: WagerSession = { options: null, gameId: null, gameLabel: null, market: null, marketLabel: null, pick: null, sideLabel: null, odds: null, line: null, at: Date.now() };
  sessions.set(userId, fresh);
  return fresh;
}

function userError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.match(/^REC API request failed:\s*\d+\s+(\{.*\})$/s);
  if (m?.[1]) {
    try {
      const parsed = JSON.parse(m[1]) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    } catch { /* fall through */ }
  }
  return message;
}

// ─── Placement flow (in the player's /menu session) ────────────────────────────

export async function handlePlaceWager(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();

  let payload: any;
  try {
    payload = await recApi.listWagerGames(interaction.guildId, interaction.user.id);
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Place a Wager").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
  const games: any[] = payload?.games ?? [];
  if (!games.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Place a Wager").setColor(0xf1c40f).setDescription("There are no games you can bet on this week (your own game is excluded, and a schedule must be logged).")],
      components: [],
    });
  }

  sessions.delete(interaction.user.id);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(WAGER_CUSTOM_IDS.gameSelect)
    .setPlaceholder("Pick a game to bet on")
    .addOptions(games.slice(0, 25).map((g) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${g.awayLabel} at ${g.homeLabel}`.slice(0, 100))
        .setValue(g.gameId)
        .setDescription(g.humanInvolved ? "Human game — full markets" : "CPU game — score markets only")));

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Place a Wager")
      .setColor(0x3498db)
      .setDescription([
        `**Week ${payload.weekNumber}** — bet the house on a game below.`,
        "",
        "House lines are auto-set from power rankings and season stats. **Moneyline ties lose** regardless of pick. You can't bet your own game, can only bet **one CPU game** per week, and can't place the same game+market twice.",
      ].join("\n"))],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

export async function handleWagerGameSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const gameId = interaction.values[0];
  const session = getSession(interaction.user.id);

  let options: any;
  try {
    options = await recApi.getWagerOptions(interaction.guildId, gameId);
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Place a Wager").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
  session.options = options;
  session.gameId = gameId;
  session.gameLabel = `${options.awayLabel} at ${options.homeLabel}`;
  session.market = session.marketLabel = session.pick = session.sideLabel = null;
  session.at = Date.now();

  const marketMenu = new StringSelectMenuBuilder()
    .setCustomId(WAGER_CUSTOM_IDS.marketSelect)
    .setPlaceholder("Pick a market")
    .addOptions((options.markets ?? []).slice(0, 25).map((m: any) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(m.label.slice(0, 100))
        .setValue(m.market)
        .setDescription(m.line != null ? `Line: ${m.line}${m.unit ? ` ${m.unit}` : ""}` : "Winner")));

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(`Wager — ${session.gameLabel}`).setColor(0x3498db).setDescription("Choose a market.")],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(marketMenu)],
  });
}

export async function handleWagerMarketSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  const market = interaction.values[0];
  const marketOption = (session.options?.markets ?? []).find((m: any) => m.market === market);
  if (!session.options || !marketOption) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager").setColor(0xe74c3c).setDescription("That market is no longer available — restart from Place Wager.")], components: [] });
  }
  session.market = market;
  session.marketLabel = marketOption.label;
  session.at = Date.now();

  const sideMenu = new StringSelectMenuBuilder()
    .setCustomId(WAGER_CUSTOM_IDS.sideSelect)
    .setPlaceholder("Pick your side")
    .addOptions(marketOption.sides.slice(0, 25).map((s: any, idx: number) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${s.label}  (${americanFromDecimal(s.odds)})`.slice(0, 100))
        .setValue(String(idx))
        .setDescription(`Decimal odds ${Number(s.odds).toFixed(2)}`)));

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(`Wager — ${session.marketLabel}`).setColor(0x3498db).setDescription(`${session.gameLabel}\n\nChoose your side, then enter a stake.`)],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sideMenu)],
  });
}

export async function handleWagerSideSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.user.id);
  const marketOption = (session.options?.markets ?? []).find((m: any) => m.market === session.market);
  const side = marketOption?.sides?.[Number(interaction.values[0])];
  if (!side) {
    await interaction.deferUpdate();
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager").setColor(0xe74c3c).setDescription("That side is no longer available — restart from Place Wager.")], components: [] });
  }
  session.pick = side.pick;
  session.sideLabel = side.label;
  session.odds = side.odds;
  session.line = marketOption.line ?? null;
  session.at = Date.now();

  const modal = new ModalBuilder()
    .setCustomId(WAGER_CUSTOM_IDS.stakeModal)
    .setTitle("Enter Stake")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(WAGER_CUSTOM_IDS.stakeInput).setLabel(`Stake on ${side.label}`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("whole dollars, e.g. 100")));
  return interaction.showModal(modal);
}

export async function handleWagerStakeModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  if (!session.gameId || !session.market || !session.pick) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager").setColor(0xe74c3c).setDescription("Your wager session expired — restart from Place Wager.")], components: [] });
  }
  const stake = parseInt(interaction.fields.getTextInputValue(WAGER_CUSTOM_IDS.stakeInput).replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(stake) || stake <= 0) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager").setColor(0xe74c3c).setDescription("Enter a positive whole-dollar stake.")], components: [] });
  }

  let result: any;
  try {
    result = await recApi.placeHouseWager({ guildId: interaction.guildId, discordId: interaction.user.id, gameId: session.gameId, market: session.market, pick: session.pick, stake });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager Not Placed").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
  sessions.delete(interaction.user.id);

  // Post the pending-payout embed to the pending-payouts channel.
  let posted = false;
  const channelId: string | null = result.pendingPayoutsChannelId ?? null;
  if (channelId) {
    const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased() && !ch.isDMBased()) {
      const msg = await (ch as TextChannel).send({ embeds: [buildWagerPendingEmbed(result, false)], components: buildWagerReviewRows(result.wager.id) }).catch(() => null);
      if (msg) {
        posted = true;
        await recApi.attachWagerPendingMessage({ wagerId: result.wager.id, channelId: ch.id, messageId: msg.id }).catch(() => undefined);
      }
    }
  }

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Wager Placed ✅")
      .setColor(0x2ecc71)
      .setDescription([
        `**${result.gameLabel}**`,
        `${result.marketLabel}: **${result.sideLabel}** (${americanFromDecimal(result.odds)})`,
        `Stake: **$${result.wager.stake}** → To win: **$${result.payout}**`,
        "",
        `$${result.wager.stake} was moved to holding. Wallet balance: **$${result.walletBalance}**.`,
        posted ? "Sent to Pending Payouts for settlement once results are confirmed." : "No Pending Payouts channel is configured, so settlement must be handled manually.",
      ].join("\n"))],
    components: [],
  });
}

// ─── Pending-payout embed + commissioner review ────────────────────────────────

export function buildWagerPendingEmbed(result: any, confirmed: boolean): EmbedBuilder {
  const w = result.wager ?? result;
  const embed = new EmbedBuilder()
    .setTitle("Wager — Pending Payout")
    .setColor(confirmed ? 0x2ecc71 : 0x3498db)
    .addFields(
      { name: "BETTOR", value: w.placed_by_discord_id ? `<@${w.placed_by_discord_id}>` : "Coach", inline: true },
      { name: "GAME", value: result.gameLabel ?? "—", inline: true },
      { name: "PICK", value: `${result.marketLabel ?? w.market} — **${result.sideLabel ?? w.pick}** (${americanFromDecimal(Number(w.odds))})`, inline: false },
      { name: "STAKE / TO WIN", value: `$${w.stake} → $${w.potential_payout}`, inline: true },
    );
  embed.addFields({
    name: "STATUS",
    value: confirmed
      ? "✅ Results logged and confirmed — payout can be approved."
      : "⏳ Awaiting game result. **Approve** works only after the box score or weekly scores are logged. **Cancel** refunds the held stake.",
  });
  embed.setFooter({ text: `Wager ${w.id}` });
  return embed;
}

export function buildWagerReviewRows(wagerId: string) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${WAGER_CUSTOM_IDS.approvePrefix}${wagerId}`).setLabel("Approve Payout").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${WAGER_CUSTOM_IDS.cancelPrefix}${wagerId}`).setLabel("Cancel & Refund").setStyle(ButtonStyle.Danger),
  )];
}

export async function handleWagerApprove(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can approve wager payouts.", flags: MessageFlags.Ephemeral });
  }
  const wagerId = interaction.customId.slice(WAGER_CUSTOM_IDS.approvePrefix.length);
  await interaction.deferUpdate();
  let result: any;
  try {
    result = await recApi.settleWager(wagerId, interaction.user.id);
  } catch (err) {
    return interaction.followUp({ content: userError(err), flags: MessageFlags.Ephemeral });
  }

  if (result?.notConfirmed) {
    return interaction.followUp({ content: "The game result hasn't been logged yet. Upload the box score or weekly scores first, then approve.", flags: MessageFlags.Ephemeral });
  }
  if (result?.alreadyResolved) {
    return interaction.followUp({ content: `This wager is already ${result.status}.`, flags: MessageFlags.Ephemeral });
  }

  const outcome = String(result?.outcome ?? "settled");
  const base = interaction.message.embeds[0];
  const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Wager")).setColor(outcome === "won" ? 0x2ecc71 : outcome === "push" ? 0x95a5a6 : 0xe74c3c);
  const line = outcome === "won"
    ? `✅ Won — $${result.credited} paid to the bettor.`
    : outcome === "push"
      ? `↩️ Push — $${result.credited} stake refunded.`
      : "❌ Lost — stake retained by the house.";
  embed.spliceFields(embed.data.fields ? embed.data.fields.length - 1 : 0, 1, { name: "RESULT", value: line });
  return interaction.editReply({ embeds: [embed], components: [] });
}

export async function handleWagerCancel(interaction: ButtonInteraction) {
  if (!isDiscordAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners can cancel wagers.", flags: MessageFlags.Ephemeral });
  }
  const wagerId = interaction.customId.slice(WAGER_CUSTOM_IDS.cancelPrefix.length);
  await interaction.deferUpdate();
  try {
    await recApi.cancelWager(wagerId);
  } catch (err) {
    return interaction.followUp({ content: userError(err), flags: MessageFlags.Ephemeral });
  }
  await interaction.message.delete().catch(() => undefined);
}
