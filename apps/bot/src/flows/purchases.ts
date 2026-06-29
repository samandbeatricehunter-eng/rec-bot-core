import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
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
} from "discord.js";
import {
  MADDEN_ATTRIBUTE_BY_CODE,
  MADDEN_ATTRIBUTE_DROPDOWN_GROUPS,
  priceForPurchase,
  REC_ATTRIBUTE_POINT_PRICE,
  REC_CONTRACT_PRICE,
  REC_CONTRACT_VARIANT_LABELS,
  REC_DEFENSE_POSITIONS,
  REC_DEV_TIER_LABELS,
  REC_DEV_UPGRADE_PRICE,
  REC_OFFENSE_POSITIONS,
  REC_PURCHASE_TYPE_LABELS,
  type MaddenAttributeCode,
  type MaddenAttributeDropdownGroupKey,
  type RecAttributeAllocation,
  type RecContractVariant,
  type RecDevTier,
  type RecPurchaseType,
} from "@rec/shared";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { NAV_CUSTOM_IDS } from "../ui/navigation.js";

// All custom IDs share this prefix so the main dispatcher can route them with one line per
// interaction-type block.
export const PURCHASE_CUSTOM_IDS = {
  typeSelect: "rec:purchase:type",
  devTierSelect: "rec:purchase:devtier",
  contractSelect: "rec:purchase:contractvariant",
  sideSelect: "rec:purchase:side",
  positionSelect: "rec:purchase:position",
  nameModal: "rec:purchase:namemodal",
  submit: "rec:purchase:submit",
  cancel: "rec:purchase:cancel",
  approvePrefix: "rec:purchase:approve",
  denyPrefix: "rec:purchase:deny",
  denyModalPrefix: "rec:purchase:denymodal",
  attrGroupPrefix: "rec:purchase:attrgroup",
  attrSetAmounts: "rec:purchase:attrsetamounts",
  attrAmountsModal: "rec:purchase:attramounts",
} as const;

// Store types: the simple request-and-approve player types plus Attribute points.
const STORE_TYPES: RecPurchaseType[] = ["age_reset", "dev_upgrade", "contract", "player_trait", "attribute"];
const TYPE_ENABLED_FLAG: Record<string, keyof any> = {
  age_reset: "ageResetsEnabled",
  dev_upgrade: "devUpgradesEnabled",
  contract: "contractAdjustmentPurchasesEnabled",
  player_trait: "playerTraitPurchasesEnabled",
  attribute: "attributePurchasesEnabled",
};
const MAX_ATTRS_PER_PURCHASE = 5;

type PurchaseDraft = {
  purchaseType: RecPurchaseType;
  details: Record<string, unknown>;
  coreSet?: string[];
  attrSelected?: Record<string, string[]>;
};
const purchaseSessions = new Map<string, PurchaseDraft>();

function staticPriceLabel(type: RecPurchaseType): string {
  if (type === "dev_upgrade") return "from $250";
  if (type === "contract") return "$500";
  if (type === "attribute") return "$100/pt core, $50/pt non-core";
  return `$${priceForPurchase(type, {})}`;
}

function draftPrice(draft: PurchaseDraft): number {
  return priceForPurchase(draft.purchaseType, draft.details);
}

function positionsForSide(side: string): readonly string[] {
  return side === "defense" ? REC_DEFENSE_POSITIONS : REC_OFFENSE_POSITIONS;
}

// ─── Attribute picker ───────────────────────────────────────────────────────────
function selectedAttrCodes(draft: PurchaseDraft): string[] {
  return Object.values(draft.attrSelected ?? {}).flat();
}

function isCore(draft: PurchaseDraft, code: string): boolean {
  return (draft.coreSet ?? []).includes(code);
}

function formatAllocations(allocations: RecAttributeAllocation[] | undefined): string {
  if (!allocations?.length) return "—";
  return allocations.map((a) => `+${a.points} ${a.code}${a.core ? "" : " (NC)"}`).join(", ");
}

