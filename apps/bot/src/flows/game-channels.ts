import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder, Guild, PermissionFlagsBits, TextChannel } from "discord.js";
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

// Mention the user by Discord ID; fall back to the team nickname if we can't resolve one
// (the raw user_id is an internal UUID and renders as jumbled text if used as a mention).
function userMention(discordId: string | null | undefined, fallbackName: string) {
  return discordId ? `<@${discordId}>` : fallbackName;
}

function buildActivityRulesLines(plan: any): string[] {
  const lines: string[] = [];
  if (plan.fairSimRequirements) lines.push(`Fair Sim: ${plan.fairSimRequirements}`);
  if (plan.forceWinRequirements) lines.push(`Force Win: ${plan.forceWinRequirements}`);
  if (!lines.length) lines.push("See league rules for scheduling, activity, and sportsmanship standards.");
  return lines;
}

function buildGameEmbeds(plan: any) {
  const weekLabel = plan.weekNumber ? `Week ${plan.weekNumber}: ` : "";
  const gotwLabel = plan.isGotw
    ? plan.isPlayoff
      ? `\n🏆 **${String(plan.seasonStage ?? "Playoff").replaceAll("_", " ")} GOTW** — Vote in the announcements channel!`
      : "\n⭐ **Game of the Week** — Vote in the announcements channel!"
    : "";
  const base = [
    `Schedule your game in this channel this week.${gotwLabel}`,
    "",
    "Next Advance:",
    advanceLines(plan.nextAdvanceTimes),
    "",
    `Streaming Required: ${plan.streamingRequired ? "Yes" : "No"}`,
    `Requirement: ${plan.streamingRequirement ?? "Based on league settings"}`,
    plan.streamingRequired && plan.streamingSide && plan.streamingSide !== "both"
      ? `Who Streams: ${plan.streamingSide === "home" ? plan.homeTeamName : plan.awayTeamName} (${plan.streamingSide} team)`
      : undefined,
    "",
    "League Game Rules:",
    `• Fourth Down Rules: ${plan.fourthDownRules ?? "Use league settings."}`,
    "• Scheduling, Activity & Sportsmanship:",
    ...buildActivityRulesLines(plan).map((l) => `  ${l}`)
  ].filter((l) => l !== undefined).join("\n");
  return splitText(base).map((description, index) =>
    new EmbedBuilder()
      .setTitle(index === 0 ? `${weekLabel}${plan.awayTeamName} vs ${plan.homeTeamName}` : "League Game Rules Continued")
      .setDescription(description)
  );
}

function stageLabel(value: unknown) {
  const text = String(value ?? "").replaceAll("_", " ").trim();
  return text ? text.replace(/\b\w/g, (char) => char.toUpperCase()) : "Stage TBD";
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  const prefix = amount < 0 ? "-" : "";
  return `${prefix}$${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function clampField(value: string, max = 1024) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3).trimEnd()}...`;
}

function sideLabel(side: unknown) {
  const text = String(side ?? "").toLowerCase();
  if (text === "home") return "Home";
  if (text === "away") return "Away";
  if (text === "both") return "Both";
  if (text === "either") return "Either";
  return "Either";
}

function challengeLines(challenges: any[], side: "offense" | "defense") {
  const sideChallenges = (challenges ?? []).filter((challenge: any) => challenge.challenge_side === side);
  if (!sideChallenges.length) return "No challenge assigned.";
  return sideChallenges.flatMap((challenge: any) => [
    `**S Tier:** ${challenge.s_tier_goal ?? "TBD"} - $50`,
    `**A Tier:** ${challenge.a_tier_goal ?? "TBD"} - $25`,
    `**B Tier:** ${challenge.b_tier_goal ?? "TBD"} - $10`
  ]).join("\n");
}

function matchupChannelText(payload: any) {
  if (payload.matchup?.gameType === "BYE") return "BYE WEEK";
  if (payload.matchup?.gameType === "CPU") return "CPU Matchup";
  return payload.matchup?.gameChannelId ? `<#${payload.matchup.gameChannelId}>` : "Not created yet";
}

function streamingText(payload: any) {
  const required = payload.streaming?.required ? "Yes" : "No";
  if (!payload.streaming?.required) return required;
  return `${required} (${sideLabel(payload.streaming?.side)})`;
}

function transactionsText(payload: any) {
  const rows = (payload.payouts ?? []).map((payout: any) => {
    const direction = Number(payout.amount ?? 0) < 0 ? "Outgoing" : "Incoming";
    return `**${direction}:** ${payout.label ?? payout.type ?? "Transaction"} (${money(payout.amount)})`;
  });
  rows.push(`**Wallet Balance:** ${money(payload.walletBalance)}`);
  rows.push(`**Savings Balance:** ${money(payload.savingsBalance)}`);
  return rows.join("\n");
}

function potwText(payload: any) {
  return payload.potwAwards?.length
    ? payload.potwAwards.map((award: any) => `**${award.label}:** ${award.playerName} +${money(award.amount)}`).join("\n")
    : "No POTW awards from the completed week.";
}

