import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { env } from "../config/env.js";
import { recApi } from "../lib/rec-api.js";

// Same pattern and reasoning as /highlights (see highlights-slash.ts) — checks the account is
// linked and site-registered, then hands off to the web hub's existing box-score upload flow
// rather than trying to attach anything here. Only ever registered as a visible command in
// guilds whose league is in box_scores data mode — see syncBoxScoreCommandForLeague
// (apps/api/src/modules/league-week/data-mode.service.ts), kept in sync whenever a league's
// data mode or Discord server link changes.
export async function handleBoxScoreSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const base = env.SITE_PUBLIC_URL.replace(/\/$/, "");

  let profile: any;
  try {
    profile = await recApi.getMenuProfile(interaction.user.id, interaction.guildId);
  } catch (error) {
    console.error(`Failed to resolve menu profile for /boxscore in guild ${interaction.guildId}:`, error);
    await interaction.editReply({ content: `Link your Discord account to REC first, then try again: ${base}/login` });
    return;
  }

  if (!profile?.user?.supabase_auth_user_id) {
    await interaction.editReply({ content: `You need a REC site account to upload box scores this way — sign up or link your account first: ${base}/login` });
    return;
  }
  if (!profile?.league?.id) {
    await interaction.editReply({ content: "This server isn't linked to a REC league right now." });
    return;
  }

  const url = `${base}/l/${profile.league.id}/buzz?openBoxScore=1`;
  const embed = new EmbedBuilder()
    .setTitle("Upload a Box Score")
    .setColor(0x1d9bf0)
    .setDescription(`[Open the box score uploader](${url})\n\nPick any eligible week — this week or a past one you haven't submitted for yet.`);
  await interaction.editReply({ embeds: [embed] });
}
