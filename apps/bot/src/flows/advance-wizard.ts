import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildMainMenuEmbed, buildMainMenuRows } from "../ui/menu.js";
import { buildGotwAnnouncementContent, buildGotwVoteEmbed, buildGotwVoteRows } from "../ui/gotw.js";
import { buildPowerRankingsEmbeds } from "../ui/power-rankings.js";
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
  const parts: string[] = [];
  if (side === "offense") {
    const passYds = asNumber(stats.passYds);
    const passTDs = asNumber(stats.passTDs);
    const passInts = asNumber(stats.passInts);
    const rushYds = asNumber(stats.rushYds);
    const rushTDs = asNumber(stats.rushTDs);
    const recYds = asNumber(stats.recYds);
    const recTDs = asNumber(stats.recTDs);
    if (passYds > 0) parts.push(`${passYds} pass yds, ${passTDs} TDs, ${passInts} INTs`);
    if (rushYds > 0) parts.push(`${rushYds} rush yds${rushTDs > 0 ? `, ${rushTDs} TDs` : ""}`);
    if (recYds > 0) parts.push(`${recYds} rec yds${recTDs > 0 ? `, ${recTDs} TDs` : ""}`);
  } else {
    const sacks = asNumber(stats.defSacks);
    const ints = asNumber(stats.defInts);
    const ff = asNumber(stats.defForcedFum);
    const tackles = asNumber(stats.defTackles ?? stats.tackles);
    const tfl = asNumber(stats.defTFL ?? stats.tacklesForLoss);
    if (sacks > 0) parts.push(`${sacks} sacks`);
    if (ints > 0) parts.push(`${ints} INTs`);
    if (ff > 0) parts.push(`${ff} forced fumbles`);
    if (tackles > 0) parts.push(`${tackles} tackles`);
    if (tfl > 0) parts.push(`${tfl} TFL`);
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

  let devUpgradePrizes: any[] = [];
  try {
    const finalizeData = await recApi.finalizeAdvanceStep(guild.id);
    warnings.push(...(finalizeData.warnings ?? []));
    devUpgradePrizes = finalizeData.devUpgradePrizes?.prizes ?? [];
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
    for (const b of badgeAnnouncements) {
      if (!b.discordId) continue;
      try {
        const member = await guild.members.fetch(b.discordId).catch(() => null);
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
      } catch { /* skip individual DM failures */ }
    }
  }

  // Post EOS award polls — one message per category (fires on regular_season → wild_card only)
  if (eosPollsData?.polls?.length && eosPollsData.announcementsChannelId) {
    try {
      const pollCh = await guild.channels.fetch(eosPollsData.announcementsChannelId).catch(() => null) as TextChannel | null;
      if (pollCh?.type === ChannelType.GuildText) {
        const { polls, nominees, closesAt } = eosPollsData;

        const nomineeOptions = nominees
          .filter((n: EosPollNominee) => n.discordId)
          .slice(0, 25)
          .map((n: EosPollNominee) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(n.displayName.slice(0, 100))
              .setValue(n.discordId!)
          );

        if (nomineeOptions.length > 0) {
          const closeTimeStr = closesAt
            ? `Voting closes <t:${Math.floor(new Date(closesAt).getTime() / 1000)}:R>`
            : "Voting closes when playoffs begin.";

          for (const poll of polls) {
            const embed = new EmbedBuilder()
              .setTitle(`🏆 ${poll.categoryLabel}`)
              .setDescription(
                [
                  poll.categoryDescription ?? "",
                  "",
                  closeTimeStr,
                  "",
                  "_Only linked coaches may vote. You may change your vote before voting closes._"
                ].join("\n")
              )
              .setColor(0x9b59b6);

            const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`eos_vote:${poll.id}:${poll.categoryKey}`)
                .setPlaceholder(`Vote for ${poll.categoryLabel}`)
                .addOptions(nomineeOptions)
            );

            await pollCh.send({ embeds: [embed], components: [row] }).catch((e) =>
              console.error("[WIZARD] Failed to post EOS poll:", e)
            );
          }
        }
      }
    } catch (err) {
      console.error("[WIZARD] EOS poll posting failed:", err);
      warnings.push(`eos_polls: ${err instanceof Error ? err.message : String(err)}`);
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

  // Post dev upgrade prize announcements to announcements channel
  if (devUpgradePrizes.length > 0 && announcementsChannelId) {
    try {
      const ch = await guild.channels.fetch(announcementsChannelId).catch(() => null) as TextChannel | null;
      if (ch?.type === ChannelType.GuildText) {
        const lines = devUpgradePrizes.map((p: any) => {
          const mention = p.discord_id ? `<@${p.discord_id}>` : p.player_name ?? "A player";
          return `${mention}'s **${p.player_name ?? "player"}** upgraded from **${p.old_dev_trait}** → **${p.new_dev_trait}** (+$${p.prize_amount})!`;
        });
        await ch.send({
          embeds: [new EmbedBuilder()
            .setTitle("Dev Upgrade Prizes")
            .setDescription(lines.join("\n"))
            .setColor(0xf1c40f)
          ],
          allowedMentions: { parse: ["users"] }
        }).catch(() => undefined);
      }
    } catch (err) {
      console.error("[WIZARD] Dev upgrade announcement failed:", err);
    }
  }

  // Send POTY/GOTY nomination DMs (regular season advances only, not week 18 → wild_card)
  if (nominationData?.sendNominationDms) {
    try {
      const weekNum: number = nominationData.weekNumber ?? weekNumber;

      // POTY — Play of the Year: DM coaches who submitted a highlight this week
      for (const coach of (nominationData.potyNominees ?? []) as Array<{ userId: string; discordId: string | null; displayName: string; highlightId: string; highlightUrl: string | null }>) {
        if (!coach.discordId) continue;
        try {
          const member = await guild.members.fetch(coach.discordId).catch(() => null);
          if (!member) continue;

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
      for (const coach of (nominationData.gotyNominees ?? []) as Array<{ userId: string; discordId: string | null; displayName: string; gameId: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; label: string }>) {
        if (!coach.discordId) continue;
        try {
          const member = await guild.members.fetch(coach.discordId).catch(() => null);
          if (!member) continue;

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
