import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { recApi } from "../lib/rec-api.js";

// Simpler alternative to the site's popup+OAuth-token "Connect a Discord Server" flow: run once,
// inside the target server, by whoever has Manage Server permission there. Discord's own
// membership/permission check on this interaction IS the guild-ownership verification — no
// provider token, no cross-window postMessage, nothing that can silently fail on a "calling back
// after linking" step. Only ever claims a league the invoking Discord user's linked REC account
// actually owns and that has no Discord server yet (see linkUnclaimedLeagueByDiscord). If a
// league is later deleted, its server link goes with it, so this can be re-run to link a new
// league to the same server.
export async function handleLinkLeagueSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: "You need the Manage Server permission in this Discord server to link a league to it.", flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await recApi.linkLeagueServerByDiscord({
      discordId: interaction.user.id,
      guildId: interaction.guildId,
      serverName: interaction.guild.name,
    });
    if (!result.linked) {
      const names = result.leagues.map((league) => `• ${league.name}`).join("\n");
      await interaction.editReply({
        content: `You have more than one unclaimed league — link one from the site instead so you can pick which one:\n${names}`,
      });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle("League Linked")
      .setColor(0x16a34a)
      .setDescription(`**${result.leagueName}** is now linked to **${result.server.name}**. Head to League Mgmt > Settings to finish setting up channels and roles.`);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Failed to link a league to this server." });
  }
}
