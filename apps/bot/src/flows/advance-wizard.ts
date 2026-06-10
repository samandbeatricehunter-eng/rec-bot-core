import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Guild, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildMainMenuEmbed, buildMainMenuRows } from "../ui/menu.js";
import { buildGotwAnnouncementContent, buildGotwVoteEmbed, buildGotwVoteRows } from "../ui/gotw.js";
import { recApi } from "../lib/rec-api.js";
import { ExpiringSessionStore } from "../lib/session-timeout.js";
import { wallClockToUtc } from "../ui/advance-schedule.js";
import { sendAdvanceDmsForGuild } from "./game-channels.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";

export const ADVANCE_WIZARD_GOTW_CUSTOM_ID = "rec:advance_wizard:gotw";

interface AdvanceWizardState {
  weekNumber: number;
  seasonStage: string;
  warnings: string[];
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
        .setTitle(`Step 4 of 5 — Select Week ${weekNumber} Game of the Week`)
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
      "Step 2 of 5 — Processing Results",
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

  // Step 3: POTW
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 3 of 5 — POTW Awards",
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
  } catch (err) {
    console.error("[WIZARD] processPotwAward failed:", err);
    allWarnings.push(`potw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: GOTW (regular season only)
  const isRegularSeason = newStage === "regular_season";
  if (isRegularSeason) {
    await interaction.editReply({
      embeds: [processingEmbed(
        "Step 4 of 5 — Game of the Week",
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

    advanceWizardSessions.set(interaction.user.id, { weekNumber: newWeek, seasonStage: newStage, warnings: allWarnings });

    if (candidates.length) {
      await interaction.editReply(buildWizardGotwSelectionPayload(candidates, newWeek));
    } else {
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("Step 4 of 5 — No GOTW Matchups")
          .setDescription("No H2H matchups found for this week. Skipping GOTW selection and proceeding to finalize.")],
        components: []
      });
      await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings);
    }
    return;
  }

  // Playoffs/super bowl: skip GOTW
  advanceWizardSessions.set(interaction.user.id, { weekNumber: newWeek, seasonStage: newStage, warnings: allWarnings });
  await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings);
}

export async function handleWizardGotwSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only admins can perform this action.", ephemeral: true });
    return;
  }
  await interaction.deferUpdate();

  const wizardState = advanceWizardSessions.get(interaction.user.id);
  const candidateId = interaction.values[0];
  const guild = interaction.guild;

  // Select the GOTW and post the poll
  let newWeek = wizardState?.weekNumber ?? 0;
  let newStage = wizardState?.seasonStage ?? "regular_season";
  const allWarnings = wizardState?.warnings ?? [];

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

  await runAdvanceWizardFinalize(interaction, guild, newWeek, newStage, allWarnings);
}

async function runAdvanceWizardFinalize(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  guild: Guild,
  weekNumber: number,
  seasonStage: string,
  warnings: string[]
) {
  await interaction.editReply({
    embeds: [processingEmbed(
      "Step 5 of 5 — Finalizing",
      "Generating weekly challenges, gathering all data and sending advance notice DMs..."
    )],
    components: []
  });

  // Generate challenges
  try {
    const finalizeData = await recApi.finalizeAdvanceStep(guild.id);
    warnings.push(...(finalizeData.warnings ?? []));
  } catch (err) {
    console.error("[WIZARD] finalizeAdvanceStep failed:", err);
    warnings.push(`generate_challenges: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Send DMs and create game channels
  try {
    await sendAdvanceDmsForGuild(guild);
  } catch (err) {
    console.error("[WIZARD] sendAdvanceDmsForGuild failed:", err);
    warnings.push(`advance_dms: ${err instanceof Error ? err.message : String(err)}`);
  }

  advanceWizardSessions.delete(interaction.user.id);
  await interaction.editReply(buildWizardCompletePage(weekNumber, seasonStage, warnings));
}
