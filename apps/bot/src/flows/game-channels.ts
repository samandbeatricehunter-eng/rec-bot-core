import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder, Guild, TextChannel } from "discord.js";
import { recApi } from "../lib/rec-api.js";

function splitText(text: string, max = 3600) {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf("\n", max) > 0 ? rest.lastIndexOf("\n", max) : max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function advanceLines(times: any[]) {
  return times?.length ? times.map((time) => `${time.label}: ${time.value}`).join("\n") : "Next advance time has not been set.";
}

function buildGameEmbeds(plan: any) {
  const base = [
    `<@${plan.awayUserId}> vs <@${plan.homeUserId}>`,
    "",
    "You have a User H2H matchup this week.",
    "",
    "Next Advance:",
    advanceLines(plan.nextAdvanceTimes),
    "",
    `Streaming Required: ${plan.streamingRequired ? "Yes" : "No"}`,
    `Requirement: ${plan.streamingRequirement ?? "Based on league settings"}`,
    "",
    "League Game Rules:",
    `• Fourth Down Rules: ${plan.fourthDownRules ?? "Use league settings."}`,
    `• Scheduling, Activity & Sportsmanship: ${plan.schedulingRules ?? "Scheduling, Activity & Sportsmanship rules apply."}`,
    "",
    "Reach out to your opponent in this channel to coordinate your game."
  ].join("\n");
  return splitText(base).map((description, index) => new EmbedBuilder().setTitle(index === 0 ? `${plan.awayTeamName} vs ${plan.homeTeamName}` : "League Game Rules Continued").setDescription(description));
}

export async function recreateGameChannelsForGuild(guild: Guild) {
  const active = await recApi.getActiveGameChannels(guild.id);
  for (const tracked of active.channels ?? []) {
    const channel = await guild.channels.fetch(tracked.discord_channel_id).catch(() => null);
    if (channel && "delete" in channel) await channel.delete("REC weekly advance cleanup").catch(() => undefined);
    await recApi.markGameChannelDeleted(tracked.discord_channel_id).catch(() => undefined);
  }

  const result = await recApi.getGameChannelPlans(guild.id);
  const categoryId = result.routes?.game_channels_category_id ?? result.plans?.[0]?.categoryId;
  const created: any[] = [];
  for (const plan of result.plans ?? []) {
    if (!categoryId) continue;
    const channel = await guild.channels.create({ name: plan.channelName, type: ChannelType.GuildText, parent: categoryId, reason: "REC weekly H2H matchup channel" });
    if (channel instanceof TextChannel) {
      await channel.send({ embeds: buildGameEmbeds(plan) });
      await recApi.recordGameChannel({ ...plan, discordChannelId: channel.id });
      created.push({ plan, channelId: channel.id });
    }
  }
  return { created };
}

export async function sendAdvanceDmsForGuild(guild: Guild) {
  const result = await recApi.postAdvanceAutomation(guild.id);
  const payloads = result.dmPayloads?.payloads ?? [];
  let sent = 0;
  let failed = 0;
  for (const payload of payloads) {
    if (!payload.discordId) continue;
    const user = await guild.client.users.fetch(payload.discordId).catch(() => null);
    if (!user) { failed++; continue; }
    const lines = [
      "REC League Advanced",
      "",
      `League: ${payload.leagueName}`,
      `Server Name: ${payload.serverName ?? guild.name}`,
      `Season: ${payload.seasonNumber}`,
      `Current Week: ${payload.weekNumber}`,
      `Stage: ${String(payload.seasonStage ?? "").replaceAll("_", " ")}`,
      "",
      "Next Advance:",
      advanceLines(payload.nextAdvanceTimes),
      "",
      "This Week’s Matchup:",
      `Opponent: ${payload.matchup?.opponent ?? "TBD"}`,
      `Location: ${payload.matchup?.location ?? "TBD"}`,
      `Game Type: ${payload.matchup?.gameType ?? "TBD"}`,
      payload.matchup?.gameChannelId ? `Game Channel: <#${payload.matchup.gameChannelId}>` : undefined,
      "",
      `Streaming Required: ${payload.streaming?.required ? "Yes" : "No"}`,
      `Requirement: ${payload.streaming?.requirement ?? "Based on league settings"}`,
      "",
      "Weekly Challenges:",
      ...(payload.challenges?.length ? payload.challenges.flatMap((challenge: any) => [
        `${challenge.challenge_side === "offense" ? "Offensive" : "Defensive"} Challenge:`,
        `S Tier: ${challenge.s_tier_goal} — $50`,
        `A Tier: ${challenge.a_tier_goal} — $25`,
        `B Tier: ${challenge.b_tier_goal} — $10`
      ]) : ["No weekly challenges assigned."]),
      "",
      "POTW Awards:",
      ...(payload.potwAwards?.length ? payload.potwAwards.map((award: any) => `• ${award.label}: ${award.playerName} +$${award.amount}`) : ["No POTW award this advance."]),
      "",
      "Payouts:",
      ...(payload.payouts?.length ? payload.payouts.map((payout: any) => `• ${payout.label}: +$${payout.amount}`) : ["No automatic payouts recorded in this summary."]),
      "",
      payload.gotw?.isParticipant ? "Your game is the H2H Game of the Week." : payload.gotw?.message
    ].filter(Boolean).join("\n");
    try { await user.send(lines); sent++; } catch { failed++; }
  }
  await recreateGameChannelsForGuild(guild);
  return { sent, failed };
}

export async function recordGameChannelMessage(message: any) {
  if (!message.guildId || message.author?.bot) return;
  await recApi.recordGameChannelCheckin({ discordChannelId: message.channelId, discordUserId: message.author.id }).catch(() => undefined);
  const streamResult = await recApi.recordStreamPost({
    guildId: message.guildId,
    discordId: message.author.id,
    discordChannelId: message.channelId,
    discordMessageId: message.id,
    messageUrl: message.url ?? null,
    content: message.content ?? null
  }).catch(() => null);
  if (streamResult?.invalidStreamPost || streamResult?.shouldDelete) {
    await message.delete().catch(() => undefined);
    await message.author.send("Your message was removed from the streams channel. That channel is only for posting streaming links, or if you are streaming live on Discord, post a message advising that your stream is on Discord. Example: Away vs Home LIVE on discord.").catch(() => undefined);
    return;
  }

  if (streamResult?.needsReview && streamResult.pendingEconomyChannelId) {
    const channel = await message.guild.channels.fetch(streamResult.pendingEconomyChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle("Pending Stream Payout Review")
          .setDescription([
            `User: <@${message.author.id}>`,
            `Week: ${streamResult.log?.week_number ?? "?"}`,
            `Reason: User mentioned Discord as their stream source but no supported stream link was detected.`,
            `Original Message: ${message.url ?? "Unavailable"}`
          ].join("\n"))],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`rec:stream_review:approve:${streamResult.review?.id}`).setLabel("Approve Stream Payout").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`rec:stream_review:deny:${streamResult.review?.id}`).setLabel("Deny Stream Payout").setStyle(ButtonStyle.Danger)
        )]
      }).catch(() => undefined);
    }
  }
}

