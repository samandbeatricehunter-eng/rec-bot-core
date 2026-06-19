import { EmbedBuilder, MessageFlags, type ButtonInteraction, type Interaction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import {
  buildFromSavingsModal,
  buildManageWalletRows,
  buildRecBankRows,
  buildToSavingsModal,
  MANAGE_WALLET_CUSTOM_IDS,
  REC_BANK_CUSTOM_IDS
} from "../ui/menu.js";

type MainMenuPayloadBuilder = (userId: string, guildId: string | null, isAdmin: boolean) => Promise<unknown>;

function formatRecDateTime(value?: string | null) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }) + " CST";
}

function formatTransactionLine(transaction: any) {
  const amount = Number(transaction?.amount ?? 0);
  const sign = amount > 0 ? "+" : "";
  const type = String(transaction?.transaction_type ?? "transaction").replaceAll("_", " ");
  const reason = transaction?.description ?? transaction?.source ?? "No reason provided";
  return `**${sign}$${amount}** - ${type}\n${formatRecDateTime(transaction?.created_at)} - ${reason}`;
}

async function buildRecBankPayload(discordUserId: string, guildId: string | undefined) {
  const walletPayload = await recApi.getWallet(discordUserId, guildId);
  const wallet = walletPayload?.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const transactions = Array.isArray(walletPayload?.transactions) ? walletPayload.transactions : [];
  const countLabel = guildId ? "Last 10 Transactions (This League)" : "Last 25 Transactions (All Leagues)";
  const transactionText = transactions.length
    ? transactions.map(formatTransactionLine).join("\n\n")
    : "No wallet transactions found.";

  const embed = new EmbedBuilder()
    .setTitle("REC Bank")
    .setDescription([
      `Wallet Balance: **$${wallet.wallet_balance ?? 0}**`,
      `Savings Balance: **$${wallet.savings_balance ?? 0}**`,
      "",
      `**${countLabel}**`,
      transactionText
    ].join("\n").slice(0, 4096));

  return { embeds: [embed], components: buildRecBankRows() };
}

export async function handleRecBankSelect(
  interaction: StringSelectMenuInteraction,
  buildMainMenuPayload: MainMenuPayloadBuilder
) {
  const selected = interaction.values[0];

  if (selected === "bank_back") {
    return interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)) as any);
  }
  if (selected === "to_savings") return interaction.showModal(buildToSavingsModal());
  if (selected === "from_savings") return interaction.showModal(buildFromSavingsModal());
}

export async function handleSavingsTransferModal(interaction: ModalSubmitInteraction, direction: "to_savings" | "from_savings") {
  await interaction.deferUpdate();
  const inputId = direction === "to_savings" ? REC_BANK_CUSTOM_IDS.toSavingsAmountInput : REC_BANK_CUSTOM_IDS.fromSavingsAmountInput;
  const raw = interaction.fields.getTextInputValue(inputId);
  const amount = parseFloat(raw.replace(/[^0-9.]/g, ""));

  if (!Number.isFinite(amount) || amount <= 0) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Invalid Amount").setDescription("Please enter a valid positive number (e.g. 50).")],
      components: buildRecBankRows()
    });
  }

  try {
    const result = await recApi.transferSavings(interaction.user.id, amount, direction);
    const dirLabel = direction === "to_savings" ? "moved to savings" : "withdrawn from savings";
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Transfer Complete").setDescription([
        `**$${amount}** ${dirLabel}.`,
        "",
        `Wallet Balance: **$${result.wallet_balance ?? 0}**`,
        `Savings Balance: **$${result.savings_balance ?? 0}**`
      ].join("\n"))],
      components: buildRecBankRows()
    });
  } catch (err: any) {
    const msg = err?.message ?? "Transfer failed. Please try again.";
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Transfer Failed").setDescription(msg)],
      components: buildRecBankRows()
    });
  }
}

export async function handleTransferFunds(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild?.id ?? undefined;
  await interaction.editReply(await buildRecBankPayload(interaction.user.id, guildId) as any);
}

export async function handlePlaceWager(interaction: ButtonInteraction) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setTitle("Wager").setDescription("The wager workflow is coming soon. You'll be able to wager coins on upcoming matchups here.")],
    flags: MessageFlags.Ephemeral
  });
}

async function buildManageWalletPayload(userId: string, guildId: string | undefined) {
  const walletPayload = await recApi.getWallet(userId, guildId).catch(() => null);
  const wallet = walletPayload?.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const transactions = Array.isArray(walletPayload?.transactions) ? walletPayload.transactions : [];
  const txText = transactions.length ? transactions.slice(0, 10).map(formatTransactionLine).join("\n\n") : "No wallet transactions found.";
  const embed = new EmbedBuilder()
    .setTitle("Manage My Wallet")
    .setDescription([
      `Wallet Balance: **$${wallet.wallet_balance ?? 0}**`,
      `Savings Balance: **$${wallet.savings_balance ?? 0}**`,
      "",
      "**Last 10 Transactions**",
      txText
    ].join("\n").slice(0, 4096));
  return { embeds: [embed], components: buildManageWalletRows() };
}

export async function handleManageWallet(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(await buildManageWalletPayload(interaction.user.id, interaction.guild?.id ?? undefined) as any);
}

export async function handleWalletPendingPurchases(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Pending Purchases").setDescription("You have no pending purchases or unapplied payouts.\n\n(Pending-purchase tracking arrives with the Manage My Franchise store.)")],
    components: buildManageWalletRows()
  });
}

export async function handleWalletMakePurchase(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Make a Purchase").setDescription("The store will live in **Manage My Franchise** (coming soon). You'll be able to buy upgrades and management tools there.")],
    components: buildManageWalletRows()
  });
}

export function isWalletModal(interaction: Interaction) {
  return interaction.isModalSubmit()
    && (interaction.customId === REC_BANK_CUSTOM_IDS.toSavingsModal || interaction.customId === REC_BANK_CUSTOM_IDS.fromSavingsModal);
}

export { MANAGE_WALLET_CUSTOM_IDS, REC_BANK_CUSTOM_IDS };
