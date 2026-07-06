// Legends store: page 1/2 name-only browse (offense/defense, grouped by position,
// sold names struck through) -> position-group dropdown -> per-legend paginated detail
// view (full attribute breakdown, SOLD banner) -> availability-filtered picker ->
// Confirm Purchase. Reuses the generic purchases request/approval pipeline
// (rec_purchases, purchase_type="legend") — a commissioner installs the legend
// in-game on approval since there's no live roster data source to automate it.

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
import { REC_LEGEND_PRICE } from "@rec/shared";
import { COLORS } from "../lib/colors.js";
import { userFacingError as userError } from "../lib/errors.js";
import { recApi } from "../lib/rec-api.js";
import { NAV_CUSTOM_IDS } from "../ui/navigation.js";

export const LEGENDS_CUSTOM_IDS = {
  pagePrefix: "rec:legend:page:", // + "offense" | "defense"
  groupSelect: "rec:legend:group",
  detailPrev: "rec:legend:prev",
  detailNext: "rec:legend:next",
  availableSelect: "rec:legend:avail",
  confirmPurchase: "rec:legend:confirm",
  backToBrowse: "rec:legend:back_browse",
  replaceModal: "rec:legend:replace_modal",
  replaceInput: "rec:legend:replace_input",
} as const;

// Must match PURCHASE_CUSTOM_IDS.approvePrefix/denyPrefix in flows/purchases.ts — kept
// as separate literals (not imported) to avoid a purchases.ts <-> legends.ts import
// cycle, since purchases.ts hands off to openLegendsBrowse().
const APPROVE_PREFIX = "rec:purchase:approve";
const DENY_PREFIX = "rec:purchase:deny";

const POSITION_ORDER: Record<"offense" | "defense", string[]> = {
  offense: ["QB", "HB", "FB", "WR", "TE", "OL"],
  defense: ["DB", "LB", "DL"],
};
const ALL_GROUPS = [...POSITION_ORDER.offense, ...POSITION_ORDER.defense];

const ATTRIBUTE_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: "Athleticism", keys: ["Speed", "Acceleration", "Agility", "Strength", "Awareness", "Jumping", "Stamina", "Toughness", "Injury"] },
  { label: "Ball Carrier", keys: ["Carrying", "BC Vision", "Break Tackle", "Trucking", "Stiff Arm", "Change of Direction", "Spin Move", "Juke Move"] },
  { label: "Receiving", keys: ["Catching", "Catch in Traffic", "Spectacular Catch", "Short Route Running", "Medium Route Running", "Deep Route Running", "Release"] },
  { label: "Passing", keys: ["Throwing Power", "Short Accuracy", "Medium Accuracy", "Deep Accuracy", "Throw on the Run", "Throw Under Pressure", "Break Sack", "Play Action"] },
  { label: "Blocking", keys: ["Pass Blocking", "Pass Block Power", "Pass Block Finesse", "Run Blocking", "Run Block Power", "Run Block Finesse", "Lead Block", "Impact Blocking"] },
  { label: "Defense", keys: ["Play Recognition", "Tackling", "Hit Power", "Block Shedding", "Finesse Moves", "Power Moves", "Pursuit"] },
  { label: "Coverage", keys: ["Man Coverage", "Zone Coverage", "Press"] },
  { label: "Special Teams", keys: ["Kick/Punt Return", "Kicking Power", "Kicking Accuracy", "Long Snap"] },
];