export function startGameChannelReminderLoop(client: Client) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const state = await recApi.getReminderState(guild.id).catch(() => null);
      if (!state) continue;
      const checkinsByChannel = new Map<string, Set<string>>();
      for (const checkin of state.checkins ?? []) {
        const set = checkinsByChannel.get(checkin.game_channel_id) ?? new Set<string>();
        if (checkin.user_id) set.add(checkin.user_id);
        checkinsByChannel.set(checkin.game_channel_id, set);
      }
      const reminderKeys = new Set((state.reminders ?? []).map((r: any) => `${r.game_channel_id}:${r.reminder_type}:${r.target_user_id ?? "all"}`));
      for (const channelRecord of state.channels ?? []) {
        const ageMs = Date.now() - new Date(channelRecord.created_at).getTime();
        const channel = await guild.channels.fetch(channelRecord.discord_channel_id).catch(() => null) as TextChannel | null;
        if (!channel?.isTextBased()) continue;
        const posted = checkinsByChannel.get(channelRecord.id) ?? new Set<string>();
        const users = [channelRecord.away_user_id, channelRecord.home_user_id].filter(Boolean);
        for (const [hours, type] of [[4, "four_hour"], [8, "eight_hour"]] as const) {
          if (ageMs < hours * 60 * 60 * 1000) continue;
          for (const userId of users) {
            const key = `${channelRecord.id}:${type}:${userId}`;
            if (posted.has(userId) || reminderKeys.has(key)) continue;
            await channel.send(`<@${userId}>, reach out to your opponent. You've got a game this week.`).catch(() => undefined);
            await recApi.recordGameChannelReminder({ gameChannelId: channelRecord.id, reminderType: type, targetUserId: userId, details: { channelId: channel.id } }).catch(() => undefined);
          }
        }
        if (ageMs >= 12 * 60 * 60 * 1000 && !reminderKeys.has(`${channelRecord.id}:twelve_hour:all`)) {
          const missing = users.filter((userId) => !posted.has(userId));
          const roleText = [channelRecord.commissioner_role_id ? `<@&${channelRecord.commissioner_role_id}>` : null, channelRecord.comp_committee_role_id ? `<@&${channelRecord.comp_committee_role_id}>` : null].filter(Boolean).join(" ") || "Commissioner/Comp Committee";
          if (missing.length === 2) await channel.send(`${roleText}: Neither user has checked in within 12 hours. This may be a Fair Sim.`).catch(() => undefined);
          else if (missing.length === 1) await channel.send(`${roleText}: <@${missing[0]}> has not checked in within 12 hours. This may be a Force Win.`).catch(() => undefined);
          await recApi.recordGameChannelReminder({ gameChannelId: channelRecord.id, reminderType: "twelve_hour", targetUserId: null, details: { missing, missingUserIds: missing } }).catch(() => undefined);
        }
      }
    }
  }, 15 * 60 * 1000).unref();
}
