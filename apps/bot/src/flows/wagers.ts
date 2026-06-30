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
import { getAnnouncementsChannel } from "../lib/route-channels.js";

export const WAGER_CUSTOM_IDS = {
  modeHouse: "rec:wager:mode_house",
  modeDirect: "rec:wager:mode_direct",
  modeOpen: "rec:wager:mode_open",
  modeParlay: "rec:wager:mode_parlay",
  coachAfcSelect: "rec:wager:coach_afc",
  coachNfcSelect: "rec:wager:coach_nfc",
  gameSelect: "rec:wager:game",
  marketSelect: "rec:wager:market",
  sideSelect: "rec:wager:side",
  stakeModal: "rec:wager:stake_modal",
  stakeInput: "rec:wager:stake_input",
  approvePrefix: "rec:wager:approve:", // + wagerId (pending-payout review)
  cancelPrefix: "rec:wager:void:",     // + wagerId (pending-payout review)
  takePrefix: "rec:wager:take:",       // + wagerId (open challenge accept)
  acceptPrefix: "rec:wager:accept:",   // + wagerId (direct challenge accept)
  declinePrefix: "rec:wager:decline:", // + wagerId (direct challenge decline)
} as const;

type WagerMode = "house" | "peer_open" | "peer_direct" | "parlay";

type WagerSession = {
  mode: WagerMode;
  targetUserId: string | null;
  targetDiscordId: string | null;
  parlayLegs: Array<{ gameId: string; market: string; pick: string; label: string }>;
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
  const fresh: WagerSession = { mode: "house", targetUserId: null, targetDiscordId: null, parlayLegs: [], options: null, gameId: null, gameLabel: null, market: null, marketLabel: null, pick: null, sideLabel: null, odds: null, line: null, at: Date.now() };
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
  sessions.delete(interaction.user.id);

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Place a Wager")
      .setColor(0x3498db)
      .setDescription([
        "Pick how you want to bet:",
        "",
        "**Bet the House** — auto-set lines on this week's games.",
        "**Challenge a Coach** — send a head-to-head wager to a specific coach.",
        "**Open Challenge** — post a wager to the league; any coach can take the other side.",
        "",
        "You can't bet your own game. **Moneyline ties lose** house bets (peer ties refund). You can only bet **one CPU game** per week and can't place the same game+market twice.",
      ].join("\n"))],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(WAGER_CUSTOM_IDS.modeHouse).setLabel("Bet the House").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(WAGER_CUSTOM_IDS.modeDirect).setLabel("Challenge a Coach").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(WAGER_CUSTOM_IDS.modeOpen).setLabel("Open Challenge").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(WAGER_CUSTOM_IDS.modeParlay).setLabel("3-Pick Parlay").setStyle(ButtonStyle.Secondary),
    )],
  });
}

