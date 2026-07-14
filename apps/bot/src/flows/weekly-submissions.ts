import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Guild, MessageFlags } from "discord.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { COLORS } from "../lib/colors.js";
import { recApi } from "../lib/rec-api.js";
import { getWeeklySubmissionsChannel, purgeChannelMessages } from "../lib/route-channels.js";

export const WEEKLY_SUBMISSIONS_CUSTOM_IDS = {
  boxScores: "rec:weekly_submissions:box_scores",
  playerStats: "rec:weekly_submissions:player_stats",
  recruiting: "rec:weekly_submissions:recruiting",
} as const;

const PLAYABLE_STAGES = new Set(["regular_season", "wild_card", "divisional", "conference_championship", "super_bowl", "cfp_first_round", "cfp_quarterfinals", "cfp_semifinals", "national_championship"]);

export async function publishWeeklySubmissionsPanel(guild: Guild) {
  const cfg = await recApi.getEconomyConfig(guild.id);
  const league = cfg.league ?? {};
  if (!PLAYABLE_STAGES.has(league.season_stage)) return { posted: false, reason: "not_playable" };
  const channel = await getWeeklySubmissionsChannel(guild, cfg.routes ?? {});
  if (!channel) return { posted: false, reason: "not_configured" };
  await purgeChannelMessages(channel);
  const stage = String(league.season_stage).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const week = league.current_week != null ? `Week ${league.current_week}` : stage;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.boxScores).setLabel("Box Scores").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.playerStats).setLabel("Player Stats").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(WEEKLY_SUBMISSIONS_CUSTOM_IDS.recruiting).setLabel("Recruiting Commits").setStyle(ButtonStyle.Success),
  );
  await channel.send({ embeds: [new EmbedBuilder().setTitle("REC Weekly Submissions").setColor(COLORS.gold).setDescription(`Season ${league.season_number ?? 1} • ${week}\n\nUse the buttons below. Submission messages are captured and removed so this panel stays in focus.`)], components: [row] });
  return { posted: true, channelId: channel.id };
}

function examplePath(name: string) {
  const candidates = [resolve(process.cwd(), "apps/bot/assets", name), resolve(process.cwd(), "apps/web/src/assets", name), resolve(process.cwd(), "assets", name)];
  return candidates.find(existsSync) ?? null;
}

export async function handleWeeklyBoxScores(interaction: ButtonInteraction) {
  const cfg = await recApi.getEconomyConfig(interaction.guildId!);
  const eligibility = await recApi.getBoxScoreUploadEligibility({ guildId: interaction.guildId!, discordId: interaction.user.id });
  if (!eligibility.hasScheduledGame) return interaction.reply({ content: `You do not have a scheduled game for Week ${eligibility.weekNumber}.`, flags: MessageFlags.Ephemeral });
  if (eligibility.existingSubmission) return interaction.reply({ content: eligibility.existingSubmission.submittedByDiscordId === interaction.user.id ? "Your game's box score is already pending or approved. A late second image can still be added while it is pending." : "Your opponent already submitted the shared H2H box score. Another submission is unnecessary, but you can still submit player stats for your team.", flags: MessageFlags.Ephemeral });
  const cfb = cfg.league?.game === "cfb_27";
  const description = cfb
    ? "Upload **two console screenshots** in this channel. Go to **CFB Tab > Team Schedule > Box Score** and press **X on PS5**.\n\n**Do NOT use the postgame box-score window shown immediately after the game. Do not use phone-camera photos.**"
    : "Upload **two in-game console screenshots** from the Madden box-score screens available when the game ends. Do not use phone-camera photos.";
  const files = cfb ? ["CFB Box Score Example 1.jpg", "CFB Box Score Example 2.jpg"].map(examplePath).filter((p): p is string => Boolean(p)).map((p) => new AttachmentBuilder(p)) : [];
  await interaction.reply({ embeds: [new EmbedBuilder().setTitle("Submit Box Scores").setColor(COLORS.gold).setDescription(description)], files, flags: MessageFlags.Ephemeral });
}

export async function handleWeeklyPlayerStats(interaction: ButtonInteraction) {
  const eligibility = await recApi.getBoxScoreUploadEligibility({ guildId: interaction.guildId!, discordId: interaction.user.id });
  if (!eligibility.hasScheduledGame) return interaction.reply({ content: "You do not have a current scheduled game (or this is a bye week).", flags: MessageFlags.Ephemeral });
  if (!eligibility.existingSubmission) return interaction.reply({ content: "Submit the game's box score first. A pending or approved submission from either H2H coach qualifies.", flags: MessageFlags.Ephemeral });
  return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Player Stats").setColor(COLORS.gold).setDescription("Player stats are optional details used for richer headlines, recaps, articles, and REC Network roundtables. Type the player's first and last name in this channel. Returning players will appear in future player selections; new players are added to your team's Players to Watch list. You can attach multiple stat categories to the same player.")], flags: MessageFlags.Ephemeral });
}

export async function handleWeeklyRecruiting(interaction: ButtonInteraction) {
  const cfg = await recApi.getEconomyConfig(interaction.guildId!);
  if (cfg.league?.game !== "cfb_27") return interaction.reply({ content: "Recruiting commits are available only in College Football leagues.", flags: MessageFlags.Ephemeral });
  return interaction.reply({ embeds: [new EmbedBuilder().setTitle("Recruiting Commits").setColor(COLORS.gold).setDescription("Type the recruit's first and last name in this channel. The bot will remove the captured message, then ask for position, star rating, city, state, and final confirmation. The commitment is associated with your linked university and does not require a box score.")], flags: MessageFlags.Ephemeral });
}
