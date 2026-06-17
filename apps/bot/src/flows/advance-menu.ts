import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, type Interaction, type TextChannel } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildManageLeagueRows } from "../ui/menu.js";
import { ADVANCE_MENU_CUSTOM_IDS, buildTroubleshootMenuPanel } from "../ui/advance-menu.js";
import { DEFAULT_SCHEDULE_TIMEZONE } from "../ui/advance-schedule.js";
import { buildGotwSelectionPayload } from "../ui/gotw.js";
import { buildManageLeagueEmbed } from "./commissioner-tools.js";
import { postEosPollsAndAwards } from "./advance-wizard.js";
import { startAdvanceScheduleSession } from "./advance-schedule.js";
import { recreateGameChannelsForGuild, sendAdvanceDmsForGuild } from "./game-channels.js";
function normalizeEosDisplayValue(cat: any, value: unknown) {
  const numeric = Number(value);
  const isLongKick = String(cat.key ?? "").includes("long_fg") || /long fg|longest/i.test(String(cat.label ?? ""));
  if (isLongKick && Number.isFinite(numeric) && numeric > 100) return Math.round((numeric / 10) * 10) / 10;
  return value ?? "?";
}

function normalizeEosThresholdLabel(cat: any) {
  const isLongKick = String(cat.key ?? "").includes("long_fg") || /long fg|longest/i.test(String(cat.label ?? ""));
  if (isLongKick && Number(cat.thresholdValue) > 100) {
    const normalized = Math.round((Number(cat.thresholdValue) / 10) * 10) / 10;
    return `${String(cat.thresholdLabel ?? ">=").startsWith("<=") ? "<=" : ">="} ${normalized}`;
  }
  return cat.thresholdLabel ?? (cat.thresholdValue !== undefined && cat.thresholdValue !== null ? `${cat.thresholdValue}` : null);
}

function formatEosPayoutStatLine(cat: any, options: { includeEntityPosition?: boolean } = {}) {
  const entity = cat.entityName
    ? ` (${cat.entityName}${options.includeEntityPosition && cat.entityPosition ? ` · ${cat.entityPosition}` : cat.entityPosition ? ` · ${cat.entityPosition}` : ""})`
    : "";
  const tierLabel = cat.isFlat ? "Flat" : (cat.qualifiedTier ?? "Tier");
  const value = normalizeEosDisplayValue(cat, cat.qualifiedValue);
  const threshold = normalizeEosThresholdLabel(cat);
  const proof = cat.isFlat
    ? `Stat: ${value}`
    : `Stat: ${value}${threshold ? ` / Threshold: ${threshold}` : ""}`;
  return `• ${cat.label}${entity}: **$${cat.amount}** [${tierLabel}] — ${proof}`;
}

