import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, MessageFlags, type StringSelectMenuInteraction } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import {
  buildPlayersByTeamEmbed,
  buildPlayersByTeamRows,
  buildMaddenTeamsEmbed,
  buildMaddenTeamsRows,
  buildRostersMenuEmbed,
  buildRostersMenuRows,
  buildSnapshotUserSelectRows,
  ROSTERS_CUSTOM_IDS,
  type MaddenTeamsPage
} from "../ui/menu.js";

type MainMenuPayloadBuilder = (userId: string, guildId: string | null, isAdmin: boolean) => Promise<any>;
type SnapshotSession = { targetDiscordId: string; targetDisplayName: string; currentPage: number };

const snapshotSessions = new Map<string, SnapshotSession>();

export async function renderRostersMenu(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (interaction.isButton()) return interaction.update({ embeds: [buildRostersMenuEmbed()], components: buildRostersMenuRows() });
  if (interaction.isStringSelectMenu()) return interaction.update({ embeds: [buildRostersMenuEmbed()], components: buildRostersMenuRows() });
}

export async function handleRostersMenuSelect(interaction: StringSelectMenuInteraction, buildMainMenuPayload: MainMenuPayloadBuilder) {
  const selected = interaction.values[0];

  if (selected === "rosters_back") {
    return interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
  }

  if (selected === "rosters_by_team") return renderPlayersByTeam(interaction);

  if (selected === "players_by_position") {
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle("View Players by Position").setDescription("This view is coming soon. Check back after the next build update.")],
      components: buildRostersMenuRows()
    });
  }

  if (selected === "user_snapshots") return renderUserSnapshotPicker(interaction);
}

export async function renderTeamsMenu(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Teams").setDescription("Must be run inside a league server.")], components: buildMaddenTeamsRows() });
  }

  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: any[] = confData?.conferences ?? [];
  const hasTeams = conferences.some((c) => (c.divisions ?? []).some((d: any) => (d.teams ?? []).length));
  if (!hasTeams) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Teams").setDescription("No teams found for this league yet.")], components: buildMaddenTeamsRows() });
  }

  return interaction.editReply({
    embeds: [buildMaddenTeamsEmbed(conferences, "NFC")],
    components: buildMaddenTeamsRows("NFC")
  });
}

export async function handleTeamsPage(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Teams").setDescription("Must be run inside a league server.")], components: buildMaddenTeamsRows("NFC") });
  }
  const page = interaction.customId.split(":").pop() === "AFC" ? "AFC" : "NFC";
  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: any[] = confData?.conferences ?? [];
  return interaction.editReply({
    embeds: [buildMaddenTeamsEmbed(conferences, page as MaddenTeamsPage)],
    components: buildMaddenTeamsRows(page as MaddenTeamsPage)
  });
}

const DEV_TRAIT_EMOJIS: Record<string, string> = {
  "3": "<:XFactor:1494392253177663688>",
  xfactor: "<:XFactor:1494392253177663688>",
  x_factor: "<:XFactor:1494392253177663688>",
  "x-factor": "<:XFactor:1494392253177663688>",
  "2": "<:Superstar:1494392251776897134>",
  superstar: "<:Superstar:1494392251776897134>",
  "1": "<:Star:1494392249163972699>",
  star: "<:Star:1494392249163972699>"
};