function attributePickerPayload(draft: PurchaseDraft) {
  const chosen = selectedAttrCodes(draft);
  const groups = Object.entries(MADDEN_ATTRIBUTE_DROPDOWN_GROUPS) as Array<
    [MaddenAttributeDropdownGroupKey, typeof MADDEN_ATTRIBUTE_DROPDOWN_GROUPS[MaddenAttributeDropdownGroupKey]]
  >;
  const rows = groups.map(([groupKey, group]) => {
    const sel = draft.attrSelected?.[groupKey] ?? [];
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PURCHASE_CUSTOM_IDS.attrGroupPrefix}:${groupKey}`)
        .setPlaceholder(group.label)
        .setMinValues(0)
        .setMaxValues(group.codes.length)
        .addOptions(
          ...group.codes.map((code) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${code} — ${MADDEN_ATTRIBUTE_BY_CODE.get(code)?.name ?? code}`.slice(0, 100))
              .setValue(code)
              .setDescription(isCore(draft, code) ? `Core $${REC_ATTRIBUTE_POINT_PRICE.core}/pt` : `Non-Core $${REC_ATTRIBUTE_POINT_PRICE.non_core}/pt`)
              .setDefault(sel.includes(code))
          )
        )
    );
  });
  const lines = [
    `Pick the attributes to upgrade (up to ${MAX_ATTRS_PER_PURCHASE} per purchase), then set point amounts. **Core** = $${REC_ATTRIBUTE_POINT_PRICE.core}/pt, **Non-Core** = $${REC_ATTRIBUTE_POINT_PRICE.non_core}/pt.`,
    "",
    chosen.length ? `**Selected (${chosen.length}/${MAX_ATTRS_PER_PURCHASE}):** ${chosen.join(", ")}` : "_Nothing selected yet._",
  ];
  if (chosen.length > MAX_ATTRS_PER_PURCHASE) lines.push(`⚠️ Pick at most ${MAX_ATTRS_PER_PURCHASE}.`);
  return {
    embeds: [new EmbedBuilder().setTitle("Attribute Points").setDescription(lines.join("\n"))],
    components: [
      ...rows,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(PURCHASE_CUSTOM_IDS.attrSetAmounts).setLabel("Set Amounts").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(PURCHASE_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildAmountsModal(codes: string[]) {
  const modal = new ModalBuilder().setCustomId(PURCHASE_CUSTOM_IDS.attrAmountsModal).setTitle("Attribute Point Amounts");
  for (const code of codes.slice(0, MAX_ATTRS_PER_PURCHASE)) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`pts:${code}`)
          .setLabel(`${code} — ${MADDEN_ATTRIBUTE_BY_CODE.get(code as MaddenAttributeCode)?.name ?? code}`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(3)
          .setPlaceholder("Points to add")
      )
    );
  }
  return modal;
}

