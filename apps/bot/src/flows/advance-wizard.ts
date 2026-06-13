import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild, Message, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildMainMenuEmbed, buildMainMenuRows } from "../ui/menu.js";
import { buildGotwAnnouncementContent, buildGotwVoteEmbed, buildGotwVoteRows } from "../ui/gotw.js";
import { buildPowerRankingsEmbeds } from "../ui/power-rankings.js";
import { readStat, formatStatValue, getStatShortLabel } from "@rec/shared";
import { recApi } from "../lib/rec-api.js";
import { ExpiringSessionStore } from "../lib/session-timeout.js";
import { wallClockToUtc } from "../ui/advance-schedule.js";
import { recreateGameChannelsForGuild, sendAdvanceDmsOnly } from "./game-channels.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";

export const ADVANCE_WIZARD_GOTW_CUSTOM_ID = "rec:advance_wizard:gotw";

interface BadgeAnnouncement {
  userId: string;
  discordId: string | null;
  badgeName: string;
  badgeLabel: string;
  qualifier?: string;
  reason?: string;
  type: "earned" | "lost";
}

interface EosPollNominee {
  userId: string;
  discordId: string | null;
  displayName: string;
}

interface EosPoll {
  id: string;
  categoryKey: string;
  categoryLabel: string;
  categoryDescription: string | null;
  closesAt: string | null;
}

interface EosPollsData {
  polls: EosPoll[];
  nominees: EosPollNominee[];
  closesAt: string | null;
  announcementsChannelId: string | null;
  recAwardsData?: {
    awards: Array<{
      awardId: string;
      key: string;
      name: string;
      description?: string;
      nomineeCount: number;
      status: string;
      nomineeOptions?: Array<{ userId: string; discordId: string | null; displayLabel: string; performanceScore?: number; statLine?: string; voteCount?: number; liveScore?: number }>;
      payoutAmount?: number;
      prizeText?: string;
      nominees?: Array<{ userId: string; displayLabel: string; performanceScore?: number; statLine?: string; voteCount?: number; liveScore?: number }>;
      totalVotes?: number;
      closesAt?: string | null;
    }>;
    leagueId: string;
    seasonNumber: number;
    announcementsChannelId: string | null;
    error?: string | null;
  } | null;
}

interface AdvanceWizardState {
  weekNumber: number;
  seasonStage: string;
  warnings: string[];
  badgeAnnouncements?: BadgeAnnouncement[];
  announcementsChannelId?: string | null;
  eosPollsData?: EosPollsData | null;
  eosLockData?: any;
  nominationData?: any;
}

export const advanceWizardSessions = new ExpiringSessionStore<AdvanceWizardState>();