export async function handleWagerModeParlay(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  session.mode = "parlay";
  session.parlayLegs = [];
  session.at = Date.now();
  try {
    const payload = await buildGameSelectPayload(interaction.guildId, interaction.user.id, "**3-Pick Parlay (Leg 1 of 3)** — pick the first game. All 3 legs must hit; payouts are boosted.");
    return interaction.editReply({ embeds: payload.embeds, components: payload.components });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Parlay").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
}

async function buildGameSelectPayload(guildId: string, discordId: string, headline: string) {
  const payload = await recApi.listWagerGames(guildId, discordId);
  const games: any[] = payload?.games ?? [];
  if (!games.length) {
    return { empty: true, embeds: [new EmbedBuilder().setTitle("Place a Wager").setColor(0xf1c40f).setDescription("There are no games you can bet on this week (your own game is excluded, and a schedule must be logged).")], components: [] };
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(WAGER_CUSTOM_IDS.gameSelect)
    .setPlaceholder("Pick a game")
    .addOptions(games.slice(0, 25).map((g) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${g.awayLabel} at ${g.homeLabel}`.slice(0, 100))
        .setValue(g.gameId)
        .setDescription(g.humanInvolved ? "Human game — full markets" : "CPU game — score markets only")));
  return { empty: false, embeds: [new EmbedBuilder().setTitle("Place a Wager").setColor(0x3498db).setDescription(headline)], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

export async function handleWagerModeHouse(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  session.mode = "house";
  session.at = Date.now();
  try {
    const payload = await buildGameSelectPayload(interaction.guildId, interaction.user.id, "**Bet the House** — pick a game.");
    return interaction.editReply({ embeds: payload.embeds, components: payload.components });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Place a Wager").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
}

export async function handleWagerModeOpen(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  session.mode = "peer_open";
  session.at = Date.now();
  try {
    const payload = await buildGameSelectPayload(interaction.guildId, interaction.user.id, "**Open Challenge** — pick the game your wager is on. Any coach can take the other side.");
    return interaction.editReply({ embeds: payload.embeds, components: payload.components });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Place a Wager").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
}

export async function handleWagerModeDirect(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  session.mode = "peer_direct";
  session.at = Date.now();

  let payload: any;
  try {
    payload = await recApi.listChallengeableCoaches(interaction.guildId, interaction.user.id);
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Challenge a Coach").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
  const coaches: any[] = payload?.coaches ?? [];
  if (!coaches.length) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Challenge a Coach").setColor(0xf1c40f).setDescription("There are no other active linked coaches to challenge.")], components: [] });
  }
  const buildConf = (conf: "AFC" | "NFC", customId: string) => {
    const list = coaches.filter((c) => c.conference === conf).slice(0, 25);
    const menu = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(`${conf} coaches`).setDisabled(list.length === 0);
    menu.addOptions(list.length
      ? list.map((c) => new StringSelectMenuOptionBuilder().setLabel(`${c.teamAbbr}`.slice(0, 100)).setValue(`${c.userId}:${c.discordId ?? ""}`).setDescription("Challenge this coach"))
      : [new StringSelectMenuOptionBuilder().setLabel(`No ${conf} coaches`).setValue("none")]);
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  };
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Challenge a Coach").setColor(0x3498db).setDescription("Pick the coach you want to challenge.")],
    components: [buildConf("AFC", WAGER_CUSTOM_IDS.coachAfcSelect), buildConf("NFC", WAGER_CUSTOM_IDS.coachNfcSelect)],
  });
}

export async function handleWagerCoachSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  const [userId, discordId] = (interaction.values[0] ?? "").split(":");
  if (!userId || userId === "none") {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Challenge a Coach").setColor(0xe74c3c).setDescription("Pick a valid coach.")], components: [] });
  }
  session.mode = "peer_direct";
  session.targetUserId = userId;
  session.targetDiscordId = discordId || null;
  session.at = Date.now();
  try {
    const payload = await buildGameSelectPayload(interaction.guildId, interaction.user.id, `**Direct Challenge** — pick the game to wager on${discordId ? ` against <@${discordId}>` : ""}.`);
    return interaction.editReply({ embeds: payload.embeds, components: payload.components });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Challenge a Coach").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
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

  // Parlay: capture this leg and advance to the next leg (or the stake once 3 are in).
  if (session.mode === "parlay") {
    session.parlayLegs.push({ gameId: session.gameId!, market: session.market!, pick: side.pick, label: `${session.gameLabel} — ${session.marketLabel}: ${side.label} (${americanFromDecimal(side.odds)})` });
    if (session.parlayLegs.length < 3) {
      await interaction.deferUpdate();
      const payload = await buildGameSelectPayload(interaction.guildId!, interaction.user.id, `**Parlay (Leg ${session.parlayLegs.length + 1} of 3)** — picks so far:\n${session.parlayLegs.map((l, i) => `${i + 1}. ${l.label}`).join("\n")}`);
      return interaction.editReply({ embeds: payload.embeds, components: payload.components });
    }
    const parlayModal = new ModalBuilder()
      .setCustomId(WAGER_CUSTOM_IDS.stakeModal)
      .setTitle("Parlay Stake")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(WAGER_CUSTOM_IDS.stakeInput).setLabel("Parlay stake (all 3 legs)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("whole dollars, e.g. 100")));
    return interaction.showModal(parlayModal);
  }

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
  const stake = parseInt(interaction.fields.getTextInputValue(WAGER_CUSTOM_IDS.stakeInput).replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(stake) || stake <= 0) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager").setColor(0xe74c3c).setDescription("Enter a positive whole-dollar stake.")], components: [] });
  }

  if (session.mode === "parlay") {
    if (session.parlayLegs.length !== 3) {
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Parlay").setColor(0xe74c3c).setDescription("Your parlay session expired — restart from Place Wager.")], components: [] });
    }
    return placeParlayAndPost(interaction, session, stake);
  }

  if (!session.gameId || !session.market || !session.pick) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager").setColor(0xe74c3c).setDescription("Your wager session expired — restart from Place Wager.")], components: [] });
  }

  if (session.mode === "house") return placeHouseAndPost(interaction, session, stake);
  return proposePeerAndPost(interaction, session, stake);
}

async function placeHouseAndPost(interaction: ModalSubmitInteraction, session: WagerSession, stake: number) {
  if (!interaction.inCachedGuild()) return;
  let result: any;
  try {
    result = await recApi.placeHouseWager({ guildId: interaction.guildId, discordId: interaction.user.id, gameId: session.gameId!, market: session.market!, pick: session.pick!, stake });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager Not Placed").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
  sessions.delete(interaction.user.id);

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

async function placeParlayAndPost(interaction: ModalSubmitInteraction, session: WagerSession, stake: number) {
  if (!interaction.inCachedGuild()) return;
  let result: any;
  try {
    result = await recApi.placeParlay({ guildId: interaction.guildId, discordId: interaction.user.id, stake, legs: session.parlayLegs.map((l) => ({ gameId: l.gameId, market: l.market, pick: l.pick })) });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Parlay Not Placed").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
  const legs: string[] = result.legs ?? [];
  sessions.delete(interaction.user.id);

  let posted = false;
  const channelId: string | null = result.pendingPayoutsChannelId ?? null;
  if (channelId) {
    const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased() && !ch.isDMBased()) {
      const embed = new EmbedBuilder()
        .setTitle("Parlay — Pending Payout")
        .setColor(0x3498db)
        .addFields(
          { name: "BETTOR", value: `<@${interaction.user.id}>`, inline: true },
          { name: "LEGS (all must hit)", value: legs.map((l, i) => `${i + 1}. ${l}`).join("\n").slice(0, 1024), inline: false },
          { name: "STAKE / TO WIN", value: `$${stake} → $${result.payout} (${americanFromDecimal(result.combinedOdds)})`, inline: true },
          { name: "STATUS", value: "⏳ Awaiting all 3 results. **Approve** works once every leg's game is logged. **Cancel** refunds the held stake." },
        )
        .setFooter({ text: `Wager ${result.wager.id}` });
      const msg = await (ch as TextChannel).send({ embeds: [embed], components: buildWagerReviewRows(result.wager.id) }).catch(() => null);
      if (msg) {
        posted = true;
        await recApi.attachWagerPendingMessage({ wagerId: result.wager.id, channelId: ch.id, messageId: msg.id }).catch(() => undefined);
      }
    }
  }

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Parlay Placed ✅")
      .setColor(0x2ecc71)
      .setDescription([
        legs.map((l, i) => `${i + 1}. ${l}`).join("\n"),
        "",
        `Stake: **$${stake}** → To win: **$${result.payout}** (${americanFromDecimal(result.combinedOdds)}, boosted).`,
        `$${stake} moved to holding. Wallet: **$${result.walletBalance}**.`,
        posted ? "Sent to Pending Payouts; settles once all 3 results are confirmed." : "No Pending Payouts channel is configured.",
      ].join("\n").slice(0, 4096))],
    components: [],
  });
}

async function proposePeerAndPost(interaction: ModalSubmitInteraction, session: WagerSession, stake: number) {
  if (!interaction.inCachedGuild()) return;
  const challengeType = session.mode === "peer_direct" ? "direct" : "open";
  let result: any;
  try {
    result = await recApi.placePeerWager({
      guildId: interaction.guildId, discordId: interaction.user.id, gameId: session.gameId!, market: session.market!, pick: session.pick!, stake,
      challengeType, targetUserId: session.targetUserId,
    });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Wager Not Sent").setColor(0xe74c3c).setDescription(userError(err))], components: [] });
  }
  const targetDiscordId = session.targetDiscordId;
  sessions.delete(interaction.user.id);

  // Post the challenge to the announcements channel.
  let posted = false;
  const channel = await getAnnouncementsChannel(interaction.guild, (await recApi.getEconomyConfig(interaction.guildId).catch(() => null))?.routes ?? {}).catch(() => null);
  if (channel && "send" in channel && channel.isTextBased()) {
    const isDirect = challengeType === "direct";
    const content = isDirect && targetDiscordId ? `<@${targetDiscordId}>` : "@everyone";
    const rows = isDirect
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${WAGER_CUSTOM_IDS.acceptPrefix}${result.wager.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${WAGER_CUSTOM_IDS.declinePrefix}${result.wager.id}`).setLabel("Decline").setStyle(ButtonStyle.Danger))]
      : [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${WAGER_CUSTOM_IDS.takePrefix}${result.wager.id}`).setLabel("Take Wager").setStyle(ButtonStyle.Success))];
    const msg = await (channel as TextChannel).send({
      content,
      embeds: [buildPeerChallengeEmbed(result, interaction.user.id, targetDiscordId, isDirect)],
      components: rows,
      allowedMentions: isDirect && targetDiscordId ? { users: [targetDiscordId] } : { parse: ["everyone"] },
    }).catch(() => null);
    if (msg) {
      posted = true;
      await recApi.attachWagerAnnouncementMessage({ wagerId: result.wager.id, channelId: channel.id, messageId: msg.id }).catch(() => undefined);
    }
  }

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Challenge Sent ✅")
      .setColor(0x2ecc71)
      .setDescription([
        `**${result.gameLabel}**`,
        `Your pick — ${result.marketLabel}: **${result.proposerPickLabel}**`,
        `Stake: **$${result.stake}** → Pot pays **$${result.payout}** to the winner.`,
        "",
        `$${result.stake} was moved to holding. Wallet balance: **$${result.walletBalance}**.`,
        posted ? (challengeType === "direct" ? "Sent to the coach to accept or decline." : "Posted as an open challenge for any coach to take.") : "No announcements channel is configured, so the challenge couldn't be posted.",
      ].join("\n"))],
    components: [],
  });
}

function buildPeerChallengeEmbed(result: any, proposerDiscordId: string, targetDiscordId: string | null, isDirect: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(isDirect ? "Head-to-Head Challenge" : "Open Wager Challenge")
    .setColor(0x9b59b6)
    .addFields(
      { name: "FROM", value: `<@${proposerDiscordId}>`, inline: true },
      ...(isDirect && targetDiscordId ? [{ name: "TO", value: `<@${targetDiscordId}>`, inline: true }] : []),
      { name: "GAME", value: result.gameLabel ?? "—", inline: false },
      { name: "PROPOSER TAKES", value: `${result.marketLabel}: **${result.proposerPickLabel}**`, inline: false },
      { name: "YOU'D TAKE", value: `The other side of ${result.marketLabel}.`, inline: false },
      { name: "STAKE / POT", value: `$${result.stake} each → winner takes **$${result.payout}**`, inline: false },
    )
    .setFooter({ text: isDirect ? "Accept to lock it in." : "Click Take Wager to take the other side." });
}

async function acceptPeerAndPost(interaction: ButtonInteraction, wagerId: string) {
  if (!interaction.inCachedGuild()) return;
  let result: any;
  try {
    result = await recApi.acceptPeerWager(interaction.guildId, interaction.user.id, wagerId);
  } catch (err) {
    return interaction.followUp({ content: userError(err), flags: MessageFlags.Ephemeral });
  }
  const w = result.wager;

  // Update the announcement embed: remove buttons, show it's locked.
  const base = interaction.message.embeds[0];
  const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle("Wager")).setColor(0x2ecc71);
  embed.addFields({ name: "ACCEPTED", value: `<@${interaction.user.id}> took the other side. Sent to Pending Payouts.` });
  await interaction.editReply({ embeds: [embed], components: [] }).catch(() => undefined);

  // Post the pending-payout embed.
  const channelId: string | null = result.pendingPayoutsChannelId ?? null;
  if (channelId) {
    const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased() && !ch.isDMBased()) {
      const payload = {
        wager: w,
        gameLabel: w.game_label ?? embed.data.fields?.find((f) => f.name === "GAME")?.value ?? "—",
        marketLabel: w.market,
        sideLabel: `${w.placed_by_discord_id ? `<@${w.placed_by_discord_id}>` : "Proposer"} vs <@${interaction.user.id}>`,
      };
      const msg = await (ch as TextChannel).send({ embeds: [buildWagerPendingEmbed(payload, false)], components: buildWagerReviewRows(w.id) }).catch(() => null);
      if (msg) await recApi.attachWagerPendingMessage({ wagerId: w.id, channelId: ch.id, messageId: msg.id }).catch(() => undefined);
    }
  }
}

export async function handleWagerTake(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  return acceptPeerAndPost(interaction, interaction.customId.slice(WAGER_CUSTOM_IDS.takePrefix.length));
}

export async function handleWagerAccept(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  return acceptPeerAndPost(interaction, interaction.customId.slice(WAGER_CUSTOM_IDS.acceptPrefix.length));
}

export async function handleWagerDecline(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const wagerId = interaction.customId.slice(WAGER_CUSTOM_IDS.declinePrefix.length);
  try {
    await recApi.declinePeerWager(wagerId);
  } catch (err) {
    return interaction.followUp({ content: userError(err), flags: MessageFlags.Ephemeral });
  }
  await interaction.message.delete().catch(() => undefined);
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

// After a result is logged (box score / weekly scores / advance), flip any now-
// resolvable pending wager embed to the "confirmed — approve enabled" state.
export async function refreshConfirmableWagerEmbeds(client: any, guildId: string): Promise<void> {
  let list: any;
  try {
    list = await recApi.listConfirmableWagers(guildId);
  } catch {
    return;
  }
  for (const w of list?.wagers ?? []) {
    try {
      const channel = await client.channels.fetch(w.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) continue;
      const message = await channel.messages.fetch(w.messageId).catch(() => null);
      if (!message?.embeds?.[0]) continue;
      const embed = EmbedBuilder.from(message.embeds[0]).setColor(0x2ecc71);
      const fields = embed.data.fields ?? [];
      if (fields.length) {
        embed.spliceFields(fields.length - 1, 1, { name: "STATUS", value: "✅ Results logged and confirmed — payout can be approved." });
      }
      await message.edit({ embeds: [embed] }).catch(() => undefined);
    } catch { /* non-fatal per wager */ }
  }
}

// Delete stale pending embeds / open-challenge announcements for wagers refunded on
// advance.
export async function deleteWagerCleanupMessages(client: any, cleanup: any): Promise<void> {
  const messages: any[] = cleanup?.refundedMessages ?? [];
  for (const m of messages) {
    for (const [channelId, messageId] of [[m.pendingChannelId, m.pendingMessageId], [m.announcementChannelId, m.announcementMessageId]] as [string | null, string | null][]) {
      if (!channelId || !messageId) continue;
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased?.()) continue;
        const message = await channel.messages.fetch(messageId).catch(() => null);
        await message?.delete().catch(() => undefined);
      } catch { /* non-fatal */ }
    }
  }
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