function rosterDevEmoji(dev: unknown) {
  const key = String(dev ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return DEV_TRAIT_EMOJIS[key] ?? "";
}

function formatRosterPlayer(member: any) {
  const dev = rosterDevEmoji(member.dev);
  const ovr = `\`${String(member.ovr ?? 0).padStart(2, " ")}\``;
  return `${dev ? `${dev} ` : ""}${ovr} ${member.name} (${member.position})`;
}

function rosterGroupValue(group: { members: any[] }) {
  const value = group.members.map(formatRosterPlayer).join("\n");
  return value.length > 1024 ? `${value.slice(0, 1018).trimEnd()}\n...` : value;
}

function buildRosterEmbed(rosterData: any): EmbedBuilder {
  const team = rosterData.team ?? {};
  const groups: Array<{ label: string; side?: string; members: Array<{ name: string; position: string; ovr: number; dev?: string | null }> }> = rosterData.groups ?? [];
  const divisionLine = [team.conference, team.division].filter(Boolean).join(" ");
  const meta = [divisionLine, rosterData.season != null ? `Season ${rosterData.season}` : null, `${rosterData.totalPlayers ?? 0} players`].filter(Boolean).join(" - ");
  const embed = new EmbedBuilder().setTitle(`${team.name ?? "Team"} - Roster`);

  if (!groups.length) {
    embed.setDescription(`${meta}\n\nNo roster data available for this team yet.`);
    return embed;
  }

  embed.setDescription(meta || "Roster");
  const offense = groups.filter((group) => group.side === "offense" && group.members.length);
  const defense = groups.filter((group) => group.side === "defense" && group.members.length);
  const special = groups.filter((group) => group.side === "special" && group.members.length);
  const other = groups.filter((group) => !["offense", "defense", "special"].includes(String(group.side)) && group.members.length);
  const leftColumn = [...offense, ...special, ...other];
  const rows = Math.max(leftColumn.length, defense.length);

  for (let i = 0; i < rows; i++) {
    const left = leftColumn[i];
    const right = defense[i];
    embed.addFields(
      left ? { name: left.label, value: rosterGroupValue(left), inline: true } : { name: "\u200B", value: "\u200B", inline: true },
      right ? { name: right.label, value: rosterGroupValue(right), inline: true } : { name: "\u200B", value: "\u200B", inline: true },
      { name: "\u200B", value: "\u200B", inline: true }
    );
  }

  return embed;
}

async function renderPlayersByTeam(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("View Players by Team").setDescription("Must be run inside a league server.")], components: buildRostersMenuRows() });
  }
  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  const conferences: any[] = confData?.conferences ?? [];
  const hasTeams = conferences.some((c) => (c.divisions ?? []).some((d: any) => (d.teams ?? []).length));
  if (!hasTeams) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("View Players by Team").setDescription("No teams found for this league yet. Import league data first.")], components: buildRostersMenuRows() });
  }
  return interaction.editReply({
    embeds: [buildPlayersByTeamEmbed(conferences)],
    components: buildPlayersByTeamRows(conferences)
  });
}

export async function handleRosterTeamSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const teamId = interaction.values[0];
  if (!interaction.guildId) {
    return interaction.followUp({ embeds: [new EmbedBuilder().setTitle("Roster").setDescription("Must be run inside a league server.")], flags: MessageFlags.Ephemeral });
  }

  const confData = await recApi.getLeagueConferences(interaction.guildId).catch(() => null);
  if (confData?.conferences?.length) {
    await interaction.editReply({ embeds: [buildPlayersByTeamEmbed(confData.conferences)], components: buildPlayersByTeamRows(confData.conferences) }).catch(() => undefined);
  }

  const rosterData = await recApi.getTeamRoster(interaction.guildId, teamId).catch(() => null);
  if (!rosterData) {
    return interaction.followUp({ embeds: [new EmbedBuilder().setTitle("Roster").setDescription("Failed to load roster. Please try again.")], flags: MessageFlags.Ephemeral });
  }
  return interaction.followUp({ embeds: [buildRosterEmbed(rosterData)], flags: MessageFlags.Ephemeral });
}

export async function handleByTeamNav(interaction: StringSelectMenuInteraction, buildMainMenuPayload: MainMenuPayloadBuilder) {
  const choice = interaction.values[0];

  if (choice === "main_menu") {
    return interaction.update(await buildMainMenuPayload(interaction.user.id, interaction.guildId, isDiscordAdminInteraction(interaction)));
  }

  if (choice === "players_by_position") {
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle("View Players by Position").setDescription("This view is coming soon. Check back after the next build update.")],
      components: buildRostersMenuRows()
    });
  }

  if (choice === "user_snapshots") return renderUserSnapshotPicker(interaction);
}

export async function renderUserSnapshotPicker(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("User Snapshots").setDescription("This must be run inside a league server.")], components: buildRostersMenuRows() });
  const coachData = await recApi.getCoaches(interaction.guildId).catch(() => null);
  const coaches = coachData?.coaches ?? [];
  if (!coaches.length) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("User Snapshots").setDescription("No linked coaches found in this league. Team assignments must be configured first.")], components: buildRostersMenuRows() });
  }
  return interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("User Snapshots").setDescription("Select a coach from the dropdown below to view their full profile snapshot.")],
    components: buildSnapshotUserSelectRows(coaches)
  });
}

function buildSnapshotNavRows(currentPage: number, totalPages: number) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotBack).setLabel("Back to Rosters").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotPrev).setLabel("Prev").setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(ROSTERS_CUSTOM_IDS.snapshotNext).setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages - 1)
  );
  return [row];
}

