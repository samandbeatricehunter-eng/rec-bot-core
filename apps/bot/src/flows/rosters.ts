import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { formatTierEmojiPrefix } from "../lib/tier-emojis.js";
import {
  buildMaddenTeamsEmbed,
  buildMaddenTeamsRows,
  buildOpenTeamsEmbeds,
  buildSnapshotConferenceSelectRows,
  buildSnapshotTeamSelectRows,
  MENU_CUSTOM_IDS,
  ROSTERS_CUSTOM_IDS,
  type MaddenTeamsPage
} from "../ui/menu.js";

type MainMenuPayloadBuilder = (userId: string, guildId: string | null, isAdmin: boolean) => Promise<any>;
type SnapshotSession = { targetDiscordId: string; targetDisplayName: string; currentPage: number };

const snapshotSessions = new Map<string, SnapshotSession>();

export async function renderTeamsMenu(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Teams...").setDescription("Fetching league teams, linked users, and open team slots.")], components: [] });
  if (!interaction.guildId) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Teams").setDescription("Must be run inside a league server.")], components: buildMaddenTeamsRows() });
  }

  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: any[] = confData?.conferences ?? [];
  const hasTeams = conferences.some((c) => (c.divisions ?? []).some((d: any) => (d.teams ?? []).length));
  if (!hasTeams) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Teams").setDescription("No teams found for this league yet.")], components: buildMaddenTeamsRows() });
  }

  const page = conferences.some((conference) => conference.conference === "NFC") ? "NFC" : String(conferences[0]?.conference ?? "Teams");
  return interaction.editReply({
    embeds: [buildMaddenTeamsEmbed(conferences, page)],
    components: buildMaddenTeamsRows(page, conferences)
  });
}

export async function handleTeamsPage(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Teams...").setDescription("Switching conferences and refreshing linked/open teams.")], components: [] });
  if (!interaction.guildId) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Teams").setDescription("Must be run inside a league server.")], components: buildMaddenTeamsRows("NFC") });
  }
  const page = interaction.isStringSelectMenu() ? interaction.values[0] ?? "NFC" : interaction.customId.slice(`${MENU_CUSTOM_IDS.teamsPage}:`.length) || "NFC";
  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: any[] = confData?.conferences ?? [];
  return interaction.editReply({
    embeds: [buildMaddenTeamsEmbed(conferences, page as MaddenTeamsPage)],
    components: buildMaddenTeamsRows(page as MaddenTeamsPage, conferences)
  });
}

export async function handlePostOpenTeams(interaction: ButtonInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({ content: "Must be run inside a league server.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.channel?.isTextBased() || !("send" in interaction.channel)) {
    return interaction.reply({ content: "I can't post in this channel.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: any[] = confData?.conferences ?? [];
  const embeds = buildOpenTeamsEmbeds(conferences);

  for (let i = 0; i < embeds.length; i += 10) {
    await interaction.channel.send({ embeds: embeds.slice(i, i + 10) });
  }
  return interaction.editReply({ content: "Posted open teams to this channel." });
}

export async function renderUserSnapshotPicker(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading User Profiles...").setDescription("Fetching linked teams so you can choose a coach profile.")], components: [] });
  if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("User Profiles").setDescription("This must be run inside a league server.")], components: [] });
  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: any[] = confData?.conferences ?? [];
  const hasLinkedTeams = conferences.some((c) => (c.divisions ?? []).some((d: any) => (d.teams ?? []).some((team: any) => team.linkedDiscordId)));
  if (!hasLinkedTeams) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("User Profiles").setDescription("No linked coaches found in this league. Team assignments must be configured first.")], components: buildSnapshotConferenceSelectRows([]) });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("User Profiles").setDescription("Select a conference below to view linked user teams in that conference.")],
    components: buildSnapshotConferenceSelectRows(conferences)
  });
}

export async function handleSnapshotConferenceSelect(interaction: StringSelectMenuInteraction, buildMainMenuPayload: MainMenuPayloadBuilder) {
  const selected = interaction.values[0];
  if (selected === "profiles_back_menu") {
    return interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
  }
  await interaction.deferUpdate();
  if (!interaction.guildId) return;
  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: any[] = confData?.conferences ?? [];
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle(`${selected} User Profiles`).setDescription("Select a linked team below to open that user's paginated profile.")],
    components: buildSnapshotTeamSelectRows(conferences, selected)
  });
}