function gotwOutcomeText(payload: any) {
  const outcome = payload.gotw?.previousOutcome;
  if (!outcome) return "No previous GOTW outcome recorded.";
  return [
    `**Matchup:** ${outcome.matchup}`,
    `**Winner:** ${outcome.winner}`,
    `**Your Pick:** ${outcome.userPick}`,
    `**Result:** ${outcome.result}`
  ].join("\n");
}

function buildAdvanceDmEmbed(guild: Guild, payload: any) {
  const seasonWeek = `Season ${payload.seasonNumber}, Week ${payload.weekNumber}${payload.seasonStage ? ` (${stageLabel(payload.seasonStage)})` : ""}`;
  const opponent = payload.matchup?.opponentDiscordId ? `<@${payload.matchup.opponentDiscordId}>` : payload.matchup?.opponent ?? "TBD";
  const nextWeekStage = payload.nextWeekStage
    ? `Week ${payload.nextWeekStage.weekNumber} (${stageLabel(payload.nextWeekStage.seasonStage)})`
    : "TBD";

  return new EmbedBuilder()
    .setTitle("REC League Advanced")
    .addFields(
      { name: "**LEAGUE NAME**", value: `[${payload.leagueName ?? guild.name}](https://discord.com/channels/${guild.id})`, inline: true },
      { name: "**SEASON / WEEK**", value: seasonWeek, inline: true },
      { name: "**Your Team**", value: payload.team?.name ?? "TBD", inline: true },
      { name: "**Opponent**", value: opponent, inline: true },
      {
        name: "**MATCHUP DETAILS**",
        value: clampField([
          `**You are:** ${payload.matchup?.location ?? "NONE"}`,
          `**Your Game Channel:** ${matchupChannelText(payload)}`,
          `**Streaming Required:** ${streamingText(payload)}`,
          `**Streaming Details:** ${payload.streaming?.requirement ?? "Based on league settings"}`
        ].join("\n"))
      },
      { name: "**GOTW**", value: clampField(payload.gotw?.selected ?? "Not selected yet"), inline: true },
      { name: "**GOTW Voting Record**", value: payload.gotw?.votingRecord ?? "No votes yet", inline: true },
      { name: "**OFFENSIVE CHALLENGES**", value: clampField(challengeLines(payload.challenges, "offense")), inline: true },
      { name: "**DEFENSIVE CHALLENGES**", value: clampField(challengeLines(payload.challenges, "defense")), inline: true },
      { name: "**NEXT ADVANCE**", value: clampField(advanceLines(payload.nextAdvanceTimes)), inline: true },
      { name: "**NEXT WEEK/STAGE**", value: nextWeekStage, inline: true },
      { name: "**TRANSACTIONS**", value: clampField(transactionsText(payload)) },
      { name: "**POTW Winners**", value: clampField(potwText(payload)) },
      { name: "**GOTW Outcome**", value: clampField(gotwOutcomeText(payload)) }
    );
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
  const skipped: any[] = [];

  if (!categoryId) {
    skipped.push({ reason: "Game channels category not configured in server setup" });
  } else {
    for (const plan of result.plans ?? []) {
      const channel = await guild.channels.create({ name: plan.channelName, type: ChannelType.GuildText, parent: categoryId, reason: "REC weekly H2H matchup channel", permissionOverwrites: [{ id: guild.roles.everyone, allow: [PermissionFlagsBits.ViewChannel] }] });
      if (channel instanceof TextChannel) {
        const awayMention = userMention(plan.awayDiscordId, plan.awayTeamName ?? "Away");
        const homeMention = userMention(plan.homeDiscordId, plan.homeTeamName ?? "Home");
        await channel.send({
          content: `${awayMention} vs ${homeMention}`,
          embeds: buildGameEmbeds(plan)
        });

        await recApi.recordGameChannel({ ...plan, discordChannelId: channel.id });
        created.push({ matchup: `${plan.awayTeamName} vs ${plan.homeTeamName}`, channelId: channel.id });
      }
    }
  }

  return { created, skipped, totalPlans: result.plans?.length ?? 0 };
}

// Sends DMs and posts the advance announcement. Does NOT create game channels.
export async function sendAdvanceDmsOnly(guild: Guild) {
  const result = await recApi.getAdvanceDmPayloads(guild.id);
  const payloads = result?.payloads ?? [];

  if (result?.announcementsChannelId) {
    try {
      const announceCh = await guild.channels.fetch(result.announcementsChannelId).catch(() => null) as TextChannel | null;
      if (announceCh?.isTextBased()) {
        const matchupLines = (result.allMatchups ?? [])
          .filter((m: any) => !m.isCpu)
          .map((m: any) => {
            const away = m.awayDiscordId ? `<@${m.awayDiscordId}>` : m.awayTeamName;
            const home = m.homeDiscordId ? `<@${m.homeDiscordId}>` : m.homeTeamName;
            return `• ${away} vs ${home}`;
          });
        const advanceText = [
          `**${result.leagueName} — Week ${result.weekNumber} has begun!**`,
          `Season ${result.seasonNumber} | ${String(result.seasonStage ?? "").replaceAll("_", " ")}`,
          "",
          "**This Week's Matchups:**",
          ...matchupLines,
          "",
          "**Next Advance:**",
          advanceLines(result.nextAdvanceTimes)
        ].join("\n");
        await announceCh.send({ content: advanceText });
      }
    } catch (err) {
      console.error("Failed to post advance announcement", err);
    }
  }

  return sendAdvanceDmPayloads(guild, payloads);
}

