import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { formatCoins } from "@rec/shared";
import { recApi } from "../lib/rec-api.js";

// Read-only — no transfer/spend actions here, just a quick personal balance check. Reuses the
// same getMenuProfile data /matchup and /schedule already fetch (wallet_balance/savings_balance).
export async function handleWalletSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const profile = await recApi.getMenuProfile(interaction.user.id, interaction.guildId);
    const balance = Number(profile?.wallet?.wallet_balance ?? 0);
    const savings = Number(profile?.wallet?.savings_balance ?? 0);
    const embed = new EmbedBuilder()
      .setTitle("Your Wallet")
      .setColor(0xd9a521)
      .addFields(
        { name: "Balance", value: formatCoins(balance), inline: true },
        { name: "Savings", value: formatCoins(savings), inline: true },
      );
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to load your wallet." });
  }
}
