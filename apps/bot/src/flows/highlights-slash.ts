import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { env } from "../config/env.js";
import { recApi } from "../lib/rec-api.js";

// Discord's own per-guild upload cap (25MB on a non-boosted server) applies to ANY file a user
// sends through Discord's infrastructure -- including an attachment on a slash command, not just
// a channel-posted message. Attaching the clip here would hit the exact same limit that got the
// old in-Discord highlight posting removed in the first place. Instead this hands off to the
// site's highlight upload flow, which already uploads browser-directly to Cloudflare Stream and
// never routes the video through Discord at all -- see apps/api/src/modules/media/media.service.ts
// createHighlightDirectUpload. Eligible-week computation is left to that page itself (via
// LateSubmissionsModal), not duplicated here: the bot has no user site session to call the
// session-gated /v1/hub/highlights/my-week-counts endpoint with, only the menu-profile lookup
// (internal-API-key auth) used below to confirm the account is actually linked and site-registered.
export async function handleHighlightsSlash(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const base = env.SITE_PUBLIC_URL.replace(/\/$/, "");

  let profile: any;
  try {
    profile = await recApi.getMenuProfile(interaction.user.id, interaction.guildId);
  } catch (error) {
    console.error(`Failed to resolve menu profile for /highlights in guild ${interaction.guildId}:`, error);
    await interaction.editReply({
      content: `Link your Discord account to REC first, then try again: ${base}/login`,
    });
    return;
  }

  if (!profile?.user?.supabase_auth_user_id) {
    await interaction.editReply({
      content: `You need a REC site account to upload highlights this way — sign up or link your account first: ${base}/login`,
    });
    return;
  }

  if (!profile?.league?.id) {
    await interaction.editReply({ content: "This server isn't linked to a REC league right now." });
    return;
  }

  const url = `${base}/l/${profile.league.id}/buzz?openHighlights=1`;
  const embed = new EmbedBuilder()
    .setTitle("Upload a Highlight")
    .setColor(0x1d9bf0);

  // Best-effort — this snapshot just makes the embed richer (shows this week's matchup(s) and
  // upload count before the click-through); a failure here shouldn't block the fallback link.
  let snapshot: Awaited<ReturnType<typeof recApi.getHighlightUploadSnapshot>> | null = null;
  try {
    snapshot = await recApi.getHighlightUploadSnapshot({ guildId: interaction.guildId, discordId: interaction.user.id });
  } catch (error) {
    console.error(`Failed to load highlight upload snapshot for /highlights in guild ${interaction.guildId}:`, error);
  }

  const lines = [`[Open the highlight uploader](${url})`, ""];
  if (snapshot) {
    lines.push(`**Week ${snapshot.weekNumber}** — you've uploaded ${snapshot.uploadedThisWeek}/${snapshot.highlightLimit} this week.`);
    if (snapshot.games.length) {
      lines.push(...snapshot.games.map((g) => `• ${g.label}`));
    }
    lines.push("");
  }
  lines.push(
    "Pick any eligible week (this week or a past one you haven't already hit the upload cap on) — " +
      "the clip uploads straight to our storage from your browser, so Discord's file-size limit never " +
      "comes into play.",
  );
  embed.setDescription(lines.join("\n"));
  await interaction.editReply({ embeds: [embed] });
}