export async function handleSnapshotTeamSelect(interaction: StringSelectMenuInteraction) {
  const selected = interaction.values[0];
  if (selected === "profiles_back") return renderUserSnapshotPicker(interaction);
  return handleSnapshotUserSelect(interaction);
}

function buildSnapshotNavRows(currentPage: number, totalPages: number) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotBack).setLabel("Back to Profiles").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotPrev).setLabel("Prev").setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotNext).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages - 1)
  );
  return [row];
}

function formatBadgeLines(badges: any[]) {
  if (!badges.length) return "No badges earned yet.";
  return badges.map((badge) => {
    const name = badge.badge_label ?? badge.badge_name ?? "Badge";
    const tier = formatTierEmojiPrefix(badge.tier);
    const earned = badge.earned_at ? ` - ${new Date(badge.earned_at).toLocaleDateString("en-US")}` : "";
    const desc = badge.badge_description ? ` *(${badge.badge_description})*` : "";
    return `- ${tier}${name}${earned}${desc}`;
  }).join("\n");
}

function formatWeeklyBadgeLines(badges: any[]) {
  if (!badges.length) return "No weekly badges earned this season.";

  const active = badges.filter((b) => (b.current_streak ?? 0) > 0);
  const inactive = badges.filter((b) => (b.current_streak ?? 0) === 0);

  const lines: string[] = [];

  if (active.length) {
    lines.push("**Active Streaks**");
    for (const badge of active.sort((a, b) => (b.current_streak ?? 0) - (a.current_streak ?? 0))) {
      const name = badge.badge_label ?? badge.badge_name ?? "Badge";
      const tier = formatTierEmojiPrefix(badge.tier);
      const streak = badge.current_streak ?? 1;
      const streakLabel = streak > 1 ? ` — ${streak}-week streak` : "";
      const desc = badge.badge_description ? ` *(${badge.badge_description})*` : "";
      lines.push(`- ${tier}${name}${streakLabel}${desc}`);
    }
  }

  if (inactive.length) {
    if (lines.length) lines.push("");
    lines.push("**Streak Lost**");
    for (const badge of inactive) {
      const name = badge.badge_label ?? badge.badge_name ?? "Badge";
      const lastWeek = badge.last_earned_week != null ? ` — last earned Wk ${badge.last_earned_week}` : "";
      const desc = badge.badge_description ? ` *(${badge.badge_description})*` : "";
      lines.push(`- ${name}${lastWeek}${desc}`);
    }
  }

  return lines.join("\n");
}

function formatStatBlock(stats: any, prefix: "Season" | "Career") {
  if (!stats || stats.gamesLogged === 0) {
    return "No box score stats logged yet.";
  }

  const label = prefix === "Career" ? "Career" : "Season";
  return [
    `Games Logged: **${stats.gamesLogged}**`,
    "",
    `**${label} Total Yards:** ${stats.totalYards.toLocaleString()} | **${label} Total YPG:** ${stats.totalYardsAvg}`,
    `**${label} Passing Yards:** ${stats.passingYards.toLocaleString()} | **${label} Passing YPG:** ${stats.passingYardsAvg}`,
    `**${label} Rushing Yards:** ${stats.rushingYards.toLocaleString()} | **${label} Rushing YPG:** ${stats.rushingYardsAvg}`,
    `**${label} First Downs:** ${stats.firstDowns.toLocaleString()} | **${label} First Downs/G:** ${stats.firstDownsAvg}`,
    `**${label} Turnovers Generated:** ${stats.turnoversGenerated.toLocaleString()} | **${label} TO Generated/G:** ${stats.turnoversGeneratedAvg}`,
    `**${label} Turnovers Committed:** ${stats.turnoversCommitted.toLocaleString()} | **${label} TO Committed/G:** ${stats.turnoversCommittedAvg}`,
    `**${label} Turnover Differential:** ${stats.turnoverDifferential.toLocaleString()} | **${label} TO Diff/G:** ${stats.turnoverDifferentialAvg}`,
    `**${label} Red Zone % (Off):** ${stats.redZoneOffPct}% | **${label} Red Zone % (Def):** ${stats.redZoneDefPct}%`,
  ].join("\n");
}

