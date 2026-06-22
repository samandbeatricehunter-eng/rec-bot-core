import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { isDiscordAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import {
  buildMaddenTeamsEmbed,
  buildMaddenTeamsRows,
  buildSnapshotConferenceSelectRows,
  buildSnapshotTeamSelectRows,
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

  return interaction.editReply({
    embeds: [buildMaddenTeamsEmbed(conferences, "NFC")],
    components: buildMaddenTeamsRows("NFC")
  });
}

export async function handleTeamsPage(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Teams...").setDescription("Switching conferences and refreshing linked/open teams.")], components: [] });
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