function buildSnapshotPages(snapshot: any, currentPage: number): { embed: EmbedBuilder; totalPages: number } {
  const pages: EmbedBuilder[] = [];
  const sr = snapshot.seasonRecord ?? {};
  const gr = snapshot.globalRecord ?? {};
  const pr = snapshot.powerRank;
  const gg = snapshot.gotwGuessing;
  const gc = snapshot.gotwCompetition;
  pages.push(new EmbedBuilder()
    .setTitle(`${snapshot.discord?.global_name ?? snapshot.user?.display_name ?? "Coach"} - Snapshot`)
    .setDescription([
      `Team: **${snapshot.teamName ?? "Unassigned"}**`,
      `League: ${snapshot.leagueName ?? "Unknown"} - Season ${snapshot.seasonNumber ?? "?"}, Week ${snapshot.currentWeek ?? "?"}`,
      "",
      "**Season Record (This Guild)**",
      `W-L-T: **${sr.text ?? "0-0-0"}** | PD: **${sr.pointDifferential ?? 0}**`,
      `Points For: ${sr.pointsFor ?? 0} | Points Against: ${sr.pointsAgainst ?? 0}`,
      "",
      "**Global Record (All Leagues)**",
      `W-L-T: **${gr.text ?? "0-0-0"}** | PD: **${gr.pointDifferential ?? 0}**`,
      `Playoffs: ${gr.playoffText ?? "0-0"} | Super Bowls: ${gr.superbowlText ?? "0-0"}`,
      "",
      "**Power Ranking**",
      pr ? `Rank: **#${pr.rank}** | Score: ${(pr.score ?? 0).toFixed(2)} | SOS: ${(pr.sosScore ?? 0).toFixed(2)}` : "Not yet ranked this season",
      "",
      "**GOTW Voting Record (Global)**",
      gg ? `${gg.correct}/${gg.total} correct (${gg.accuracy}%)` : "No votes recorded yet",
      "",
      "**GOTW Competitor Record (This Guild)**",
      gc ? `${gc.wins}W-${gc.losses}L as a GOTW participant` : "No GOTW games played yet"
    ].join("\n").slice(0, 4096)));

  const badges: any[] = snapshot.badges ?? [];
  if (badges.length === 0) {
    pages.push(new EmbedBuilder().setTitle("Badges").setDescription("No badges earned yet."));
  } else {
    const BADGES_PER_PAGE = 15;
    for (let i = 0; i < badges.length; i += BADGES_PER_PAGE) {
      const slice = badges.slice(i, i + BADGES_PER_PAGE);
      const lines = slice.map((b: any) => {
        const name = b.badge_label ?? b.badge_name ?? "Badge";
        const tier = b.tier ? ` (${b.tier})` : "";
        const earned = b.earned_at ? ` - ${new Date(b.earned_at).toLocaleDateString("en-US")}` : "";
        return `- ${name}${tier}${earned}`;
      });
      pages.push(new EmbedBuilder().setTitle(`Badges (${i + 1}-${Math.min(i + BADGES_PER_PAGE, badges.length)} of ${badges.length})`).setDescription(lines.join("\n")));
    }
  }

  const awards: any[] = snapshot.awardsWon ?? [];
  if (awards.length === 0) {
    pages.push(new EmbedBuilder().setTitle("Awards Won (This Guild)").setDescription("No awards won in this league yet."));
  } else {
    const lines = awards.map((a: any) => `- **${a.award_name}** - Season ${a.season_number}`);
    pages.push(new EmbedBuilder().setTitle(`Awards Won (This Guild) - ${awards.length} total`).setDescription(lines.join("\n")));
  }

  const safeIndex = Math.max(0, Math.min(currentPage, pages.length - 1));
  const embed = pages[safeIndex];
  embed.setFooter({ text: `Page ${safeIndex + 1} of ${pages.length}` });
  return { embed, totalPages: pages.length };
}

export async function handleSnapshotUserSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) return;
  const targetDiscordId = interaction.values[0];
  const snapshot = await recApi.getUserSnapshot(targetDiscordId, interaction.guildId).catch(() => null);
  if (!snapshot) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Snapshot Unavailable").setDescription("Could not load this coach's snapshot. They may not be fully linked.")], components: buildRostersMenuRows() });
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
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Session Expired").setDescription("Your snapshot session expired. Please reopen Rosters > User Snapshots.")], components: buildRostersMenuRows() });
  }

  const snapshot = await recApi.getUserSnapshot(session.targetDiscordId, interaction.guildId).catch(() => null);
  if (!snapshot) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Snapshot Unavailable").setDescription("Could not reload this snapshot.")], components: buildRostersMenuRows() });
  }

  const newPage = session.currentPage + delta;
  const { embed, totalPages } = buildSnapshotPages(snapshot, newPage);
  const safePage = Math.max(0, Math.min(newPage, totalPages - 1));
  snapshotSessions.set(interaction.user.id, { ...session, currentPage: safePage });

  return interaction.editReply({ embeds: [embed], components: buildSnapshotNavRows(safePage, totalPages) });
}