export async function handleAdvanceMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "The Advance Menu can only be used inside a Discord server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can use the Advance Menu.", flags: MessageFlags.Ephemeral });
    return;
  }

  const selected = interaction.values[0];
  if (selected === "back_admin") return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });

  await interaction.deferUpdate();

  if (selected === "advance_week") {
    await interaction.editReply(startAdvanceScheduleSession(interaction.user.id, { timezone: DEFAULT_SCHEDULE_TIMEZONE, wizardMode: true }));
    return;
  }

  if (selected === "troubleshoot_advance") {
    await interaction.editReply(buildTroubleshootMenuPanel());
    return;
  }

  if (selected === "run_eos_polls_and_awards") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Running EOS Polls & Awards...").setDescription("Generating nominees and posting community polls + REC Awards voting embeds.")], components: [] });
    try {
      const result = await recApi.runEosPollsAndAwards(interaction.guildId);
      if (!result.allowed) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Not Available").setDescription(result.reason ?? "This action is only available during Wild Card through Super Bowl weeks.")], components: buildManageLeagueRows() });
        return;
      }
      const guild = interaction.guild!;
      const warnings = [...(result.warnings ?? []), ...await postEosPollsAndAwards(guild, result.pollsData)];
      const pollCount = result.pollsData?.polls?.length ?? 0;
      const awardCount = result.pollsData?.recAwardsData?.awards?.filter((a: any) => a.status === "voting" && a.nomineeCount > 0).length ?? 0;
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Polls & Awards Posted").setDescription([
          `Community polls posted: **${pollCount}**`,
          `REC Award voting embeds posted: **${awardCount}**`,
          warnings.length ? `\nWarnings: ${warnings.join(", ")}` : ""
        ].filter(Boolean).join("\n"))],
        components: buildManageLeagueRows()
      });
    } catch (error) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Polls Failed").setDescription(error instanceof Error ? error.message : String(error))], components: buildManageLeagueRows() });
    }
    return;
  }

  if (selected === "issue_eos_payouts") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Issuing EOS Payouts...").setDescription("Computing stat thresholds and rank bonuses. Already approved payouts are preserved.")], components: [] });
    try {
      const result = await recApi.issueEosPayouts(interaction.guildId);
      const guild = interaction.guild;

      if (!guild) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("EOS Payouts Issued").setDescription(`Created ${result.items?.length ?? 0} payout items. Skipped ${result.skippedAlreadyIssued?.length ?? 0} already-issued payouts. Guild context unavailable for DMs.`)], components: buildManageLeagueRows() });
        return;
      }

      // Batch-fetch all payout recipients at once
      const payoutDiscordIds = (result.items ?? []).map((i: any) => i.discordId).filter(Boolean) as string[];
      const payoutMembers = payoutDiscordIds.length > 0
        ? await guild.members.fetch({ user: payoutDiscordIds }).catch(() => new Map()) as Map<string, any>
        : new Map<string, any>();

      let dmsSent = 0;

      for (const item of result.items ?? []) {
        if (!item.discordId) continue;
        try {
          const member = payoutMembers.get(item.discordId) ?? null;
          if (!member) continue;

          // Build breakdown lines for DM
          const breakdownLines: string[] = [];
          if (item.rankAmount > 0) {
            breakdownLines.push(`**${item.rankLabel ?? `Rank ${item.rank}`}:** $${item.rankAmount}`);
          }
          const statCategories: any[] = item.statCategories ?? [];
          if (statCategories.length > 0) {
            breakdownLines.push("", "**Stat Bonuses:**");
            for (const cat of statCategories) {
              const entityLabel = cat.entityName ? ` (${cat.entityName}${cat.entityPosition ? ` · ${cat.entityPosition}` : ""})` : "";
              const tierLabel = cat.isFlat ? "Flat" : cat.qualifiedTier;
              breakdownLines.push(formatEosPayoutStatLine(cat, { includeEntityPosition: true }));
            }
          }
          breakdownLines.push("", `**Total Payout: $${item.amount}**`);

          const rankLine = item.rank
            ? `You finished **Rank ${item.rank}** (${item.wins ?? 0}-${item.losses ?? 0}) in the regular season for **${result.serverName}**.`
            : `You earned stat bonuses this season in **${result.serverName}**.`;

          const dmEmbed = new EmbedBuilder()
            .setTitle("End of Season Payout")
            .setDescription([
              rankLine,
              "",
              ...breakdownLines,
              "",
              "Please approve or reject your payout below.",
              "_Rejecting will permanently cancel this payout._"
            ].join("\n"))
            .setColor(0xffd700);

          const dmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`eos_payout_approve:user:${item.id}`).setLabel("Approve Payout").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`eos_payout_reject:${item.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
          );

          await member.send({ embeds: [dmEmbed], components: [dmRow] }).then(() => dmsSent++).catch(() => undefined);
        } catch { /* DM failed — non-fatal */ }
      }

      // Post the public summary embed to the announcements channel (no action buttons there).
      if (result.announcementsChannelId) {
        try {
          const ch = await guild.channels.fetch(result.announcementsChannelId).catch(() => null) as TextChannel | null;
          if (ch?.type === ChannelType.GuildText) {
            const summaryLines = (result.items ?? []).map((item: any) => {
              const mention = item.discordId ? `<@${item.discordId}>` : item.displayName ?? item.teamName ?? "Unknown";
              const rankPart = item.rank ? `Rank ${item.rank} · ` : "";
              return `• ${mention} — ${rankPart}**$${item.amount}**`;
            });
            const skippedLines = (result.skippedAlreadyIssued ?? []).map((item: any) => {
              const mention = item.discordId ? `<@${item.discordId}>` : item.displayName ?? item.teamName ?? "Unknown";
              const changed = Number(item.recalculatedAmount ?? item.originalAmount ?? 0) !== Number(item.originalAmount ?? 0)
                ? `; current recalculation would be $${item.recalculatedAmount}`
                : "";
              return `- ${mention} - already issued **$${item.originalAmount}**${changed}`;
            });
            const headerEmbed = new EmbedBuilder()
              .setTitle("EOS Payouts Issued")
              .setDescription([
                `**Season ${result.seasonNumber}** payouts have been issued. Each recipient must approve via DM, and a commissioner must approve in the pending payouts channel.`,
                "",
                summaryLines.length ? "**New Pending Payouts**" : "**New Pending Payouts:** None",
                ...summaryLines,
                ...(skippedLines.length ? ["", "**Skipped Already-Issued Payouts**", ...skippedLines] : [])
              ].join("\n"))
              .setColor(0x5865f2);
            await ch.send({ embeds: [headerEmbed] }).catch(() => undefined);
          }
        } catch { /* non-fatal */ }
      }

      // Post the per-coach commissioner approve/reject panels to the PENDING PAYOUTS channel
      // (falls back to announcements only if no pending payouts channel is configured).
      const approvalChannelId = result.pendingPayoutsChannelId ?? result.announcementsChannelId;
      let removedOldEmbeds = 0;
      if (approvalChannelId) {
        try {
          for (const ref of result.supersededMessages ?? []) {
            try {
              const oldCh = await guild.channels.fetch(ref.discordChannelId).catch(() => null) as TextChannel | null;
              if (oldCh?.type !== ChannelType.GuildText) continue;
              const oldMsg = await oldCh.messages.fetch(ref.discordMessageId).catch(() => null);
              if (!oldMsg) continue;
              await oldMsg.delete().catch(() => undefined);
              removedOldEmbeds++;
            } catch { /* non-fatal cleanup */ }
          }

          const ch = await guild.channels.fetch(approvalChannelId).catch(() => null) as TextChannel | null;
          if (ch?.type === ChannelType.GuildText) {
            await ch.send({ embeds: [new EmbedBuilder()
              .setTitle("EOS Payout Approvals — Commissioner Action Required")
              .setDescription(`**Season ${result.seasonNumber}** payouts. Approve or reject each below. Funds credit only after both the recipient (via DM) and a commissioner approve.`)
              .setColor(0x5865f2)] }).catch(() => undefined);

            // One approval message per coach
            for (const item of result.items ?? []) {
              const mention = item.discordId ? `<@${item.discordId}>` : item.displayName ?? item.teamName ?? "Unknown";
              const statCategories: any[] = item.statCategories ?? [];
              const breakdownLines: string[] = [];
              if (item.rankAmount > 0) breakdownLines.push(`**${item.rankLabel ?? `Rank ${item.rank}`}:** $${item.rankAmount}`);
              if (statCategories.length > 0) {
                breakdownLines.push("Stat Bonuses:");
                for (const cat of statCategories.slice(0, 15)) {
                  const entity = cat.entityName ? ` (${cat.entityName})` : "";
                  breakdownLines.push(`  ${formatEosPayoutStatLine(cat)}`);
                }
                if (statCategories.length > 15) breakdownLines.push(`  ...and ${statCategories.length - 15} more`);
              }

              const itemEmbed = new EmbedBuilder()
                .setDescription([
                  `${mention} — **Total: $${item.amount}**`,
                  ...breakdownLines
                ].join("\n"))
                .setColor(0x57f287);

              const itemRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`eos_payout_approve:commissioner:${item.id}`).setLabel(`Approve $${item.amount}`).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`eos_payout_reject:${item.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
              );

              const commMsg = await ch.send({ embeds: [itemEmbed], components: [itemRow] }).catch(() => null);
              if (commMsg && item.id) {
                recApi.recordEosPayoutMessage({ itemId: item.id, discordChannelId: ch.id, discordMessageId: commMsg.id }).catch(() => undefined);
              }
            }
          }
        } catch { /* non-fatal */ }
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Payouts Issued").setDescription([
          `Payout items created: **${result.items?.length ?? 0}**`,
          `Already-issued payouts skipped: **${result.skippedAlreadyIssued?.length ?? 0}**`,
          `Superseded pending embeds removed: **${removedOldEmbeds}**`,
          `DMs sent: **${dmsSent}**`,
          "",
          "Each payout requires both recipient and commissioner approval before funds are credited."
        ].join("\n"))],
        components: buildManageLeagueRows()
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Payout Failed").setDescription(error instanceof Error ? error.message : String(error))],
        components: buildManageLeagueRows()
      });
    }
    return;
  }

  await interaction.editReply({ embeds: [buildManageLeagueEmbed()], components: buildManageLeagueRows() });
}