// ─── Store landing ──────────────────────────────────────────────────────────────
export async function openPurchaseStore(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Loading Store...").setDescription("Checking your wallet and the league's enabled purchases.")],
    components: [],
  });

  const guildId = interaction.guildId ?? undefined;
  const [walletPayload, configPayload, countsPayload] = await Promise.all([
    recApi.getWallet(interaction.user.id, guildId).catch(() => null),
    guildId ? recApi.getLeagueConfig(guildId).catch(() => null) : Promise.resolve(null),
    guildId ? recApi.getPurchaseCounts(interaction.user.id, guildId).catch(() => null) : Promise.resolve(null),
  ]);

  const draft = (configPayload as any)?.draft ?? null;
  const wallet = Number(walletPayload?.wallet?.wallet_balance ?? 0);
  const seasonActive: Record<string, number> = countsPayload?.seasonActive ?? {};

  if (!draft?.coinEconomyEnabled) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Store").setDescription("The coin economy is not enabled for this league, so purchases are unavailable.")],
      components: [backRow()],
    });
  }

  const available = STORE_TYPES.filter((type) => Boolean(draft?.[TYPE_ENABLED_FLAG[type] as string]));
  if (!available.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Store").setDescription([
        `**Wallet:** $${wallet}`,
        "",
        "No purchase types are enabled for this league yet. A commissioner can enable them in League Mgmt > Settings > Purchases.",
      ].join("\n"))],
      components: [backRow()],
    });
  }

  const lines = available.map((type) => {
    const used = seasonActive[type] ? ` — ${seasonActive[type]} this season` : "";
    return `**${REC_PURCHASE_TYPE_LABELS[type]}** (${staticPriceLabel(type)})${used}`;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(PURCHASE_CUSTOM_IDS.typeSelect)
    .setPlaceholder("Choose a purchase")
    .addOptions(
      ...available.map((type) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(REC_PURCHASE_TYPE_LABELS[type])
          .setValue(type)
          .setDescription(staticPriceLabel(type).slice(0, 100))
      )
    );

  purchaseSessions.delete(interaction.user.id);
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Store").setDescription([
      `**Wallet:** $${wallet}`,
      "",
      ...lines,
      "",
      "Purchases are deducted when you submit and require commissioner approval. Denied purchases are refunded.",
    ].join("\n"))],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), backRow()],
  });
}

function backRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(NAV_CUSTOM_IDS.mainMenu).setLabel("Back to Menu").setStyle(ButtonStyle.Secondary)
  );
}