function formatFinancialBlock(scopeLabel: string, summary: any) {
  if (!summary) return "No financial activity recorded yet.";
  const purchases = summary.purchases ?? {};
  return [
    `**Total Cash Earned (${scopeLabel}):** $${summary.totalEarned.toLocaleString()}`,
    `**Total Cash Spent (${scopeLabel}):** $${summary.totalSpent.toLocaleString()}`,
    `**Total Profit/Deficit (${scopeLabel}):** $${summary.profitDeficit.toLocaleString()}`,
    `**Avg Cash Earned / Week (${scopeLabel}):** $${summary.avgEarnedPerWeek.toLocaleString()}`,
    `**Avg Cash Spent / Week (${scopeLabel}):** $${summary.avgSpentPerWeek.toLocaleString()}`,
    "",
    `Legends / Custom Players (${scopeLabel}): **${purchases.legends ?? 0}** / **${purchases.customPlayers ?? 0}**`,
    `Attributes — Core / Non-Core (${scopeLabel}): **${purchases.coreAttributes ?? 0}** / **${purchases.nonCoreAttributes ?? 0}**`,
    `Age Resets / Dev Ups / Contracts (${scopeLabel}): **${purchases.ageResets ?? 0}** / **${purchases.devUps ?? 0}** / **${purchases.contracts ?? 0}**`,
  ].join("\n");
}

function buildSnapshotPages(snapshot: any, currentPage: number): { embed: EmbedBuilder; totalPages: number } {
  const pages: EmbedBuilder[] = [];
  const sr = snapshot.seasonRecord ?? {};
  const gr = snapshot.globalRecord ?? {};
  const ggr = snapshot.gameGlobalRecord ?? null;
  const gameLabel = ggr?.label ?? "Madden NFL 26";
  const pr = snapshot.powerRank;
  const gg = snapshot.gotwGuessing;
  const gc = snapshot.gotwCompetition;
  const coachName = snapshot.discord?.global_name ?? snapshot.user?.display_name ?? "Coach";

  pages.push(new EmbedBuilder()
    .setTitle(`${coachName} - Snapshot`)
    .setDescription([
      `Team: **${snapshot.teamName ?? "Unassigned"}**`,
      `League: ${snapshot.leagueName ?? "Unknown"} - Season ${snapshot.seasonNumber ?? "?"}, Week ${snapshot.currentWeek ?? "?"}`,
      "",
      "**Season Record (This Guild)**",
      `W-L-T: **${sr.text ?? "0-0-0"}** | PD: **${sr.pointDifferential ?? 0}**`,
      `Points For: ${sr.pointsFor ?? 0} | Points Against: ${sr.pointsAgainst ?? 0}`,
      `Box Scores Uploaded: **${sr.boxScoresUploaded ?? 0}**`,
      `Active Season Streak: **${sr.activeStreak ?? "—"}**`,
      "",
      "**Global Record (All Games — Official)**",
      `W-L-T: **${gr.text ?? "0-0-0"}** | PD: **${gr.pointDifferential ?? 0}**`,
      `Playoffs: ${gr.playoffText ?? "0-0"} | Super Bowls: ${gr.superbowlText ?? "0-0"}`,
      `Active Global Streak: **${gr.activeStreak ?? "—"}**`,
      ggr
        ? [
            "",
            `**Global Record (${gameLabel} — Official)**`,
            `W-L-T: **${ggr.text ?? "0-0-0"}** | PD: **${ggr.pointDifferential ?? 0}**`,
            `Playoffs: ${ggr.playoffText ?? "0-0"} | Super Bowls: ${ggr.superbowlText ?? "0-0"}`,
          ].join("\n")
        : "",
      "",
      "**Power Ranking**",
      pr ? `Rank: **#${pr.rank}** | Score: ${(pr.score ?? 0).toFixed(2)} | SOS: ${(pr.sosScore ?? 0).toFixed(2)}` : "Not yet ranked this season",
      "",
      "**GOTW Voting Record (Global)**",
      gg ? `${gg.correct}/${gg.total} correct (${gg.accuracy}%)` : "No votes recorded yet",
      "",
      "**GOTW Competitor Record (This Guild)**",
      gc ? `${gc.wins}W-${gc.losses}L as a GOTW participant` : "No GOTW games played yet",
    ].join("\n").slice(0, 4096)));

  pages.push(new EmbedBuilder()
    .setTitle(`${coachName} - Season Stats`)
    .setDescription(formatStatBlock(snapshot.seasonStats, "Season").slice(0, 4096)));

  pages.push(new EmbedBuilder()
    .setTitle(`${coachName} - Weekly Badges`)
    .setDescription(formatWeeklyBadgeLines(snapshot.weeklyBadges ?? []).slice(0, 4096)));

  pages.push(new EmbedBuilder()
    .setTitle(`${coachName} - Season Badges`)
    .setDescription(formatBadgeLines(snapshot.seasonBadges ?? []).slice(0, 4096)));

  pages.push(new EmbedBuilder()
    .setTitle(`${coachName} - Career Stats`)
    .setDescription(formatStatBlock(snapshot.careerStats, "Career").slice(0, 4096)));

  pages.push(new EmbedBuilder()
    .setTitle(`${coachName} - Global Badges`)
    .setDescription(formatBadgeLines(snapshot.globalBadges ?? []).slice(0, 4096)));

  const awards: any[] = snapshot.globalAwards ?? [];
  pages.push(new EmbedBuilder()
    .setTitle(`${coachName} - Global Awards`)
    .setDescription(
      awards.length
        ? awards.map((award) => `- **${award.awardName}** — ${award.count}`).join("\n").slice(0, 4096)
        : "No global awards won yet."
    ));

  const financial = snapshot.financialSummary ?? {};
  pages.push(new EmbedBuilder()
    .setTitle(`${coachName} - Financial Stats`)
    .setDescription([
      formatFinancialBlock("This League", financial.league),
      "",
      formatFinancialBlock("Global", financial.global),
    ].join("\n").slice(0, 4096)));

  const totalPages = pages.length;
  const safeIndex = Math.max(0, Math.min(currentPage, totalPages - 1));
  const embed = pages[safeIndex];
  embed.setFooter({ text: `Page ${safeIndex + 1} of ${totalPages}` });
  return { embed, totalPages };
}

