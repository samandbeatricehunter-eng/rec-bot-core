import { ChannelType, EmbedBuilder, MessageFlags, type ActionRowBuilder, type ButtonBuilder, type ButtonInteraction } from "discord.js";
import { isRegularSeasonWeek, stageLabel } from "@rec/shared";
import { isFullLeagueAdminInteraction, replyFullAdminOnly } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { getAnnouncementsChannel, getRouteChannels, getVotingPollsChannel } from "../lib/route-channels.js";
import { buildGameChannelNavRow, buildGameChannelPage, gameRulesLines } from "./game-channel-pages.js";
import { currentSchedule, postGotwPollForGame, teamDisplay, teamNick } from "./gotw.js";

export async function handleGameChannels(interaction: ButtonInteraction, buildAdvanceRows: () => ActionRowBuilder<ButtonBuilder>[]) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  if (!isFullLeagueAdminInteraction(interaction)) return replyFullAdminOnly(interaction, "create game channels");
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Creating Game Channels...").setDescription("Checking the active week's logged schedule for H2H matchups where both teams have linked Discord users.")], components: [] });
  const routes = await getRouteChannels(interaction.guildId);
  const categoryId = routes?.game_channels_category_id;
  const category = categoryId ? await interaction.guild.channels.fetch(categoryId).catch(() => null) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Game Channels").setDescription("No game channels category is configured.")], components: buildAdvanceRows() });
  }

  await interaction.guild.channels.fetch();
  const tracked = await recApi.listTrackedGameChannels(interaction.guildId).catch(() => ({ discordChannelIds: [] as string[] }));
  const trackedIds = new Set(tracked.discordChannelIds ?? []);
  let deletedCount = 0;
  const deletedDiscordIds: string[] = [];
  for (const channelId of trackedIds) {
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) continue;
    if (channel.parentId !== category.id) continue;
    const deleted = await channel.delete("Replacing tracked REC game channels for the current week schedule.").then(() => true).catch(() => false);
    if (deleted) {
      deletedCount += 1;
      deletedDiscordIds.push(channelId);
    }
  }
  if (deletedDiscordIds.length) {
    await recApi.markGameChannelsDeleted(deletedDiscordIds).catch(() => undefined);
  }

  const { seasonNumber, currentWeek, stage, game: leagueGame, games } = await currentSchedule(interaction);
  const h2h = games.filter((g: any) => g.away_discord_id && g.home_discord_id);
  if (!h2h.length) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("Game Channels")
        .setDescription([
          deletedCount > 0 ? `Removed ${deletedCount} previous game channel${deletedCount === 1 ? "" : "s"}.` : null,
          `No H2H matchups are available for **${stageLabel(stage, currentWeek, leagueGame)}**.`,
          "",
          "Game channels are created only from the logged weekly schedule, and only when both scheduled teams have linked Discord users.",
          "If this is unexpected, check League Mgmt > Schedule and League Mgmt > Teams."
        ].filter(Boolean).join("\n"))],
      components: buildAdvanceRows()
    });
  }
  const created: string[] = [];
  const registrationFailures: string[] = [];
  const config = await recApi.getLeagueConfig(interaction.guildId).catch(() => null);
  const isPlayoff = !isRegularSeasonWeek(currentWeek, leagueGame);
  const rulesLines = gameRulesLines(config?.draft ?? null, isPlayoff);
  const boxScoresMention = routes?.box_scores_channel_id ? `<#${routes.box_scores_channel_id}>` : "the box scores channel";
  // Create + register every channel first, then fetch all matchups in ONE batched
  // call (the league-wide identity/power-ranking/config work is computed once for
  // the whole week instead of once per channel), then post the intro messages.
  const pending: Array<{ ch: any; game: any; away: string; home: string }> = [];
  for (const game of h2h) {
    const away = teamDisplay(game.away_team);
    const home = teamDisplay(game.home_team);
    // Channel title is team nicknames only (no city), e.g. "frost-bite-vs-cowboys".
    const name = `${teamNick(game.away_team)} vs ${teamNick(game.home_team)}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
    const ch = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
    }).catch((err) => { console.error("[ERROR] Failed to create game channel:", err?.message ?? err); return null; });
    if (!ch?.isTextBased()) continue;
    // Sync the channel's permissions to its parent category rather than scoping
    // it to just the two matchup users.
    await ch.lockPermissions().catch((err) => console.error("[ERROR] Failed to sync game channel permissions:", err?.message ?? err));
    created.push(`<#${ch.id}>`);
    await recApi.registerGameChannel({
      guildId: interaction.guildId,
      gameId: game.id ?? null,
      discordChannelId: ch.id,
      seasonNumber,
      weekNumber: currentWeek,
      awayTeamId: game.away_team_id ?? game.away_team?.id ?? null,
      homeTeamId: game.home_team_id ?? game.home_team?.id ?? null,
      awayUserId: game.away_user_id ?? null,
      homeUserId: game.home_user_id ?? null,
    }).catch((err) => {
      console.error("[ERROR] Failed to register game channel in database:", err?.message ?? err);
      registrationFailures.push(`<#${ch.id}>`);
    });
    pending.push({ ch, game, away, home });
  }

  // One batched fetch for all matchups, keyed by channel id. Page-flip buttons
  // later re-fetch a single channel on demand via getGameChannelMatchup.
  const matchupMap = await recApi
    .getGameChannelMatchups({ guildId: interaction.guildId })
    .then((r) => r?.matchups ?? {})
    .catch((err) => { console.error("[ERROR] Failed to load game channel matchups:", err?.message ?? err); return {} as Record<string, any>; });

  for (const { ch, game, away, home } of pending) {
    const matchup = matchupMap[ch.id] ?? null;
    const fallbackEmbed = new EmbedBuilder().setTitle("Game Channel").setDescription([
      "Play your game here and coordinate respectfully.",
      "",
      ...rulesLines,
      "",
      `After the game, post your box score screenshot in ${boxScoresMention} — not in this channel.`,
      "Failure to post your box score image WILL result in no payouts and no stat accumulation for awards and EOS payouts."
    ].join("\n"));
    await ch.send({
      content: `${game.away_discord_id ? `<@${game.away_discord_id}>` : away} VS ${game.home_discord_id ? `<@${game.home_discord_id}>` : home}`,
      embeds: [matchup ? buildGameChannelPage(matchup, 0) : fallbackEmbed],
      components: matchup ? [buildGameChannelNavRow(0)] : []
    }).catch(() => undefined);
  }
  if (created.length) {
    const announcements = await getAnnouncementsChannel(interaction.guild, routes);
    if (announcements?.isTextBased() && "send" in announcements) {
      const boxScores = routes?.box_scores_channel_id ? `<#${routes.box_scores_channel_id}>` : "the Box Scores channel";
      await announcements.send({
        content: "@everyone",
        embeds: [new EmbedBuilder().setTitle("Weekly Box Scores Required").setDescription([
          `Game channels have been created for ${stageLabel(stage, currentWeek, leagueGame)}.`,
          "",
          `Even if you do not have an H2H matchup this week, upload a box score screenshot to ${boxScores} before the league advances if you want payouts and stats logged.`,
          "Retroactive box scores will not be accepted. Fair Sims and Force Wins receive no payout.",
          "If your opponent cannot make it, request a 1-week autopilot to get your stats and payout IF you play and submit the box score."
        ].join("\n"))],
        allowedMentions: { parse: ["everyone"] }
      }).catch(() => undefined);
    }
  }

  // Postseason: every playoff matchup is a Game of the Week, so auto-post a GOTW
  // poll per H2H game to the voting-polls channel. Idempotent — skips games that
  // already have an open poll, so re-running Game Channels won't double-post.
  let gotwPostedCount = 0;
  if (isPlayoff && h2h.length) {
    const votingChannel = await getVotingPollsChannel(interaction.guild, routes);
    if (votingChannel) {
      const existing = await recApi.getActiveGotwPolls({ guildId: interaction.guildId, weekNumber: currentWeek }).then((r) => r?.polls ?? []).catch(() => []);
      const polledGameIds = new Set((existing as any[]).map((p) => p.game_id).filter(Boolean));
      for (const game of h2h) {
        if (!game.id || polledGameIds.has(game.id)) continue;
        const posted = await postGotwPollForGame({ guildId: interaction.guildId, channel: votingChannel, game, weekNumber: currentWeek });
        if (posted) gotwPostedCount += 1;
      }
    }
  }

  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Game Channels").setDescription([
      deletedCount > 0 ? `Removed ${deletedCount} previous game channel${deletedCount === 1 ? "" : "s"}.` : "No previous game channels were found in the category.",
      created.length ? `Created:\n${created.join("\n")}` : "No H2H game channels were created.",
      registrationFailures.length ? `⚠️ Failed to save the DB record for: ${registrationFailures.join(", ")}. Box score/advance lookups for ${registrationFailures.length === 1 ? "this channel" : "these channels"} may not work until a commissioner re-links ${registrationFailures.length === 1 ? "it" : "them"}.` : null,
      isPlayoff ? (gotwPostedCount > 0 ? `Posted ${gotwPostedCount} playoff GOTW poll${gotwPostedCount === 1 ? "" : "s"} to the voting polls channel.` : "No new playoff GOTW polls were posted (already posted, or no voting polls channel).") : null
    ].filter(Boolean).join("\n\n"))],
    components: buildAdvanceRows()
  });
}