function sideSelectComponents() {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(PURCHASE_CUSTOM_IDS.sideSelect)
        .setPlaceholder("Offense or Defense?")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("Offense").setValue("offense").setDescription("QB, HB, WR, OL, Kicker…"),
          new StringSelectMenuOptionBuilder().setLabel("Defense").setValue("defense").setDescription("DL, LB, DB, Punter…")
        )
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(PURCHASE_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ─── Select routing ───────────────────────────────────────────────────────────
export async function handlePurchaseSelect(interaction: StringSelectMenuInteraction) {
  const id = interaction.customId;
  const value = interaction.values[0]!;

  if (id === PURCHASE_CUSTOM_IDS.typeSelect) {
    const purchaseType = value as RecPurchaseType;
    purchaseSessions.set(interaction.user.id, { purchaseType, details: {} });
    if (purchaseType === "dev_upgrade") {
      return interaction.update({
        embeds: [stepEmbed("Dev Upgrade", "Choose the development tier to upgrade the player into (one tier per purchase).")],
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(PURCHASE_CUSTOM_IDS.devTierSelect).setPlaceholder("Target dev tier").addOptions(
              new StringSelectMenuOptionBuilder().setLabel(`${REC_DEV_TIER_LABELS.star} ($${REC_DEV_UPGRADE_PRICE.star})`).setValue("star"),
              new StringSelectMenuOptionBuilder().setLabel(`${REC_DEV_TIER_LABELS.superstar} ($${REC_DEV_UPGRADE_PRICE.superstar})`).setValue("superstar"),
              new StringSelectMenuOptionBuilder().setLabel(`${REC_DEV_TIER_LABELS.xfactor} ($${REC_DEV_UPGRADE_PRICE.xfactor})`).setValue("xfactor")
            )
          ),
          cancelRow(),
        ],
      });
    }
    if (purchaseType === "contract") {
      return interaction.update({
        embeds: [stepEmbed("Contract", "Choose the contract adjustment you want.")],
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(PURCHASE_CUSTOM_IDS.contractSelect).setPlaceholder("Contract adjustment").addOptions(
              new StringSelectMenuOptionBuilder().setLabel(`${REC_CONTRACT_VARIANT_LABELS.salary_bonus_reduction} ($${REC_CONTRACT_PRICE.salary_bonus_reduction})`).setValue("salary_bonus_reduction"),
              new StringSelectMenuOptionBuilder().setLabel(`${REC_CONTRACT_VARIANT_LABELS.extension} ($${REC_CONTRACT_PRICE.extension})`).setValue("extension")
            )
          ),
          cancelRow(),
        ],
      });
    }
    if (purchaseType === "attribute") {
      // Attribute points are chosen before the player target.
      await interaction.deferUpdate();
      const config = interaction.guildId ? await recApi.getLeagueConfig(interaction.guildId).catch(() => null) : null;
      const coreSet: string[] = Array.isArray((config as any)?.draft?.coreAttributes) ? (config as any).draft.coreAttributes : [];
      const session = purchaseSessions.get(interaction.user.id)!;
      session.coreSet = coreSet;
      session.attrSelected = {};
      return interaction.editReply(attributePickerPayload(session));
    }
    // age_reset / player_trait → straight to player target
    return interaction.update({ embeds: [stepEmbed(REC_PURCHASE_TYPE_LABELS[purchaseType], "Which side of the ball is the player on?")], components: sideSelectComponents() });
  }

  const draft = purchaseSessions.get(interaction.user.id);
  if (!draft) return interaction.update({ embeds: [stepEmbed("Store", "This purchase session expired. Reopen the Store.")], components: [backRow()] });

  if (id.startsWith(PURCHASE_CUSTOM_IDS.attrGroupPrefix)) {
    const group = id.split(":").pop() as MaddenAttributeDropdownGroupKey;
    draft.attrSelected = draft.attrSelected ?? {};
    draft.attrSelected[group] = interaction.values;
    return interaction.update(attributePickerPayload(draft));
  }

  if (id === PURCHASE_CUSTOM_IDS.devTierSelect) {
    draft.details.targetTier = value as RecDevTier;
    return interaction.update({ embeds: [stepEmbed("Dev Upgrade", "Which side of the ball is the player on?")], components: sideSelectComponents() });
  }
  if (id === PURCHASE_CUSTOM_IDS.contractSelect) {
    draft.details.variant = value as RecContractVariant;
    return interaction.update({ embeds: [stepEmbed("Contract", "Which side of the ball is the player on?")], components: sideSelectComponents() });
  }
  if (id === PURCHASE_CUSTOM_IDS.sideSelect) {
    draft.details.side = value;
    const positions = positionsForSide(value);
    return interaction.update({
      embeds: [stepEmbed(REC_PURCHASE_TYPE_LABELS[draft.purchaseType], "Select the player's position.")],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId(PURCHASE_CUSTOM_IDS.positionSelect).setPlaceholder("Position").addOptions(
            ...positions.map((pos) => new StringSelectMenuOptionBuilder().setLabel(pos).setValue(pos))
          )
        ),
        cancelRow(),
      ],
    });
  }
  if (id === PURCHASE_CUSTOM_IDS.positionSelect) {
    draft.details.position = value;
    return interaction.showModal(buildNameModal(draft));
  }
  return interaction.update({ embeds: [stepEmbed("Store", "Unrecognized step. Reopen the Store.")], components: [backRow()] });
}

function buildNameModal(draft: PurchaseDraft) {
  const modal = new ModalBuilder().setCustomId(PURCHASE_CUSTOM_IDS.nameModal).setTitle(`${REC_PURCHASE_TYPE_LABELS[draft.purchaseType]} — Player`);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("playerName").setLabel("Player name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
    )
  );
  if (draft.purchaseType === "player_trait") {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("traitChange")
          .setLabel("Desired trait change")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300)
          .setPlaceholder("e.g. set Ball In Air to Aggressive")
      )
    );
  }
  return modal;
}