export async function handleSnapshotUserSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Profile...").setDescription("Fetching this coach's record, wallet context, badges, awards, and matchup history.")], components: [] });
  if (!interaction.guildId) return;
  const targetDiscordId = interaction.values[0];
  const snapshot = await recApi.getUserSnapshot(targetDiscordId, interaction.guildId).catch(() => null);
  if (!snapshot) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Profile Unavailable").setDescription("Could not load this user's profile. They may not be fully linked.")], components: buildSnapshotConferenceSelectRows([]) });
  }

  const displayName = snapshot.discord?.global_name ?? snapshot.user?.display_name ?? "Coach";
  snapshotSessions.set(interaction.user.id, { targetDiscordId, targetDisplayName: displayName, currentPage: 0 });

  const { embed, totalPages } = buildSnapshotPages(snapshot, 0);
  return interaction.editReply({ embeds: [embed], components: buildSnapshotNavRows(0, totalPages) });
}

export async function handleSnapshotPageNav(interaction: ButtonInteraction, delta: -1 | 1) {
  await interaction.deferUpdate();
  if (!interaction.guildId) return;

  const session = snapshotSessions.get(interaction.user.id);
  if (!session) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Session Expired").setDescription("Your profile session expired. Please reopen User Profiles.")], components: buildSnapshotConferenceSelectRows([]) });
  }

  const snapshot = await recApi.getUserSnapshot(session.targetDiscordId, interaction.guildId).catch(() => null);
  if (!snapshot) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Profile Unavailable").setDescription("Could not reload this profile.")], components: buildSnapshotConferenceSelectRows([]) });
  }

  const newPage = session.currentPage + delta;
  const { embed, totalPages } = buildSnapshotPages(snapshot, newPage);
  const safePage = Math.max(0, Math.min(newPage, totalPages - 1));
  snapshotSessions.set(interaction.user.id, { ...session, currentPage: safePage });

  return interaction.editReply({ embeds: [embed], components: buildSnapshotNavRows(safePage, totalPages) });
}