// Sends per-user advance DMs from already-built payloads. Used by the catch-up advance to DM each
// caught-up week's payloads (the orchestrator returns per-week payloads it captured at the time).
export async function sendAdvanceDmPayloads(guild: Guild, payloads: any[]) {
  let sent = 0;
  let failed = 0;
  for (const payload of payloads ?? []) {
    if (!payload?.discordId) continue;
    const user = await guild.client.users.fetch(payload.discordId).catch(() => null);
    if (!user) { failed++; continue; }
    try { await user.send({ embeds: [buildAdvanceDmEmbed(guild, payload)] }); sent++; } catch { failed++; }
  }
  return { sent, failed };
}

// Full advance DM flow: sends DMs + announcement + creates game channels.
export async function sendAdvanceDmsForGuild(guild: Guild) {
  const { sent, failed } = await sendAdvanceDmsOnly(guild);
  const gameChannels = await recreateGameChannelsForGuild(guild);
  return { sent, failed, gameChannels };
}

export async function recordHighlightMessage(message: any) {
  if (!message.guildId || message.author?.bot) return;
  try {
    const result = await recApi.recordHighlightPost({
      guildId: message.guildId,
      discordId: message.author.id,
      discordChannelId: message.channelId,
      discordMessageId: message.id,
      messageUrl: message.url ?? null,
      content: message.content ?? null
    });

    // Post payout review embed to pending payouts channel
    if (result?.payoutEligible && result.pendingPayoutsChannelId) {
      const channel = await message.guild.channels.fetch(result.pendingPayoutsChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        const reviewMessage = await channel.send({
          embeds: [new EmbedBuilder()
            .setTitle("HIGHLIGHT PAYOUT REVIEW")
            .setColor(0x2ecc71)
            .setDescription([
              `User: <@${message.author.id}>`,
              `Week: ${result.post?.week_number ?? "?"}`,
              `Amount: $25 REC Cash`,
              `[View Highlight](${message.url ?? result.post?.message_url ?? "N/A"})`
            ].join("\n"))],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`highlight_payout:approve:${result.post?.id}`).setLabel("Approve Payout").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`highlight_payout:deny:${result.post?.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
          )]
        }).catch(() => undefined);
        if (reviewMessage && result.inbox?.id) {
          await recApi.recordCommissionersInboxMessage({
            inboxId: result.inbox.id,
            discordChannelId: reviewMessage.channelId,
            discordMessageId: reviewMessage.id
          }).catch(() => undefined);
        }
      }
    }

    // DM the user immediately with POTY nomination option
    if (result?.post?.id) {
      try {
        const member = await message.guild.members.fetch(message.author.id).catch(() => null);
        if (member) {
          await member.send({
            embeds: [new EmbedBuilder()
              .setTitle("Play of the Year Nomination")
              .setDescription([
                `Your highlight from **Week ${result.post.week_number ?? "?"}** has been logged!`,
                "",
                `[View your highlight](${message.url ?? result.post.message_url ?? "N/A"})`,
                "",
                "Want to nominate it for **Play of the Year**? Click below to choose a category."
              ].filter(Boolean).join("\n"))
              .setColor(0xf1c40f)
            ],
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`poty_nominate_own:${message.guildId}:${result.post.id}`)
                .setLabel("Nominate My Play")
                .setStyle(ButtonStyle.Primary)
            )]
          }).catch(() => undefined);
        }
      } catch { /* non-fatal — DM may be disabled */ }
    }
  } catch { /* non-fatal */ }
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

  if (streamResult?.needsReview && streamResult.pendingPayoutsChannelId) {
    const channel = await message.guild.channels.fetch(streamResult.pendingPayoutsChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const reviewMessage = await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle("STREAM PAYOUT REVIEW")
          .setDescription([
            `User: <@${message.author.id}>`,
            `Week: ${streamResult.log?.week_number ?? "?"}`,
            `Amount: $25 REC Cash`,
            `Reason: User mentioned Discord as their stream source but no supported stream link was detected.`,
            `Original Message: ${message.url ?? "Unavailable"}`
          ].join("\n"))],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`rec:stream_review:approve:${streamResult.review?.id}`).setLabel("Approve Stream Payout").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`rec:stream_review:deny:${streamResult.review?.id}`).setLabel("Deny Stream Payout").setStyle(ButtonStyle.Danger)
        )]
      }).catch(() => undefined);
      if (reviewMessage && streamResult.inbox?.id) {
        await recApi.recordCommissionersInboxMessage({
          inboxId: streamResult.inbox.id,
          discordChannelId: reviewMessage.channelId,
          discordMessageId: reviewMessage.id
        }).catch(() => undefined);
      }
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