// Verbatim order requested for the admin pending-purchase embed — mirrors Madden's
// in-game player-edit attribute order so the installer can copy values straight down
// the list. Everything else (route running, passing, blocking) is appended after, so
// QB/OL/TE/FB legends still get a complete reference sheet.
const PENDING_PRIMARY_ATTR_ORDER = [
  "Speed", "Acceleration", "Agility", "Strength", "Awareness", "Carrying", "BC Vision", "Break Tackle",
  "Trucking", "Stiff Arm", "Change of Direction", "Spin Move", "Juke Move", "Catching", "Catch in Traffic",
  "Spectacular Catch", "Jumping", "Play Recognition", "Tackling", "Hit Power", "Block Shedding",
  "Finesse Moves", "Power Moves", "Pursuit", "Man Coverage", "Zone Coverage", "Press", "Kick/Punt Return",
  "Kicking Power", "Kicking Accuracy", "Stamina", "Toughness", "Injury", "Long Snap",
];
const PENDING_SECONDARY_ATTR_ORDER = [
  "Short Route Running", "Medium Route Running", "Deep Route Running", "Release",
  "Throwing Power", "Short Accuracy", "Medium Accuracy", "Deep Accuracy", "Throw on the Run",
  "Throw Under Pressure", "Break Sack", "Play Action",
  "Pass Blocking", "Pass Block Power", "Pass Block Finesse", "Run Blocking", "Run Block Power",
  "Run Block Finesse", "Lead Block", "Impact Blocking",
];

type LegendRow = {
  id: string; name: string; position: string; position_group: "offense" | "defense";
  est_ovr: number; height: string | null; weight: number | null; hand: string | null;
  jersey_number: number | null; dev_trait: string | null; archetype: string | null;
  build_note: string | null; college: string | null; attributes: Record<string, number>;
};

type LegendSession = {
  legends: LegendRow[];
  soldIds: Set<string>;
  view: "browse" | "detail";
  side: "offense" | "defense";
  group: string | null;
  legendIndex: number;
  at: number;
  // Campus Legends (CFB) always carry a college; Madden Legends never do.
  isCfb: boolean;
};

const sessions = new Map<string, LegendSession>();
const SESSION_TTL = 15 * 60 * 1000;

function getSession(userId: string): LegendSession | null {
  const s = sessions.get(userId);
  if (s && Date.now() - s.at < SESSION_TTL) return s;
  sessions.delete(userId);
  return null;
}

function backRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.mainMenu).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary));
}

function expiredEmbed() {
  return new EmbedBuilder().setTitle("Legends").setColor(COLORS.error).setDescription("This session expired. Reopen the Store > Legends.");
}