// ─── Modal routing ───────────────────────────────────────────────────────────
export async function handlePurchaseModal(interaction: ModalSubmitInteraction) {
  if (interaction.customId.startsWith(PURCHASE_CUSTOM_IDS.denyModalPrefix)) {
    return handleDenyModal(interaction);
  }
  if (interaction.customId === PURCHASE_CUSTOM_IDS.attrAmountsModal) {
    if (!interaction.isFromMessage()) return interaction.reply({ content: "Could not continue this purchase. Reopen the Store.", flags: MessageFlags.Ephemeral });
    const draft = purchaseSessions.get(interaction.user.id);
    if (!draft) return interaction.reply({ content: "This purchase session expired. Reopen the Store.", flags: MessageFlags.Ephemeral });
    const allocations: RecAttributeAllocation[] = [];
    for (const code of selectedAttrCodes(draft).slice(0, MAX_ATTRS_PER_PURCHASE)) {
      const pts = Math.max(0, Math.floor(Number(interaction.fields.getTextInputValue(`pts:${code}`)) || 0));
      if (pts > 0) allocations.push({ code, points: pts, core: isCore(draft, code) });
    }
    if (!allocations.length) return interaction.reply({ content: "Enter a positive point amount for at least one attribute.", flags: MessageFlags.Ephemeral });
    draft.details.allocations = allocations;
    return interaction.update({ embeds: [stepEmbed("Attribute Points", "Which side of the ball is the player on?")], components: sideSelectComponents() });
  }
  if (interaction.customId === PURCHASE_CUSTOM_IDS.nameModal) {
    if (!interaction.isFromMessage()) return interaction.reply({ content: "Could not continue this purchase. Reopen the Store.", flags: MessageFlags.Ephemeral });
    const draft = purchaseSessions.get(interaction.user.id);
    if (!draft) return interaction.reply({ content: "This purchase session expired. Reopen the Store.", flags: MessageFlags.Ephemeral });
    draft.details.playerName = interaction.fields.getTextInputValue("playerName").trim();
    if (draft.purchaseType === "player_trait") {
      draft.details.traitChange = interaction.fields.getTextInputValue("traitChange").trim();
    }
    return interaction.update({ embeds: [confirmEmbed(draft)], components: [confirmRow()] });
  }
  return interaction.reply({ content: "Unrecognized purchase step.", flags: MessageFlags.Ephemeral });
}

function confirmEmbed(draft: PurchaseDraft) {
  const d = draft.details;
  const lines = [`**Type:** ${REC_PURCHASE_TYPE_LABELS[draft.purchaseType]}`];
  if (draft.purchaseType === "dev_upgrade") lines.push(`**Upgrade to:** ${REC_DEV_TIER_LABELS[d.targetTier as RecDevTier]}`);
  if (draft.purchaseType === "contract") lines.push(`**Adjustment:** ${REC_CONTRACT_VARIANT_LABELS[d.variant as RecContractVariant]}`);
  if (draft.purchaseType === "attribute") lines.push(`**Upgrades:** ${formatAllocations(d.allocations as RecAttributeAllocation[] | undefined)}`);
  lines.push(`**Player:** ${d.playerName} (${String(d.position)}, ${d.side === "defense" ? "Defense" : "Offense"})`);
  if (draft.purchaseType === "player_trait") lines.push(`**Trait change:** ${d.traitChange}`);
  lines.push("", `**Cost:** $${draftPrice(draft)}`, "", "Submitting deducts the cost now and sends the request for commissioner approval. Denied requests are refunded.");
  return new EmbedBuilder().setTitle("Confirm Purchase").setDescription(lines.join("\n"));
}

function confirmRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PURCHASE_CUSTOM_IDS.submit).setLabel("Submit Purchase").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(PURCHASE_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function cancelRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PURCHASE_CUSTOM_IDS.cancel).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function stepEmbed(title: string, body: string) {
  return new EmbedBuilder().setTitle(title).setDescription(body);
}

