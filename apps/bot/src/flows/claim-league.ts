import { ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { recApi } from "../lib/rec-api.js";

// Closes the loop the site's "Enable Discord bot" flow starts: it issues an invite token and
// a generic "Add to Discord" OAuth link, but has no way to know which server the bot ends up
// in. Running this command in that server (after inviting the bot) submits the token so the
// API can create the rec_discord_servers/rec_server_league_links rows (claimBotInvite already
// does this — this command is the missing caller).
export async function handleClaimLeagueSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Run this in a Discord server, not a DM.", flags: MessageFlags.Ephemeral });
    return;
  }
  const ownerId = interaction.guild?.ownerId ?? (await interaction.guild?.fetchOwner())?.id;
  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({ content: "Only the Discord server owner can run /claim-league.", flags: MessageFlags.Ephemeral });
    return;
  }
  const token = interaction.options.getString("token", true).trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await recApi.claimLeagueInvite({
      token,
      guildId: interaction.guildId,
      serverName: interaction.guild?.name,
      requestedByDiscordId: interaction.user.id,
    });
    await interaction.editReply(`League linked! **${result.league?.name ?? "Your league"}** is now connected to this server.`);
  } catch (error) {
    await interaction.editReply(error instanceof Error ? error.message : "Failed to claim this server for a league.");
  }
}
