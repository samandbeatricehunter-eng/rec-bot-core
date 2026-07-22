import { EmbedBuilder, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { formatCoins } from "@rec/shared";
import { recApi } from "../lib/rec-api.js";
import {
  buildManageWalletRows,
  buildWalletTransferAmountRows,
  buildWalletTransferDirectionRows,
  MANAGE_WALLET_CUSTOM_IDS
} from "../ui/menu.js";

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
  const type = String(transaction?.transaction_type ?? "transaction").replaceAll("_", " ");
  const reason = transaction?.description ?? transaction?.source ?? "No reason provided";
  return `**${formatCoins(amount, { signed: true })}** - ${type}\n${formatRecDateTime(transaction?.created_at)} - ${reason}`;
}

async function buildManageWalletPayload(userId: string, guildId: string | undefined) {
  const walletPayload = await recApi.getWallet(userId, guildId).catch(() => null);
  const wallet = walletPayload?.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const savings = Number(wallet.savings_balance ?? 0);
  const projectedInterest = Math.floor(savings * 0.035);
  const displayName = walletPayload?.discord?.global_name ?? walletPayload?.discord?.username ?? `<@${userId}>`;
  const embed = new EmbedBuilder()
    .setTitle("My Wallet")
    .setDescription([
      `**User:** ${displayName}`,
      `**Wallet:** ${formatCoins(wallet.wallet_balance)}`,
      `**Savings:** ${formatCoins(wallet.savings_balance)}`,
      `**Proj. Interest:** ${formatCoins(projectedInterest)}`,
      "",
      "**Transfer** - Move funds between your wallet and savings.",
      "**Transactions** - View your last 10 global transactions and your last 10 league transactions.",
      "",
      "Transfers update immediately after confirmation."
    ].join("\n").slice(0, 4096));
  return { embeds: [embed], components: buildManageWalletRows() };
}

export async function handleManageWallet(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Wallet...").setDescription("Fetching your wallet, savings, and recent balance data.")], components: [] });
  await interaction.editReply(await buildManageWalletPayload(interaction.user.id, interaction.guild?.id ?? undefined) as any);
}

export async function handleWalletTransferOpen(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  const walletPayload = await recApi.getWallet(interaction.user.id, interaction.guild?.id ?? undefined).catch(() => null);
  const wallet = walletPayload?.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Transfer").setDescription([
      `**Wallet:** ${formatCoins(wallet.wallet_balance)}`,
      `**Savings:** ${formatCoins(wallet.savings_balance)}`,
      "",
      "Select a transfer direction below."
    ].join("\n"))],
    components: buildWalletTransferDirectionRows()
  });
}

export async function handleWalletTransferDirection(interaction: StringSelectMenuInteraction) {
  const direction = interaction.values[0] === "from_savings" ? "from_savings" : "to_savings";
  const walletPayload = await recApi.getWallet(interaction.user.id, interaction.guild?.id ?? undefined).catch(() => null);
  const wallet = walletPayload?.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const available = direction === "to_savings" ? Number(wallet.wallet_balance ?? 0) : Number(wallet.savings_balance ?? 0);
  const label = direction === "to_savings" ? "Transfer To Savings" : "Transfer From Savings";
  return interaction.update({
    embeds: [new EmbedBuilder().setTitle(label).setDescription([
      `**Wallet:** ${formatCoins(wallet.wallet_balance)}`,
      `**Savings:** ${formatCoins(wallet.savings_balance)}`,
      `**Available:** ${formatCoins(available)}`,
      "",
      "Choose Transfer All or enter a custom amount."
    ].join("\n"))],
    components: buildWalletTransferAmountRows(direction)
  });
}

export async function handleWalletTransferAll(interaction: ButtonInteraction, direction: "to_savings" | "from_savings") {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Transferring Funds...").setDescription("Checking your available balance and applying the transfer.")], components: [] });
  const walletPayload = await recApi.getWallet(interaction.user.id, interaction.guild?.id ?? undefined).catch(() => null);
  const wallet = walletPayload?.wallet ?? { wallet_balance: 0, savings_balance: 0 };
  const amount = direction === "to_savings" ? Number(wallet.wallet_balance ?? 0) : Number(wallet.savings_balance ?? 0);
  if (amount <= 0) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Transfer").setDescription("There is no available balance to transfer.")],
      components: buildManageWalletRows()
    });
  }
  return completeSavingsTransfer(interaction, amount, direction);
}

export async function handleWalletCustomTransferModal(interaction: ModalSubmitInteraction, direction: "to_savings" | "from_savings") {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Transferring Funds...").setDescription("Validating the amount and applying the transfer.")], components: [] });
  const raw = interaction.fields.getTextInputValue(MANAGE_WALLET_CUSTOM_IDS.transferCustomAmountInput);
  const amount = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Invalid Amount").setDescription("Please enter a valid positive number.")],
      components: buildManageWalletRows()
    });
  }
  return completeSavingsTransfer(interaction, amount, direction);
}

async function completeSavingsTransfer(interaction: ButtonInteraction | ModalSubmitInteraction, amount: number, direction: "to_savings" | "from_savings") {
  try {
    const result = await recApi.transferSavings(interaction.user.id, amount, direction);
    const dirLabel = direction === "to_savings" ? "moved to savings" : "withdrawn from savings";
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Transfer Complete").setDescription([
        `**${formatCoins(amount)}** ${dirLabel}.`,
        "",
        `**Wallet:** ${formatCoins(result.wallet_balance)}`,
        `**Savings:** ${formatCoins(result.savings_balance)}`
      ].join("\n"))],
      components: buildManageWalletRows()
    });
  } catch (err: any) {
    const msg = err?.message ?? "Transfer failed. Please try again.";
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Transfer Failed").setDescription(msg)],
      components: buildManageWalletRows()
    });
  }
}

export async function handleWalletTransactions(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Transactions...").setDescription("Fetching your global and league transaction history.")], components: [] });
  const [globalPayload, leaguePayload] = await Promise.all([
    recApi.getWallet(interaction.user.id).catch(() => null),
    recApi.getWallet(interaction.user.id, interaction.guild?.id ?? undefined).catch(() => null)
  ]);
  const globalTransactions = Array.isArray(globalPayload?.transactions) ? globalPayload.transactions.slice(0, 10) : [];
  const leagueTransactions = Array.isArray(leaguePayload?.transactions) ? leaguePayload.transactions.slice(0, 10) : [];
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Transactions").setDescription([
      "**Global Transactions**",
      globalTransactions.length ? globalTransactions.map(formatTransactionLine).join("\n\n") : "No global transactions found.",
      "",
      "**League Transactions**",
      leagueTransactions.length ? leagueTransactions.map(formatTransactionLine).join("\n\n") : "No league transactions found."
    ].join("\n").slice(0, 4096))],
    components: buildManageWalletRows()
  });
}

export async function handleWalletPendingPurchases(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Pending Purchases").setDescription("You have no pending purchases or unapplied payouts.\n\n(Pending-purchase tracking arrives with the Manage My Franchise store.)")],
    components: buildManageWalletRows()
  });
}