function groupLegends(session: LegendSession): LegendRow[] {
  return session.legends.filter((l) => l.position === session.group).sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Entry point ────────────────────────────────────────────────────────────────
export async function openLegendsBrowse(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Legends...").setDescription("Fetching the catalog and league availability.")], components: [] });

  let catalog: any, availability: any;
  try {
    [catalog, availability] = await Promise.all([
      recApi.listLegendCatalog(interaction.guildId),
      recApi.listLegendAvailability(interaction.guildId),
    ]);
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Legends").setColor(COLORS.error).setDescription(userError(err))], components: [backRow()] });
  }

  const legends: LegendRow[] = catalog?.legends ?? [];
  const soldIds = new Set<string>(availability?.soldLegendIds ?? []);
  const isCfb = legends.some((l) => Boolean(l.college));
  sessions.set(interaction.user.id, { legends, soldIds, view: "browse", side: "offense", group: null, legendIndex: 0, at: Date.now(), isCfb });
  return interaction.editReply(buildBrowsePayload(sessions.get(interaction.user.id)!));
}

// ─── Page 1/2 browse (names only, grouped by position) ─────────────────────────
function buildBrowsePayload(session: LegendSession) {
  const side = session.side;
  const bySide = session.legends.filter((l) => l.position_group === side);
  const lines = POSITION_ORDER[side]
    .map((pos) => {
      const players = bySide.filter((l) => l.position === pos).sort((a, b) => a.name.localeCompare(b.name));
      if (!players.length) return null;
      const names = players.map((l) => (session.soldIds.has(l.id) ? `~~${l.name}~~` : l.name)).join(", ");
      return `**${pos}:** ${names}`;
    })
    .filter((line): line is string => Boolean(line));

  const otherSide: "offense" | "defense" = side === "offense" ? "defense" : "offense";
  const pageRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${LEGENDS_CUSTOM_IDS.pagePrefix}${otherSide}`).setLabel(side === "offense" ? "Defense ▶" : "◀ Offense").setStyle(ButtonStyle.Primary));

  const groupMenu = new StringSelectMenuBuilder()
    .setCustomId(LEGENDS_CUSTOM_IDS.groupSelect)
    .setPlaceholder("Select a position group for full details")
    .addOptions(ALL_GROUPS.map((pos) => new StringSelectMenuOptionBuilder().setLabel(pos).setValue(pos)));

  const storeName = session.isCfb ? "Campus Legends" : "Legends";
  return {
    embeds: [new EmbedBuilder()
      .setTitle(`${storeName} — ${side === "offense" ? "Offense" : "Defense"} (Page ${side === "offense" ? 1 : 2} of 2)`)
      .setColor(COLORS.purple)
      .setDescription([`$${REC_LEGEND_PRICE} each. ~~Struck-through~~ names are already purchased in this league.`, "", ...lines].join("\n"))],
    components: [pageRow, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(groupMenu), backRow()],
  };
}

export async function handleLegendPageButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  if (!session) return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  session.side = interaction.customId.slice(LEGENDS_CUSTOM_IDS.pagePrefix.length) as "offense" | "defense";
  session.view = "browse";
  session.at = Date.now();
  return interaction.editReply(buildBrowsePayload(session));
}

// ─── Per-legend paginated detail view ────────────────────────────────────────────
function buildDetailPayload(session: LegendSession) {
  const list = groupLegends(session);
  if (!list.length) {
    return { embeds: [new EmbedBuilder().setTitle("Legends").setColor(COLORS.warning).setDescription("No legends found for that position.")], components: [backToBrowseRow()] };
  }
  session.legendIndex = Math.max(0, Math.min(session.legendIndex, list.length - 1));
  const legend = list[session.legendIndex];
  const sold = session.soldIds.has(legend.id);

  const embed = new EmbedBuilder()
    .setTitle(`${legend.name} — ${legend.position} (Est. ${legend.est_ovr} OVR)`)
    .setColor(sold ? COLORS.neutral : COLORS.purple)
    .setDescription([
      sold ? "**SOLD — already purchased in this league.**" : `**$${REC_LEGEND_PRICE}** — available for purchase.`,
      "",
      legend.college ? `College: ${legend.college}` : "",
      `Height: ${legend.height ?? "—"}  |  Weight: ${legend.weight ?? "—"}  |  Hand: ${legend.hand ?? "—"}`,
      `Dev Trait: ${legend.dev_trait ?? "—"}  |  Archetype: ${legend.archetype ?? "—"}`,
      legend.build_note ? `_${legend.build_note}_` : "",
    ].filter(Boolean).join("\n"))
    .setFooter({ text: `Legend ${session.legendIndex + 1} of ${list.length} — ${session.group}. Attribute values are estimates, subject to slight change to hit 88 OVR.` });

  for (const group of ATTRIBUTE_GROUPS) {
    const value = group.keys.map((k) => `${k}: ${legend.attributes?.[k] ?? "—"}`).join("\n");
    embed.addFields({ name: group.label, value: value.slice(0, 1024), inline: true });
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(LEGENDS_CUSTOM_IDS.detailPrev).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary).setDisabled(session.legendIndex === 0),
    new ButtonBuilder().setCustomId(LEGENDS_CUSTOM_IDS.detailNext).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(session.legendIndex === list.length - 1),
    new ButtonBuilder().setCustomId(LEGENDS_CUSTOM_IDS.backToBrowse).setLabel("Back to List").setStyle(ButtonStyle.Secondary));

  const groupMenu = new StringSelectMenuBuilder()
    .setCustomId(LEGENDS_CUSTOM_IDS.groupSelect)
    .setPlaceholder(`Switch position group (currently ${session.group})`)
    .addOptions(ALL_GROUPS.map((pos) => new StringSelectMenuOptionBuilder().setLabel(pos).setValue(pos).setDefault(pos === session.group)));

  const available = list.filter((l) => !session.soldIds.has(l.id));
  const availMenu = new StringSelectMenuBuilder()
    .setCustomId(LEGENDS_CUSTOM_IDS.availableSelect)
    .setPlaceholder(available.length ? "Pick a legend to purchase" : "No legends available in this group")
    .setDisabled(!available.length)
    .addOptions(available.length
      ? available.slice(0, 25).map((l) => new StringSelectMenuOptionBuilder().setLabel(l.name).setValue(l.id).setDefault(l.id === legend.id))
      : [new StringSelectMenuOptionBuilder().setLabel("None available").setValue("none")]);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(LEGENDS_CUSTOM_IDS.confirmPurchase).setLabel("Confirm Purchase").setStyle(ButtonStyle.Success).setDisabled(sold),
    new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.mainMenu).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary));

  return {
    embeds: [embed],
    components: [navRow, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(groupMenu), new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(availMenu), actionRow],
  };
}

function backToBrowseRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(LEGENDS_CUSTOM_IDS.backToBrowse).setLabel("Back to List").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.mainMenu).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary));
}

export async function handleLegendGroupSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  if (!session) return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  session.group = interaction.values[0];
  session.view = "detail";
  session.legendIndex = 0;
  session.at = Date.now();
  return interaction.editReply(buildDetailPayload(session));
}

export async function handleLegendDetailNav(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  if (!session || session.view !== "detail") return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  const list = groupLegends(session);
  if (interaction.customId === LEGENDS_CUSTOM_IDS.detailPrev) session.legendIndex = Math.max(0, session.legendIndex - 1);
  else session.legendIndex = Math.min(list.length - 1, session.legendIndex + 1);
  session.at = Date.now();
  return interaction.editReply(buildDetailPayload(session));
}

export async function handleLegendAvailableSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  if (!session || session.view !== "detail") return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  const value = interaction.values[0];
  if (value && value !== "none") {
    const list = groupLegends(session);
    const idx = list.findIndex((l) => l.id === value);
    if (idx >= 0) session.legendIndex = idx;
  }
  session.at = Date.now();
  return interaction.editReply(buildDetailPayload(session));
}

export async function handleLegendBackToBrowse(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const session = getSession(interaction.user.id);
  if (!session) return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  session.view = "browse";
  session.at = Date.now();
  return interaction.editReply(buildBrowsePayload(session));
}

// ─── Confirm purchase ─────────────────────────────────────────────────────────
export async function handleLegendConfirmPurchase(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.user.id);
  if (!session || session.view !== "detail" || !session.group) {
    await interaction.deferUpdate();
    return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  }
  const list = groupLegends(session);
  const legend = list[session.legendIndex];
  if (!legend) {
    await interaction.deferUpdate();
    return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  }
  if (session.soldIds.has(legend.id)) {
    await interaction.deferUpdate();
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Legends").setColor(COLORS.error).setDescription(`${legend.name} has already been purchased in this league.`)], components: [backRow()] });
  }

  return interaction.showModal(new ModalBuilder()
    .setCustomId(LEGENDS_CUSTOM_IDS.replaceModal)
    .setTitle(`Confirm — ${legend.name}`.slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(LEGENDS_CUSTOM_IDS.replaceInput)
        .setLabel("Player to replace (optional)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)
        .setPlaceholder("Leave blank to replace your lowest-OVR player at this position"))));
}

export async function handleLegendReplaceModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  const session = getSession(interaction.user.id);
  if (!session || session.view !== "detail" || !session.group) {
    await interaction.deferUpdate();
    return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  }
  const list = groupLegends(session);
  const legend = list[session.legendIndex];
  if (!legend) {
    await interaction.deferUpdate();
    return interaction.editReply({ embeds: [expiredEmbed()], components: [backRow()] });
  }
  if (session.soldIds.has(legend.id)) {
    await interaction.deferUpdate();
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Legends").setColor(COLORS.error).setDescription(`${legend.name} has already been purchased in this league.`)], components: [backRow()] });
  }
  const replacePlayerRequest = interaction.fields.getTextInputValue(LEGENDS_CUSTOM_IDS.replaceInput).trim() || null;

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Submitting Purchase...").setDescription(`Requesting **${legend.name}** ($${REC_LEGEND_PRICE}).`)], components: [] });

  let result: any;
  try {
    result = await recApi.purchaseLegend({ guildId: interaction.guildId, discordId: interaction.user.id, legendId: legend.id, replacePlayerRequest });
  } catch (err) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Purchase Failed").setColor(COLORS.error).setDescription(userError(err))], components: [backRow()] });
  }
  session.soldIds.add(legend.id);
  sessions.delete(interaction.user.id);

  let posted = false;
  const channelId: string | null = result?.pendingPurchasesChannelId ?? null;
  if (channelId) {
    const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased() && !ch.isDMBased()) {
      const msg = await (ch as TextChannel).send({
        embeds: [buildLegendPendingEmbed(result.purchase, interaction.user.id)],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${APPROVE_PREFIX}:${result.purchase.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${DENY_PREFIX}:${result.purchase.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger))],
      }).catch(() => null);
      posted = Boolean(msg);
    }
  }

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("Legend Requested ✅")
      .setColor(COLORS.success)
      .setDescription([
        `**${legend.name}** (${legend.position}) — $${result.price ?? REC_LEGEND_PRICE} deducted. Wallet: **$${result.walletBalance}**.`,
        "",
        replacePlayerRequest
          ? `Once a commissioner approves, they'll install the legend in-game, replacing **${replacePlayerRequest}** as you requested.`
          : "Once a commissioner approves, they'll install the legend in-game, replacing your lowest-OVR player at this position.",
        "The legend is installed on a 7-year contract at the lowest contract value (if the salary cap is on).",
        posted ? "Sent to Pending Purchases for review." : "No Pending Purchases channel is configured — ask a commissioner to review it.",
      ].join("\n"))],
    components: [backRow()],
  });
}

