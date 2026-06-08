import { ChannelType, EmbedBuilder, Interaction, TextChannel } from "discord.js";
import { recApi } from "../lib/rec-api.js";
import { buildGotwAnnouncementContent, buildGotwSelectionPayload, buildGotwVoteEmbed, buildGotwVoteRows, GOTW_CUSTOM_IDS } from "../ui/gotw.js";

export async function renderGotwSelection(interaction: Extract<Interaction, { inCachedGuild(): boolean; deferReply: any; editReply: any }>) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ ephemeral: true });
  const result = await recApi.getGotwCandidates(interaction.guildId);
  const stage = result.stage ?? result.league?.season_stage ?? "regular_season";
  if (stage !== "regular_season") {
    await interaction.editReply("GOTW selection is only required during the regular season. Playoff and Super Bowl games are automatically treated as GOTW.");
    return;
  }
  if (!result.candidates?.length) {
    await interaction.editReply("No User H2H matchups were found for the upcoming week, so there is no GOTW selection available.");
    return;
  }
  await interaction.editReply(buildGotwSelectionPayload(result.candidates));
}

export async function handleGotwSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const result = await recApi.selectGotwCandidate({ guildId: interaction.guildId, candidateId: interaction.values[0], selectedByDiscordId: interaction.user.id });
  const channelId = result.channelId;
  if (!channelId) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("GOTW Selected").setDescription("GOTW was selected, but no league announcements channel is configured, so the vote poll was not posted.")],
      components: []
    });
    return;
  }
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("GOTW Selected").setDescription("GOTW was selected, but the configured announcements channel could not be accessed.")],
      components: []
    });
    return;
  }
  const poll = result.poll;
  const sent = await (channel as TextChannel).send({ content: buildGotwAnnouncementContent(poll), embeds: [buildGotwVoteEmbed(poll, [])], components: buildGotwVoteRows(poll), allowedMentions: { parse: ["everyone"], users: [poll.away_user_id, poll.home_user_id].filter(Boolean) } });
  await recApi.recordGotwPollMessage({ pollId: poll.id, discordChannelId: channel.id, discordMessageId: sent.id });
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("GOTW Selected").setDescription(`Selected **${result.candidate.matchup_title}** and posted the vote poll in <#${channel.id}>.`)],
    components: []
  });
}

export async function handleGotwVote(interaction: Extract<Interaction, { isButton(): boolean }>) {
  if (!interaction.isButton()) return;
  const isAway = interaction.customId.startsWith(GOTW_CUSTOM_IDS.voteAwayPrefix);
  const prefix = isAway ? GOTW_CUSTOM_IDS.voteAwayPrefix : GOTW_CUSTOM_IDS.voteHomePrefix;
  const [pollId, selectedTeamId] = interaction.customId.slice(prefix.length).split(":");
  await interaction.deferReply({ ephemeral: true });
  const result = await recApi.recordGotwVote({ pollId, selectedTeamId, discordId: interaction.user.id });
  if (!result.recorded) {
    await interaction.editReply(result.reason ?? "Vote could not be recorded.");
    return;
  }
  const votes = result.votes?.votes ?? result.votes ?? [];
  await interaction.message.edit({ content: buildGotwAnnouncementContent(result.poll), embeds: [buildGotwVoteEmbed(result.poll, votes)], components: buildGotwVoteRows(result.poll), allowedMentions: { parse: [], users: [] } }).catch(() => undefined);
  await interaction.editReply(`Your vote for **${result.vote.selected_team_name}** was recorded. You can switch your vote until the poll closes.`);
}