export async function handleTroubleshootMenuSelect(interaction: Extract<Interaction, { isStringSelectMenu(): boolean }>) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "This can only be used inside a Discord server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isDiscordAdminInteraction(interaction)) {
    await interaction.reply({ content: "Only authorized admins can use these tools.", flags: MessageFlags.Ephemeral });
    return;
  }

  const selected = interaction.values[0];
  if (selected === "back_manage_league" || selected === "back_advance_menu") {
    return interaction.update({ embeds: [buildManageLeagueEmbed()], components: buildManageLeagueRows() });
  }

  await interaction.deferUpdate();

  if (selected === "set_next_advance") {
    await interaction.editReply(startAdvanceScheduleSession(interaction.user.id));
    return;
  }

  if (selected === "reselect_gotw") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading GOTW Candidates...").setDescription("Fetching matchup data to re-select the Game of the Week.")], components: [] });
    const result = await recApi.getGotwCandidates(interaction.guildId);
    const stage = result?.stage ?? "regular_season";
    if (stage !== "regular_season") {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Re-Select GOTW").setDescription("GOTW selection is only required during the regular season. Playoff and Super Bowl games are automatically treated as GOTW.")],
        components: buildTroubleshootMenuPanel().components
      });
      return;
    }
    if (!result?.candidates?.length) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Re-Select GOTW").setDescription("No User H2H matchups were found for the current week, so there is no GOTW to select.")],
        components: buildTroubleshootMenuPanel().components
      });
      return;
    }
    await interaction.editReply(buildGotwSelectionPayload(result.candidates, {
      backCustomId: ADVANCE_MENU_CUSTOM_IDS.troubleshootBack,
      backLabel: "Back to Troubleshoot"
    }));
    return;
  }

  if (selected === "regenerate_challenges") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Regenerating Challenges...").setDescription("Voiding current challenges and generating new ones. Please wait.")], components: [] });
    const result = await recApi.regenerateWeeklyChallenges(interaction.guildId);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Weekly Challenges Re-Generated")
          .setDescription([
            `Challenges generated: **${result?.count ?? result?.challenges?.length ?? 0}**`,
            "",
            "Current active challenges were voided before new ones were created."
          ].join("\n"))
      ],
      components: buildTroubleshootMenuPanel().components
    });
    return;
  }

  if (selected === "regenerate_potw") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Re-Generate POTW").setDescription("This feature is coming soon.")], components: buildTroubleshootMenuPanel().components });
    return;
  }

  if (selected === "recreate_game_channels") {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: "Game channels can only be recreated inside a Discord server.", embeds: [], components: [] });
      return;
    }
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Recreating Game Channels...").setDescription("Deleting old channels and rebuilding all active H2H game channels.")], components: [] });
    const result = await recreateGameChannelsForGuild(guild);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Game Channels Re-Created")
          .setDescription([
            "Deleted old active game channels and recreated current H2H matchup channels.",
            "",
            `Created: **${result.created?.length ?? 0}**`
          ].join("\n"))
      ],
      components: buildTroubleshootMenuPanel().components
    });
    return;
  }

  if (selected === "send_advance_dms") {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Re-Send Advance DMs").setDescription("This action requires a guild context.")], components: buildTroubleshootMenuPanel().components });
      return;
    }
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Sending Advance DMs...").setDescription("Sending DMs to all active players and creating game channels. This may take a moment.")], components: [] });
    let dmSummary: string[];
    try {
      const dmResult = await sendAdvanceDmsForGuild(guild);
      dmSummary = [
        `DMs sent: ${dmResult.sent} (failed: ${dmResult.failed})`,
        `Game channels created: ${dmResult.gameChannels.created.length} of ${dmResult.gameChannels.totalPlans}`,
        ...(dmResult.gameChannels.skipped.length ? [`Game channels skipped: ${dmResult.gameChannels.skipped[0].reason}`] : [])
      ];
    } catch (error) {
      console.error("Re-Send Advance DMs failed", error);
      dmSummary = ["DMs/game channels failed — check logs or use Recreate Game Channels to retry."];
    }
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Advance DMs Sent").setDescription(dmSummary.join("\n"))],
      components: buildTroubleshootMenuPanel().components
    });
    return;
  }

  if (selected === "audit_repair_records") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Auditing & Repairing Records...").setDescription("Rebuilding W/L/T records from all logged game results. This may take a moment.")], components: [] });
    try {
      const result = await recApi.auditRepairRecords(interaction.guildId);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Records Audit & Repair Complete")
            .setDescription([
              "Records have been recalculated from all logged game results.",
              "",
              `Season records repaired: **${result.seasonRecordsRepaired}**`,
              `League-wide records repaired: **${result.leagueRecordsRepaired}**`,
              `H2H pairs repaired: **${result.h2hPairsRepaired}**`,
              `Games marked applied: **${result.gamesMarkedApplied}**`,
              "",
              "_Safe to run multiple times — totals are rebuilt from scratch each run._"
            ].join("\n"))
        ],
        components: buildTroubleshootMenuPanel().components
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Records Repair Failed").setDescription(error instanceof Error ? error.message : String(error))],
        components: buildTroubleshootMenuPanel().components
      });
    }
    return;
  }

  if (selected === "recalculate_eos_payouts") {
    await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Calculating EOS Payouts...").setDescription("Fetching season standings and projecting end-of-season payouts.")], components: [] });
    try {
      const preview = await recApi.previewEosPayouts(interaction.guildId);
      const lines = [
        `**EOS Payout Preview — Season ${preview.seasonNumber}** (Week ${preview.weekNumber})`,
        `Total projected: **$${preview.totalPayout}**`,
        "",
        ...(preview.items ?? []).slice(0, 16).map((item: any) => {
          const mention = item.discordId ? `<@${item.discordId}>` : `User ${String(item.userId).slice(0, 8)}`;
          const record = `${item.wins}-${item.losses}-${item.ties}`;
          return `**${item.rank}.** ${mention} (${record}) — ${item.payoutLabel}: **$${item.projectedPayout}**`;
        })
      ];
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Payout Preview").setDescription(lines.join("\n").slice(0, 4000))],
        components: buildTroubleshootMenuPanel().components
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("EOS Preview Failed").setDescription(error instanceof Error ? error.message : String(error))],
        components: buildTroubleshootMenuPanel().components
      });
    }
    return;
  }

  // set_week falls through to the label handler below
  const labels: Record<string, string> = {
    set_week: "Set Current Week / Stage"
  };
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(labels[selected] ?? "Troubleshoot Advance").setDescription("This repair action is connected and will be expanded in the next build pass.")],
    components: buildTroubleshootMenuPanel().components
  });
}