function buildLegendPendingEmbed(purchase: any, buyerDiscordId: string): EmbedBuilder {
  const d = purchase.details ?? {};
  const attrs: Record<string, number> = d.attributes ?? {};
  const primary = PENDING_PRIMARY_ATTR_ORDER.map((k) => `${k}: ${attrs[k] ?? "—"}`).join("\n");
  const secondary = PENDING_SECONDARY_ATTR_ORDER.map((k) => `${k}: ${attrs[k] ?? "—"}`).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`Pending Legend Purchase — ${d.name ?? "Legend"}`)
    .setColor(COLORS.purple)
    .setDescription([
      `**Buyer:** <@${buyerDiscordId}>`,
      `**Team:** ${d.purchasingTeamName ?? "Unknown"}`,
      d.college ? `**College:** ${d.college}` : "",
      `**Position:** ${d.position ?? "—"}  |  **Est. OVR:** ${d.estOvr ?? "—"}`,
      `**Height/Weight:** ${d.height ?? "—"} / ${d.weight ?? "—"}  |  **Hand:** ${d.hand ?? "—"}  |  **Jersey:** ${d.jerseyNumber ?? "—"}`,
      `**Dev Trait:** ${d.devTrait ?? "—"}  |  **Archetype:** ${d.archetype ?? "—"}`,
      d.buildNote ? `_${d.buildNote}_` : "",
      "",
      `**Cost:** $${purchase.cost ?? REC_LEGEND_PRICE}`,
      "",
      d.replacePlayerRequest
        ? `**Replace:** ${d.replacePlayerRequest} (buyer's request)`
        : "**Replace:** the buyer's lowest-OVR player at this position (no specific request made).",
      "**Contract:** install on a 7-year deal at the lowest contract value (if the salary cap is on).",
    ].filter(Boolean).join("\n"));

  embed.addFields(
    { name: "Attributes (Madden edit order)", value: primary.slice(0, 1024), inline: true },
    { name: "Additional Attributes", value: secondary.slice(0, 1024), inline: true });
  embed.setFooter({ text: `Purchase ${purchase.id} — attribute values are estimates, subject to slight change to hit 88 OVR.` });
  return embed;
}