function asAwardScore(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function buildRecAwardVotingEmbed(award: any): EmbedBuilder {
  const sourceNominees = Array.isArray(award.nominees) && award.nominees.length ? award.nominees : (award.nomineeOptions ?? []);
  const nominees = [...sourceNominees]
    .map((n: any) => ({
      displayLabel: String(n.displayLabel ?? n.teamName ?? n.userId ?? "Unknown"),
      performanceScore: asAwardScore(n.performanceScore),
      statLine: n.statLine ? String(n.statLine) : "",
      voteCount: asAwardScore(n.voteCount),
      liveScore: asAwardScore(n.liveScore ?? n.finalScore ?? n.performanceScore)
    }))
    .sort((a, b) => b.liveScore - a.liveScore || b.performanceScore - a.performanceScore || b.voteCount - a.voteCount);

  const topLines = nominees.slice(0, 10).map((n, index) => {
    const voteText = n.voteCount > 0 ? ` · Votes: **${n.voteCount}**` : "";
    const statLine = n.statLine ? `\n   ${n.statLine}` : "";
    return `**${index + 1}. ${n.displayLabel}** — Score: **${n.performanceScore.toFixed(2)}**${voteText}${statLine}`;
  });

  return new EmbedBuilder()
    .setTitle(award.name ?? "REC Award Vote")
    .setDescription([
      award.description ?? "Vote for the best candidate this season.",
      award.prizeText || award.payoutAmount ? `**Prize:** ${award.prizeText ?? `$${award.payoutAmount}`}` : "",
      "",
      nominees.length ? "**Current Top Nominees**" : "No nominees available.",
      ...topLines,
      "",
      "_Rankings update as votes are recorded._"
    ].filter(Boolean).join("\n").slice(0, 4000))
    .setColor(0x9b59b6)
    .setFooter({ text: `${nominees.length} nominees · ${award.totalVotes ?? 0} votes logged${award.closesAt ? ` · Closes ${new Date(award.closesAt).toLocaleString()}` : " · Voting closes in 24 hours"}` });
}


async function cleanAwardVotingChannel(channel: TextChannel, warnings: string[]): Promise<void> {
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    const awardMessages = fetched.filter((message: Message) => {
      if (message.author.id !== channel.client.user?.id) return false;
      const embedTitle = message.embeds?.[0]?.title ?? "";
      const footer = message.embeds?.[0]?.footer?.text ?? "";
      const hasAwardSelect = message.components?.some((row: any) =>
        row.components?.some((component: any) => String(component.customId ?? "").startsWith("rec_award_vote:") || String(component.customId ?? "").startsWith("eos_vote:"))
      );
      return Boolean(
        hasAwardSelect ||
        embedTitle === "Post-Season Voting Has Begun" ||
        embedTitle === "REC Award Generation Failed" ||
        footer.includes("votes logged") ||
        footer.includes("Voting closes")
      );
    });

    const bulkDeletable = awardMessages.filter((message: Message) => message.bulkDeletable);
    if (bulkDeletable.size > 0) {
      await channel.bulkDelete(bulkDeletable, true).catch((err) =>
        warnings.push(`award_channel_bulk_delete: ${err instanceof Error ? err.message : String(err)}`)
      );
    }

    const remaining = awardMessages.filter((message: Message) => !message.bulkDeletable && message.deletable);
    for (const message of remaining.values()) {
      await message.delete().catch((err) =>
        warnings.push(`award_channel_delete_${message.id}: ${err instanceof Error ? err.message : String(err)}`)
      );
    }
  } catch (err) {
    warnings.push(`award_channel_cleanup: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Shared EOS poll + REC Awards posting — called from advance-wizard finalize AND
// the manual "Run EOS Polls & Awards" advance menu action.
export async function postEosPollsAndAwards(guild: Guild, pollsData: EosPollsData): Promise<string[]> {
  const warnings: string[] = [];
  const votingChannelId = pollsData.announcementsChannelId ?? pollsData.recAwardsData?.announcementsChannelId ?? null;

  if (votingChannelId) {
    try {
      const channel = await guild.channels.fetch(votingChannelId).catch(() => null) as TextChannel | null;
      if (channel?.type === ChannelType.GuildText) {
        await cleanAwardVotingChannel(channel, warnings);
        await channel.send({
          content: "@everyone",
          embeds: [new EmbedBuilder()
            .setTitle("Post-Season Voting Has Begun")
            .setDescription([
              "Post-season voting is now open.",
              "",
              "You have **24 hours** to cast your votes in the polls below.",
              "Winners receive various cash rewards, and select special categories receive added bonus rewards for winning.",
              "",
              "Only linked coaches may vote. No self-voting. You may change your vote before voting closes."
            ].join("\n"))
            .setColor(0xf1c40f)
          ],
          allowedMentions: { parse: ["everyone"] }
        }).catch((err) => warnings.push(`voting_announcement: ${err instanceof Error ? err.message : String(err)}`));
      }
    } catch (err) {
      warnings.push(`voting_announcement: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (pollsData.polls?.length && pollsData.announcementsChannelId) {
    try {
      const pollCh = await guild.channels.fetch(pollsData.announcementsChannelId).catch(() => null) as TextChannel | null;
      if (pollCh?.type === ChannelType.GuildText) {
        const { polls, nominees, closesAt } = pollsData;
        const nomineeOptions = (nominees as EosPollNominee[])
          .filter((n) => n.discordId)
          .slice(0, 25)
          .map((n) => new StringSelectMenuOptionBuilder().setLabel(n.displayName.slice(0, 100)).setValue(n.discordId!));

        if (nomineeOptions.length > 0) {
          const closeTimeStr = closesAt
            ? `Voting closes <t:${Math.floor(new Date(closesAt).getTime() / 1000)}:R>`
            : "Voting closes when playoffs end.";

          for (const poll of polls) {
            await pollCh.send({
              embeds: [new EmbedBuilder()
                .setTitle(`🏆 ${poll.categoryLabel}`)
                .setDescription([poll.categoryDescription ?? "", "", closeTimeStr, "", "_Only linked coaches may vote. You may change your vote before voting closes._"].join("\n"))
                .setColor(0x9b59b6)
              ],
              components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId(`eos_vote:${poll.id}:${poll.categoryKey}`)
                  .setPlaceholder(`Vote for ${poll.categoryLabel}`)
                  .addOptions(nomineeOptions)
              )]
            }).catch((e) => {
              console.error("[EOS] Failed to post community poll:", e);
              warnings.push(`eos_poll_${poll.categoryKey}: ${e instanceof Error ? e.message : String(e)}`);
            });
          }
        } else {
          warnings.push("eos_polls: no linked nominees available for select menu options");
        }
      }
    } catch (err) {
      console.error("[EOS] Community poll posting failed:", err);
      warnings.push(`eos_polls: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const recAwardsData = pollsData.recAwardsData;
  if (recAwardsData?.error && (recAwardsData.announcementsChannelId ?? pollsData.announcementsChannelId)) {
    const channelId = recAwardsData.announcementsChannelId ?? pollsData.announcementsChannelId;
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) as TextChannel | null : null;
    if (channel?.type === ChannelType.GuildText) {
      await channel.send({ embeds: [new EmbedBuilder().setTitle("REC Award Generation Failed").setDescription(`REC award voting embeds were not created.\n\n\`${recAwardsData.error.slice(0, 1800)}\``).setColor(0xe74c3c)] }).catch(() => undefined);
    }
    warnings.push(`rec_awards_generation: ${recAwardsData.error}`);
  }

  if (recAwardsData?.awards?.length && recAwardsData.announcementsChannelId) {
    try {
      const awardCh = await guild.channels.fetch(recAwardsData.announcementsChannelId).catch(() => null) as TextChannel | null;
      if (awardCh?.type === ChannelType.GuildText) {
        const votingAwards = recAwardsData.awards.filter((a) => a.status === "voting" && a.nomineeCount > 0);
        if (votingAwards.length === 0 && recAwardsData.awards.length > 0) {
          warnings.push(`rec_awards: generated ${recAwardsData.awards.length} awards but none are voting awards with nominees`);
        }
        for (const award of votingAwards) {
          const options = (award.nomineeOptions ?? []).slice(0, 25).map((n) =>
            new StringSelectMenuOptionBuilder().setLabel(n.displayLabel.slice(0, 100)).setValue(n.userId)
          );
          if (options.length === 0) {
            warnings.push(`rec_award_${award.key}: no selectable nominee options`);
            continue;
          }
          await awardCh.send({
            embeds: [buildRecAwardVotingEmbed(award)],
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`rec_award_vote:${guild.id}:${award.awardId}`)
                .setPlaceholder(`Vote for ${award.name}`)
                .addOptions(options)
            )]
          }).catch((err) => warnings.push(`rec_award_${award.key}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    } catch (err) {
      console.error("[EOS] REC Awards posting failed:", err);
      warnings.push(`rec_awards: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return warnings;
}

function asNumber(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function processingEmbed(title: string, description: string) {
  return new EmbedBuilder().setTitle(title).setDescription(description);
}

function buildPotwAnnouncementEmbed(awards: any[], completedWeek: number) {
  const lines: string[] = [`**Week ${completedWeek} — Player of the Week**`, ""];

  const byConference = new Map<string, { offense?: any; defense?: any }>();
  for (const award of awards) {
    const conf = award.conference ?? "Unknown";
    if (!byConference.has(conf)) byConference.set(conf, {});
    const entry = byConference.get(conf)!;
    if (award.award_side === "offense") entry.offense = award;
    else entry.defense = award;
  }

  for (const [conference, { offense, defense }] of byConference) {
    lines.push(`__**${conference}**__`);
    for (const [label, award] of [["Offensive", offense], ["Defensive", defense]] as const) {
      if (!award) continue;
      const mention = award.discordId ? `<@${award.discordId}>` : award.player_name ?? "Unknown";
      const statsLine = formatPotwStats(award.weeklyStats ?? award.raw_payload?.weeklyStats ?? {}, award.award_side as "offense" | "defense");
      lines.push(`**${label} POTW:** ${award.player_name ?? "Unknown"} (${award.position ?? "?"}) · ${mention}`);
      if (statsLine) lines.push(`${statsLine}`);
      lines.push(`Bonus: **+$${award.payout_amount ?? 10}**`);
      lines.push("");
    }
  }

  if (lines.length <= 2) lines.push("No qualified POTW candidates found this week.");

  return new EmbedBuilder()
    .setTitle(`⭐ Week ${completedWeek} Player of the Week`)
    .setDescription(lines.join("\n").slice(0, 4000));
}

function formatPotwStats(stats: Record<string, any>, side: "offense" | "defense"): string {
  // Render one "value ShortLabel" segment from a canonical stat key (e.g. "3 Pass TD").
  const stat = (key: string): string => `${formatStatValue(key, readStat(stats, key))} ${getStatShortLabel(key)}`;
  const parts: string[] = [];
  if (side === "offense") {
    const passYds = readStat(stats, "pass_yards");
    const rushYds = readStat(stats, "rush_yards");
    const recYds = readStat(stats, "receiving_yards");
    if (passYds > 0) parts.push(`${stat("pass_yards")}, ${stat("pass_tds")}, ${stat("interceptions_thrown")}`);
    if (rushYds > 0) parts.push(`${stat("rush_yards")}${readStat(stats, "rush_tds") > 0 ? `, ${stat("rush_tds")}` : ""}`);
    if (recYds > 0) parts.push(`${stat("receiving_yards")}${readStat(stats, "receiving_tds") > 0 ? `, ${stat("receiving_tds")}` : ""}`);
  } else {
    if (readStat(stats, "sacks") > 0) parts.push(stat("sacks"));
    if (readStat(stats, "interceptions") > 0) parts.push(stat("interceptions"));
    if (readStat(stats, "forced_fumbles") > 0) parts.push(stat("forced_fumbles"));
    if (readStat(stats, "tackles") > 0) parts.push(stat("tackles"));
    if (readStat(stats, "tackles_for_loss") > 0) parts.push(stat("tackles_for_loss"));
  }
  return parts.join(" · ");
}

function buildWizardGotwSelectionPayload(candidates: any[], weekNumber: number) {
  const topCandidates = candidates.slice(0, 25);
  const options = topCandidates.map((c: any) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(c.matchup_title?.length > 100 ? c.matchup_title.slice(0, 97) + "..." : c.matchup_title ?? "Unknown Matchup")
      .setValue(c.id)
      .setDescription(`Rating: ${Number(c.strength_rating ?? 0).toFixed(0)}`)
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Step 5 of 6 — Select Week ${weekNumber} Game of the Week`)
        .setDescription("Select the matchup to feature as the Game of the Week. The vote poll will be posted to the announcements channel.\n\nMatchups are sorted by strength rating (power rankings, competitiveness, division rivalry).")
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ADVANCE_WIZARD_GOTW_CUSTOM_ID)
          .setPlaceholder("Select the GOTW matchup")
          .addOptions(options)
      )
    ]
  };
}

function buildWizardCompletePage(weekNumber: number, seasonStage: string, warnings: string[]) {
  const stageLabel = String(seasonStage ?? "regular_season").replaceAll("_", " ");
  const lines = [
    `The advance process has completed. It is now **Week ${weekNumber}** (${stageLabel}).`,
    "",
    warnings.length ? `**${warnings.length} warning(s) during advance:**` : "All advance steps completed successfully.",
    ...warnings.slice(0, 8).map((w) => `• ${w}`)
  ].filter(Boolean);

  return {
    embeds: [new EmbedBuilder().setTitle("Advance Complete").setDescription(lines.join("\n").slice(0, 4000))],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("rec:nav:admin_panel").setLabel("Admin Panel").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("rec:nav:main_menu").setLabel("Main Menu").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

export async function runAdvanceWizardProcessing(
  interaction: ButtonInteraction,
  date: string,
  hour: number,
  timezone: string,
  guild: Guild
) {
  const guildId = guild.id;
  const allWarnings: string[] = [];

  // Save the next advance time
  try {
    const [y, mo, d] = date.split("-").map(Number);
    const when = wallClockToUtc(y, mo, d, hour, timezone);
    await recApi.setNextAdvance({ guildId, nextAdvanceAt: when.toISOString(), timezone });
  } catch (err) {
    console.error("[WIZARD] Failed to save advance time:", err);
  }

  // Step 2: Process results
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 2 of 6 — Processing Results",
      "Game results are being logged, records updated and payouts issued...\n\nThis may take a moment. Please wait."
    )],
    components: []
  });

  let resultsData: any;
  try {
    resultsData = await recApi.processAdvanceResults(guildId);
  } catch (err) {
    console.error("[WIZARD] processAdvanceResults failed:", err);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Advance Failed").setDescription(`The advance process could not be completed.\n\n${err instanceof Error ? err.message : String(err)}`)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("rec:nav:admin_panel").setLabel("Admin Panel").setStyle(ButtonStyle.Secondary)
      )]
    });
    return;
  }

  if (!resultsData?.week) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Advance Week Failed").setDescription(
        ["The week could not be advanced. Check the API logs for details.", "", ...(resultsData?.warnings ?? []).map((w: string) => `• ${w}`)].join("\n")
      )],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("rec:nav:admin_panel").setLabel("Admin Panel").setStyle(ButtonStyle.Secondary)
      )]
    });
    return;
  }

  allWarnings.push(...(resultsData.warnings ?? []));
  const completedWeek = resultsData.week.previousWeek as number;
  const newWeek = resultsData.week.weekNumber as number;
  const newStage = resultsData.week.seasonStage as string;

  // Collect transition badges (season-end / playoff) from the advance step
  const allBadgeAnnouncements: BadgeAnnouncement[] = [];
  const transitionBadges = resultsData.transitionBadgeAnnouncements;
  let badgeAnnouncementsChannelId: string | null = transitionBadges?.announcementsChannelId ?? null;
  if (transitionBadges?.earned?.length) {
    for (const b of transitionBadges.earned) allBadgeAnnouncements.push({ ...b, type: "earned" });
  }
  if (transitionBadges?.lost?.length) {
    for (const b of transitionBadges.lost) allBadgeAnnouncements.push({ ...b, type: "lost" });
  }

  // Collect EOS polls data (created on regular_season → wild_card transition)
  const eosPollsData: EosPollsData | null = resultsData.eosPollsData ?? null;
  // EOS lock data (wild_card → divisional): may include commissioner tiebreakers
  const eosLockData: any = resultsData.eosLockData ?? null;
  // Nomination data (POTY/GOTY DMs) — only present for intra-regular-season advances
  const nominationData: any = resultsData.nominationData ?? null;

  // Step 3: POTW
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 3 of 6 — POTW Awards",
      `Reviewing Week ${completedWeek} performances and awarding Player of the Week bonuses...`
    )],
    components: []
  });

  let potwData: any;
  try {
    potwData = await recApi.processPotwAward(guildId);
    allWarnings.push(...(potwData.warnings ?? []));

    if (potwData.awards?.length && potwData.announcementsChannelId) {
      const ch = await guild.channels.fetch(potwData.announcementsChannelId).catch(() => null) as TextChannel | null;
      if (ch?.type === ChannelType.GuildText) {
        await ch.send({ embeds: [buildPotwAnnouncementEmbed(potwData.awards, completedWeek)] }).catch((e) =>
          console.error("[WIZARD] Failed to post POTW announcement:", e)
        );
      }
    }

    // Collect weekly badges (Comeback Artist, Record Breaker) from POTW step
    const weeklyBadges = potwData.weeklyBadgeAnnouncements;
    if (!badgeAnnouncementsChannelId && potwData.announcementsChannelId) {
      badgeAnnouncementsChannelId = potwData.announcementsChannelId;
    }
    if (weeklyBadges?.earned?.length) {
      for (const b of weeklyBadges.earned) allBadgeAnnouncements.push({ ...b, type: "earned" });
    }
    if (weeklyBadges?.lost?.length) {
      for (const b of weeklyBadges.lost) allBadgeAnnouncements.push({ ...b, type: "lost" });
    }
  } catch (err) {
    console.error("[WIZARD] processPotwAward failed:", err);
    allWarnings.push(`potw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Power Rankings
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 4 of 6 — Power Rankings",
      `Calculating Week ${completedWeek} power rankings and posting to announcements...`
    )],
    components: []
  });

  try {
    const rankingsData = await recApi.calculatePowerRankings(guildId);
    allWarnings.push(...(rankingsData.warnings ?? []));

    // Post to announcements channel — @everyone tag, split across multiple embeds if >16 teams
    const rankingsChannelId = rankingsData?.announcementsChannelId ?? potwData?.announcementsChannelId;

    if (rankingsData?.rankings?.length && rankingsChannelId) {
      const ch = await guild.channels.fetch(rankingsChannelId).catch(() => null) as TextChannel | null;
      if (ch?.type === ChannelType.GuildText) {
        const embeds = buildPowerRankingsEmbeds(rankingsData);
        // Discord allows max 10 embeds per message; send in groups
        const EMBEDS_PER_MSG = 10;
        for (let i = 0; i < embeds.length; i += EMBEDS_PER_MSG) {
          const batch = embeds.slice(i, i + EMBEDS_PER_MSG);
          const isFirst = i === 0;
          await ch.send({
            content: isFirst ? "@everyone" : undefined,
            embeds: batch,
            allowedMentions: isFirst ? { parse: ["everyone"] } : { parse: [] }
          }).catch((e) => console.error("[WIZARD] Failed to post power rankings:", e));
        }
      }
    }
  } catch (err) {
    console.error("[WIZARD] calculatePowerRankings failed:", err);
    allWarnings.push(`power_rankings: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 5: GOTW
  const isRegularSeason = newStage === "regular_season";
  const isPlayoffStage = ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(newStage);

  if (isPlayoffStage) {
    // In playoffs every H2H game is a GOTW — auto-create polls and post all vote embeds
    await interaction.editReply({
      embeds: [processingEmbed(
        "Step 5 of 6 — Playoff Game of the Week",
        `All ${String(newStage).replaceAll("_", " ")} matchups are Game of the Week. Creating vote polls...`
      )],
      components: []
    });

    try {
      const playoffGotw = await recApi.processPlayoffGotw(guildId);
      const channelId = playoffGotw.channelId;
      if (channelId && playoffGotw.polls?.length) {
        const ch = await guild.channels.fetch(channelId).catch(() => null) as TextChannel | null;
        if (ch?.type === ChannelType.GuildText) {
          for (const poll of playoffGotw.polls) {
            const awayDiscordId: string | null = poll.awayDiscordId ?? null;
            const homeDiscordId: string | null = poll.homeDiscordId ?? null;
            const discordUserIds = [awayDiscordId, homeDiscordId].filter((id): id is string => Boolean(id));
            const sent = await ch.send({
              content: buildGotwAnnouncementContent(poll, awayDiscordId, homeDiscordId),
              embeds: [buildGotwVoteEmbed(poll, [])],
              components: buildGotwVoteRows(poll),
              allowedMentions: { parse: ["everyone"], users: discordUserIds }
            }).catch((e) => { console.error("[WIZARD] Failed to post playoff GOTW embed:", e); return null; });
            if (sent) {
              await recApi.recordGotwPollMessage({ pollId: poll.id, discordChannelId: ch.id, discordMessageId: sent.id }).catch(() => undefined);
            }
          }
        }
      }
      allWarnings.push(...(playoffGotw.warnings ?? []));
    } catch (err) {
      console.error("[WIZARD] processPlayoffGotw failed:", err);
      allWarnings.push(`playoff_gotw: ${err instanceof Error ? err.message : String(err)}`);
    }

    advanceWizardSessions.set(interaction.user.id, { weekNumber: newWeek, seasonStage: newStage, warnings: allWarnings, badgeAnnouncements: allBadgeAnnouncements, announcementsChannelId: badgeAnnouncementsChannelId, eosPollsData, eosLockData, nominationData });
    await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings, allBadgeAnnouncements, badgeAnnouncementsChannelId, eosPollsData, nominationData, eosLockData);
    return;
  }

  if (isRegularSeason) {
    await interaction.editReply({
      embeds: [processingEmbed(
        "Step 5 of 6 — Game of the Week",
        "Determining GOTW matchup ratings and pulling the upcoming schedule..."
      )],
      components: []
    });

    let candidates: any[] = [];
    try {
      const gotwData = await recApi.getGotwCandidates(guildId);
      candidates = gotwData.candidates ?? [];
    } catch (err) {
      console.error("[WIZARD] getGotwCandidates failed:", err);
      allWarnings.push(`gotw_candidates: ${err instanceof Error ? err.message : String(err)}`);
    }

    advanceWizardSessions.set(interaction.user.id, { weekNumber: newWeek, seasonStage: newStage, warnings: allWarnings, badgeAnnouncements: allBadgeAnnouncements, announcementsChannelId: badgeAnnouncementsChannelId, eosPollsData, eosLockData, nominationData });

    if (candidates.length) {
      await interaction.editReply(buildWizardGotwSelectionPayload(candidates, newWeek));
    } else {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("Step 5 of 6 — No GOTW Matchups")
          .setDescription("No H2H matchups found for this week. Skipping GOTW selection and proceeding to finalize.")],
        components: []
      });
      await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings, allBadgeAnnouncements, badgeAnnouncementsChannelId, eosPollsData, nominationData, eosLockData);
    }
    return;
  }

  // Offseason or unrecognized stage: skip GOTW
  advanceWizardSessions.set(interaction.user.id, { weekNumber: newWeek, seasonStage: newStage, warnings: allWarnings, badgeAnnouncements: allBadgeAnnouncements, announcementsChannelId: badgeAnnouncementsChannelId, eosPollsData, eosLockData, nominationData });
  await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings, allBadgeAnnouncements, badgeAnnouncementsChannelId, eosPollsData, nominationData, eosLockData);
}

export async function handleWizardGotwSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only admins can perform this action.", ephemeral: true });
    return;
  }
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Selecting GOTW...").setDescription("Saving your game of the week selection and posting the vote poll.")], components: [] });

  const wizardState = advanceWizardSessions.get(interaction.user.id);
  const candidateId = interaction.values[0];
  const guild = interaction.guild;

  // Select the GOTW and post the poll
  let newWeek = wizardState?.weekNumber ?? 0;
  let newStage = wizardState?.seasonStage ?? "regular_season";
  const allWarnings = wizardState?.warnings ?? [];
  const badgeAnnouncements = wizardState?.badgeAnnouncements ?? [];
  const announcementsChannelId = wizardState?.announcementsChannelId ?? null;
  const eosPollsData = wizardState?.eosPollsData ?? null;
  const eosLockData = wizardState?.eosLockData ?? null;
  const nominationData = wizardState?.nominationData ?? null;

  try {
    const result = await recApi.selectGotwCandidate({ guildId: guild.id, candidateId, selectedByDiscordId: interaction.user.id });
    const channelId = result.channelId;
    if (channelId) {
      const ch = await guild.channels.fetch(channelId).catch(() => null) as TextChannel | null;
      if (ch?.type === ChannelType.GuildText) {
        const poll = result.poll;
        const awayDiscordId: string | null = result.awayDiscordId ?? null;
        const homeDiscordId: string | null = result.homeDiscordId ?? null;
        const discordUserIds = [awayDiscordId, homeDiscordId].filter((id): id is string => Boolean(id));
        const sent = await ch.send({
          content: buildGotwAnnouncementContent(poll, awayDiscordId, homeDiscordId),
          embeds: [buildGotwVoteEmbed(poll, [])],
          components: buildGotwVoteRows(poll),
          allowedMentions: { parse: ["everyone"], users: discordUserIds }
        });
        await recApi.recordGotwPollMessage({ pollId: poll.id, discordChannelId: ch.id, discordMessageId: sent.id });
      }
    }
  } catch (err) {
    console.error("[WIZARD] GOTW select/post failed:", err);
    allWarnings.push(`gotw_select: ${err instanceof Error ? err.message : String(err)}`);
  }

  await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings, badgeAnnouncements, announcementsChannelId, eosPollsData, nominationData, eosLockData);
}

async function runAdvanceWizardFinalize(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  guild: Guild,
  weekNumber: number,
  seasonStage: string,
  warnings: string[],
  badgeAnnouncements: BadgeAnnouncement[] = [],
  announcementsChannelId: string | null = null,
  eosPollsData: EosPollsData | null = null,
  nominationData: any = null,
  eosLockData: any = null
) {
  // 5a: generate challenges
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 6 of 6 — Generating Challenges",
      "Generating weekly challenges..."
    )],
    components: []
  });

  try {
    const finalizeData = await recApi.finalizeAdvanceStep(guild.id);
    warnings.push(...(finalizeData.warnings ?? []));
  } catch (err) {
    console.error("[WIZARD] finalizeAdvanceStep failed:", err);
    warnings.push(`generate_challenges: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5b: send advance DMs and post announcement
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 6 of 6 — Sending Advance DMs",
      "Gathering all data and sending advance notice DMs..."
    )],
    components: []
  });

  try {
    await sendAdvanceDmsOnly(guild);
  } catch (err) {
    console.error("[WIZARD] sendAdvanceDmsOnly failed:", err);
    warnings.push(`advance_dms: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5c: create game channels (final step)
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 6 of 6 — Creating Game Channels",
      "Creating H2H game channels for the new week..."
    )],
    components: []
  });

  try {
    await recreateGameChannelsForGuild(guild);
  } catch (err) {
    console.error("[WIZARD] recreateGameChannelsForGuild failed:", err);
    warnings.push(`game_channels: ${err instanceof Error ? err.message : String(err)}`);
  }

  // DM each user about badge changes (no channel embed)
  if (badgeAnnouncements.length > 0) {
    const badgeIds = [...new Set(badgeAnnouncements.map((b) => b.discordId).filter(Boolean))] as string[];
    const badgeMembers = badgeIds.length > 0
      ? await guild.members.fetch({ user: badgeIds }).catch(() => new Map()) as Map<string, any>
      : new Map<string, any>();

    for (const b of badgeAnnouncements) {
      if (!b.discordId) continue;
      const member = badgeMembers.get(b.discordId);
      if (!member) continue;
      const dmText = b.type === "earned"
        ? `You earned the **${b.badgeLabel}** badge${b.qualifier ? ` for ${b.qualifier}` : ""}!`
        : `Your **${b.badgeLabel}** badge has been removed${b.reason ? ` — ${b.reason}` : ""}.`;
      await member.send({
        embeds: [new EmbedBuilder()
          .setTitle(b.type === "earned" ? "Badge Earned" : "Badge Removed")
          .setDescription(dmText)
          .setColor(b.type === "earned" ? 0xffd700 : 0x95a5a6)
        ]
      }).catch(() => undefined);
    }
  }

  // Post Can't Shut Up commissioner tiebreaker embed (wild_card → divisional only)
  if (eosLockData?.commissionerTiebreakers?.length) {
    const payoutsCh = eosLockData.pendingPayoutsChannelId
      ? await guild.channels.fetch(eosLockData.pendingPayoutsChannelId).catch(() => null) as TextChannel | null
      : null;
    if (payoutsCh?.type === ChannelType.GuildText) {
      for (const tb of eosLockData.commissionerTiebreakers as Array<{ pollId: string; categoryKey: string; categoryLabel: string; tiedUserIds: string[]; tiedDiscordIds: (string | null)[] }>) {
        try {
          const options = tb.tiedUserIds.map((uid, i) => {
            const mention = tb.tiedDiscordIds[i] ? `<@${tb.tiedDiscordIds[i]}>` : uid;
            return new StringSelectMenuOptionBuilder()
              .setLabel(mention.replace(/<@!?(\d+)>/, "User $1").slice(0, 100))
              .setDescription(`UserID: ${uid}`)
              .setValue(uid);
          }).slice(0, 25);
          const embed = new EmbedBuilder()
            .setTitle(`Commissioner Tiebreaker — ${tb.categoryLabel}`)
            .setDescription([
              `**"Can't Shut Up"** ended in a tie!`,
              "",
              `Tied candidates: ${tb.tiedDiscordIds.map((id) => id ? `<@${id}>` : "Unknown").join(", ")}`,
              "",
              "Select the winner below."
            ].join("\n"))
            .setColor(0xe74c3c);
          await payoutsCh.send({
            embeds: [embed],
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`eos_tiebreaker:cant_shut_up:${tb.pollId}`)
                .setPlaceholder("Select the winner")
                .addOptions(options)
            )],
            allowedMentions: { parse: ["users"] }
          }).catch(() => undefined);
        } catch (err) {
          console.error("[WIZARD] Failed to post tiebreaker embed:", err);
        }
      }
    }
  }

  // Send POTY/GOTY nomination DMs (regular season advances only, not week 18 → wild_card)
  if (nominationData?.sendNominationDms) {
    try {
      const weekNum: number = nominationData.weekNumber ?? weekNumber;

      const potyNominees = (nominationData.potyNominees ?? []) as Array<{ userId: string; discordId: string | null; displayName: string; highlightId: string; highlightUrl: string | null }>;
      const gotyNominees = (nominationData.gotyNominees ?? []) as Array<{ userId: string; discordId: string | null; displayName: string; gameId: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; label: string }>;

      const nomIds = [...new Set([...potyNominees, ...gotyNominees].map((c) => c.discordId).filter(Boolean))] as string[];
      const nomMembers = nomIds.length > 0
        ? await guild.members.fetch({ user: nomIds }).catch(() => new Map()) as Map<string, any>
        : new Map<string, any>();

      // POTY — Play of the Year: DM coaches who submitted a highlight this week
      for (const coach of potyNominees) {
        if (!coach.discordId) continue;
        const member = nomMembers.get(coach.discordId);
        if (!member) continue;
        try {
          await member.send({
            embeds: [new EmbedBuilder()
              .setTitle(`Play of the Year — Week ${weekNum} Nomination`)
              .setDescription([
                `Your highlight from **Week ${weekNum}** is eligible for a Play of the Year nomination!`,
                "",
                coach.highlightUrl ? `[View your highlight](${coach.highlightUrl})` : "",
                "",
                "Click below to nominate your play for POTY consideration.",
                "",
                "_Nominations are reviewed at the end of the season._"
              ].filter(Boolean).join("\n"))
              .setColor(0xf1c40f)
            ],
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`poty_nominate_own:${guild.id}:${coach.highlightId}`)
                .setLabel("Nominate My Play")
                .setStyle(ButtonStyle.Primary)
            )]
          }).catch(() => undefined);
        } catch { /* skip */ }
      }

      // GOTY — Game of the Year: DM coaches whose H2H game had ≤7pt margin
      for (const coach of gotyNominees) {
        if (!coach.discordId) continue;
        const member = nomMembers.get(coach.discordId);
        if (!member) continue;
        try {
          await member.send({
            embeds: [new EmbedBuilder()
              .setTitle(`Game of the Year — Week ${weekNum} Nomination`)
              .setDescription([
                "Your Week " + weekNum + " game was a close one! It's eligible for a Game of the Year nomination.",
                "",
                `**${coach.awayTeam}** @ **${coach.homeTeam}**`,
                `Final: **${coach.awayScore}** — **${coach.homeScore}**`,
                "",
                "Click below to nominate this game. You'll be asked to share what made it memorable."
              ].join("\n"))
              .setColor(0x3498db)
            ],
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`goty_nominate_btn:${guild.id}:${coach.gameId}`)
                .setLabel("Nominate This Game")
                .setStyle(ButtonStyle.Primary)
            )]
          }).catch(() => undefined);
        } catch { /* skip */ }
      }
    } catch (err) {
      console.error("[WIZARD] Nomination DMs failed:", err);
      warnings.push(`nomination_dms: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  advanceWizardSessions.delete(interaction.user.id);
  await interaction.editReply(buildWizardCompletePage(weekNumber, seasonStage, warnings));
}