// ─── Button routing ───────────────────────────────────────────────────────────
export async function handlePurchaseButton(interaction: ButtonInteraction) {
  const id = interaction.customId;
  if (id === PURCHASE_CUSTOM_IDS.cancel) {
    purchaseSessions.delete(interaction.user.id);
    return interaction.update({ embeds: [stepEmbed("Store", "Purchase cancelled.")], components: [backRow()] });
  }
  if (id === PURCHASE_CUSTOM_IDS.attrSetAmounts) {
    const draft = purchaseSessions.get(interaction.user.id);
    if (!draft) return interaction.update({ embeds: [stepEmbed("Store", "This purchase session expired. Reopen the Store.")], components: [backRow()] });
    const codes = selectedAttrCodes(draft);
    if (!codes.length) return interaction.reply({ content: "Select at least one attribute first.", flags: MessageFlags.Ephemeral });
    if (codes.length > MAX_ATTRS_PER_PURCHASE) return interaction.reply({ content: `Select at most ${MAX_ATTRS_PER_PURCHASE} attributes per purchase.`, flags: MessageFlags.Ephemeral });
    return interaction.showModal(buildAmountsModal(codes));
  }
  if (id === PURCHASE_CUSTOM_IDS.submit) return submitPurchase(interaction);
  if (id.startsWith(PURCHASE_CUSTOM_IDS.approvePrefix)) return handleApprove(interaction);
  if (id.startsWith(PURCHASE_CUSTOM_IDS.denyPrefix)) return handleDenyOpen(interaction);
  return interaction.reply({ content: "Unrecognized purchase action.", flags: MessageFlags.Ephemeral });
}

async function submitPurchase(interaction: ButtonInteraction) {
  const draft = purchaseSessions.get(interaction.user.id);
  if (!draft) return interaction.update({ embeds: [stepEmbed("Store", "This purchase session expired. Reopen the Store.")], components: [backRow()] });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [stepEmbed("Submitting Purchase...", "Deducting your wallet and sending the request for approval.")], components: [] });

  try {
    const result = await recApi.createPurchaseRequest({
      guildId: interaction.guildId!,
      discordId: interaction.user.id,
      purchaseType: draft.purchaseType,
      details: draft.details,
    });
    purchaseSessions.delete(interaction.user.id);
    await postPendingPurchase(interaction, result);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Purchase Requested").setDescription([
        `Your **${REC_PURCHASE_TYPE_LABELS[draft.purchaseType]}** request was submitted.`,
        `**$${result.price}** was deducted. Your wallet is now **$${result.walletBalance}**.`,
        "",
        result.pendingPurchasesChannelId
          ? "A commissioner will review it. If denied, you'll be refunded."
          : "Note: no pending-purchases channel is configured, so ask a commissioner to review it. If denied, you'll be refunded.",
      ].join("\n"))],
      components: [backRow()],
    });
  } catch (err: any) {
    const message = parseApiError(err);
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Purchase Failed").setDescription(message)], components: [backRow()] });
  }
}

async function postPendingPurchase(interaction: ButtonInteraction, result: any) {
  const channelId = result?.pendingPurchasesChannelId;
  const purchase = result?.purchase;
  if (!channelId || !purchase || !interaction.guild) return;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  await channel.send({
    embeds: [pendingEmbed(purchase, interaction.user.id)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PURCHASE_CUSTOM_IDS.approvePrefix}:${purchase.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PURCHASE_CUSTOM_IDS.denyPrefix}:${purchase.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
      ),
    ],
  }).catch(() => undefined);
}

function pendingEmbed(purchase: any, buyerDiscordId: string) {
  const d = purchase.details ?? {};
  const type = purchase.purchase_type as RecPurchaseType;
  const lines = [
    `**Buyer:** <@${buyerDiscordId}>`,
    `**Type:** ${REC_PURCHASE_TYPE_LABELS[type] ?? type}`,
  ];
  if (type === "dev_upgrade" && d.targetTier) lines.push(`**Upgrade to:** ${REC_DEV_TIER_LABELS[d.targetTier as RecDevTier] ?? d.targetTier}`);
  if (type === "contract" && d.variant) lines.push(`**Adjustment:** ${REC_CONTRACT_VARIANT_LABELS[d.variant as RecContractVariant] ?? d.variant}`);
  if (type === "attribute") lines.push(`**Upgrades:** ${formatAllocations(d.allocations as RecAttributeAllocation[] | undefined)}`);
  if (d.playerName) lines.push(`**Player:** ${d.playerName}${d.position ? ` (${d.position})` : ""}`);
  if (type === "player_trait" && d.traitChange) lines.push(`**Trait change:** ${d.traitChange}`);
  lines.push(`**Cost:** $${purchase.cost ?? 0}`);
  return new EmbedBuilder().setTitle("Pending Purchase").setDescription(lines.join("\n"));
}

async function handleApprove(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only a commissioner can review purchases.", flags: MessageFlags.Ephemeral });
  }
  const purchaseId = interaction.customId.split(":").pop()!;
  await interaction.deferUpdate();
  try {
    const result = await recApi.reviewPurchase({ purchaseId, action: "approve", reviewedByDiscordId: interaction.user.id });
    if (!result.updated) {
      return interaction.editReply({ components: [] , embeds: [resolvedEmbed(interaction, result.purchase ?? {}, `Already ${result.purchase?.status ?? "resolved"}.`)] });
    }
    return interaction.editReply({
      embeds: [resolvedEmbed(interaction, result.purchase, `✅ Approved by <@${interaction.user.id}>. Apply it in-game.`)],
      components: [],
    });
  } catch (err: any) {
    return interaction.followUp({ content: parseApiError(err), flags: MessageFlags.Ephemeral });
  }
}

async function handleDenyOpen(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only a commissioner can review purchases.", flags: MessageFlags.Ephemeral });
  }
  const purchaseId = interaction.customId.split(":").pop()!;
  const modal = new ModalBuilder().setCustomId(`${PURCHASE_CUSTOM_IDS.denyModalPrefix}:${purchaseId}`).setTitle("Deny Purchase");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("Reason (the buyer is refunded)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300)
    )
  );
  return interaction.showModal(modal);
}

async function handleDenyModal(interaction: ModalSubmitInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only a commissioner can review purchases.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.isFromMessage()) return interaction.reply({ content: "Could not process this review.", flags: MessageFlags.Ephemeral });
  const purchaseId = interaction.customId.split(":").pop()!;
  const reason = interaction.fields.getTextInputValue("reason").trim() || "Denied by commissioner review.";
  await interaction.deferUpdate();
  try {
    const result = await recApi.reviewPurchase({ purchaseId, action: "deny", reviewedByDiscordId: interaction.user.id, deniedReason: reason });
    if (!result.updated) {
      return interaction.editReply({ embeds: [resolvedEmbed(interaction, result.purchase ?? {}, `Already ${result.purchase?.status ?? "resolved"}.`)], components: [] });
    }
    return interaction.editReply({
      embeds: [resolvedEmbed(interaction, result.purchase, `❌ Denied by <@${interaction.user.id}> — $${result.refunded ?? 0} refunded.\nReason: ${reason}`)],
      components: [],
    });
  } catch (err: any) {
    return interaction.followUp({ content: parseApiError(err), flags: MessageFlags.Ephemeral });
  }
}

function resolvedEmbed(interaction: ButtonInteraction | ModalSubmitInteraction, purchase: any, footer: string) {
  const buyer = purchase?.discord_id ? `<@${purchase.discord_id}>` : "Unknown";
  const type = purchase?.purchase_type as RecPurchaseType;
  const d = purchase?.details ?? {};
  const lines = [
    `**Buyer:** ${buyer}`,
    `**Type:** ${REC_PURCHASE_TYPE_LABELS[type] ?? type ?? "Purchase"}`,
  ];
  if (d.playerName) lines.push(`**Player:** ${d.playerName}${d.position ? ` (${d.position})` : ""}`);
  lines.push(`**Cost:** $${purchase?.cost ?? 0}`, "", footer);
  return new EmbedBuilder().setTitle("Purchase Reviewed").setDescription(lines.join("\n"));
}

function parseApiError(err: any): string {
  const raw = String(err?.message ?? "Purchase failed. Please try again.");
  const match = raw.match(/\{.*"message"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? raw;
}
