import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { isFullLeagueAdminInteraction } from "../lib/admin.js";
import { recApi } from "../lib/rec-api.js";
import { teamDisplayAbbr, teamDisplayLabel, teamDisplayName } from "../lib/team-display.js";
import { buildAdminPanelEmbed, buildAdminPanelRows, buildScheduleEmbed, buildScheduleRows, MENU_CUSTOM_IDS, normalizeRosterConferences, type RosterConference, type RosterTeam } from "../ui/menu.js";
import { canonicalConferenceName, CONFERENCE_ORDER } from "@rec/shared";

export const SCHEDULE_MGMT_CUSTOM_IDS = {
  manualWeekSelect: "rec:schedule_manual:week",
  manualAfcSelect: "rec:schedule_manual:afc",
  manualNfcSelect: "rec:schedule_manual:nfc",
  manualConferenceSelect: "rec:schedule_manual:conference",
  manualTeamSelect: "rec:schedule_manual:team",
  manualNextMatchup: "rec:schedule_manual:next_matchup",
  manualNextWeek: "rec:schedule_manual:next_week",
  manualContinueNextWeek: "rec:schedule_manual:continue_next_week",
  manualComplete: "rec:schedule_manual:complete",
  manualBack: "rec:schedule_manual:back",
  viewPrev: "rec:schedule_view:prev",
  viewNext: "rec:schedule_view:next",
  viewPostPublicly: "rec:schedule_view:post_public",
  viewBack: "rec:schedule_view:back",
} as const;

export const POST_SETUP_SCHEDULE_CUSTOM_IDS = {
  prev: "rec:post_setup_schedule:prev",
  next: "rec:post_setup_schedule:next",
  finish: "rec:post_setup_schedule:finish",
  enterManual: "rec:post_setup_schedule:enter_manual",
  continueFromTeams: "rec:league_setup:continue_schedule_review",
} as const;

const POST_SETUP_MAX_WEEK = 18;

type ManualTeam = {
  id: string;
  name: string;
  abbreviation?: string | null;
  display_abbr?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  conference?: string | null;
  division?: string | null;
};

type ManualScheduleSession = {
  guildId: string;
  userId: string;
  seasonNumber: number;
  currentWeek: number;
  weekNumber: number;
  teams: ManualTeam[];
  selectedTeamIds: string[];
  selectedConference?: string | null;
  games: any[];
  warnedIncomplete: boolean;
  notice?: string | null;
  mode: "admin" | "post_setup";
};

const manualScheduleSessions = new Map<string, ManualScheduleSession>();
const sessionKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

type ScheduleViewSession = {
  guildId: string;
  userId: string;
  leagueName?: string | null;
  seasonNumber: number;
  pageIndex: number;
  weeks: Array<{ weekNumber: number; phase?: string | null; games: any[] }>;
  mode: "admin" | "post_setup" | "public";
};

const scheduleViewSessions = new Map<string, ScheduleViewSession>();
const postSetupSessions = new Map<string, { guildId: string; franchiseYearOne: boolean }>();

export function markPostSetupActive(userId: string, guildId: string, franchiseYearOne: boolean) {
  postSetupSessions.set(userId, { guildId, franchiseYearOne });
}

export function clearPostSetupSession(userId: string) {
  postSetupSessions.delete(userId);
}

export function isPostSetupActive(userId: string) {
  return postSetupSessions.has(userId);
}

export async function renderScheduleMenu(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Schedule").setDescription("Open /menu inside a REC Discord server to view league schedules.")],
      components: buildScheduleRows()
    });
  }

  try {
    const schedule = await recApi.getUserSchedule(interaction.user.id, interaction.guildId);
    return interaction.editReply({
      embeds: [
        buildScheduleEmbed({
          leagueName: schedule?.league?.name ?? null,
          teamName: schedule?.team?.name ?? null,
          isLinked: Boolean(schedule?.isLinked),
          hasLoggedSchedule: Boolean(schedule?.hasLoggedSchedule),
          currentWeek: schedule?.league?.currentWeek ?? schedule?.league?.current_week ?? null,
          games: schedule?.games ?? []
        })
      ],
      components: buildScheduleRows()
    });
  } catch (error) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("Schedule")
        .setColor(0xe74c3c)
        .setDescription(error instanceof Error ? error.message : String(error))],
      components: buildScheduleRows()
    });
  }
}

export async function renderSchedulePlaceholder(interaction: ButtonInteraction, title: string, description: string) {
  return interaction.reply({
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description)],
    ephemeral: true
  });
}

function fmtPct(n: number) {
  return n.toFixed(3).replace(/^0/, ""); // .540
}

function buildSosEmbed(data: any, viewerDiscordId: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Strength of Schedule - Season ${data?.currentSeason ?? 1}`)
    .setColor(0xe67e22);

  if (!data?.scheduleLogged) {
    return embed.setDescription("No schedule has been logged for this season yet. Ask a commissioner to enter it from **League Mgmt > Schedule**.");
  }

  const teams: any[] = data.teams ?? [];
  const viewer = data.viewerTeamId ? teams.find((t) => t.teamId === data.viewerTeamId) : null;

  const header = [
    "Tougher schedules rank higher. SOS weights each opponent **1.0 if human, 0.5 if CPU**, then nudges by the opponent's record" +
      (data.hasPrior ? " (with a small carry-over from last season)" : "") + ".",
  ];
  if (viewer) {
    header.push(
      "",
      `**Your team - ${viewer.teamName}**`,
      `SOS **${viewer.sosFull.toFixed(1)}** | Rank **${viewer.rank}/${data.totalTeams}** | Remaining **${viewer.sosRemaining.toFixed(1)}**`,
      `${viewer.humanCount} human / ${viewer.cpuCount} CPU | opp record ${fmtPct(viewer.oppRecord)}`,
    );
  } else {
    header.push("", "_You're not linked to a team in this league, so only the league board is shown._");
  }

  const board = teams.map((t) => {
    const mark = t.teamId === data.viewerTeamId ? "> " : "";
    const label = t.abbr ?? t.teamName;
    const line = `\`${String(t.rank).padStart(2)}\` ${mark}${label} - **${t.sosFull.toFixed(1)}**  |  ${t.humanCount}H/${t.cpuCount}C`;
    return t.teamId === data.viewerTeamId ? `__${line}__` : line;
  });

  return embed.setDescription(
    [header.join("\n"), "", "**League SOS (toughest to easiest)**", board.join("\n")].join("\n").slice(0, 4096),
  );
}

export async function handleScheduleSos(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Strength of Schedule").setDescription("Open /menu inside a REC Discord server to view SOS.")],
      components: buildScheduleRows(),
    });
  }
  try {
    const data = await recApi.getLeagueSos(interaction.guildId, interaction.user.id);
    return interaction.editReply({ embeds: [buildSosEmbed(data, interaction.user.id)], components: buildScheduleRows() });
  } catch (error) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Strength of Schedule").setColor(0xe74c3c).setDescription(error instanceof Error ? error.message : String(error))],
      components: buildScheduleRows(),
    });
  }
}

function moveArrow(change: number | null): string {
  if (change == null) return "new";
  if (change > 0) return `up ${change}`;
  if (change < 0) return `down ${Math.abs(change)}`;
  return "same";
}

function buildPowerRankingsEmbed(data: any, viewerTeamId: string | null): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Power Rankings - Season ${data?.currentSeason ?? 1}`)
    .setColor(0x9b59b6);

  const teams: any[] = data?.teams ?? [];
  if (!teams.length) {
    return embed.setDescription("No teams to rank yet.");
  }

  const header = data.hasPreviousWeek
    ? "Record + point differential, with bonus weight for actually playing (posted box scores) and winning close H2H games. Movement compares to last week."
    : "Record + point differential, with bonus weight for actually playing (posted box scores) and winning close H2H games. Movement appears after the first advance.";

  const board = teams.map((t) => {
    const mark = t.teamId === viewerTeamId ? "> " : "";
    const label = t.abbr ?? t.teamName;
    const line = `\`${String(t.rank).padStart(2)}\` ${mark}${label} - **${(t.score ?? 0).toFixed(3)}**  ${moveArrow(t.change)}`;
    return t.teamId === viewerTeamId ? `__${line}__` : line;
  });

  return embed.setDescription([header, "", board.join("\n")].join("\n").slice(0, 4096));
}

export async function handleSchedulePowerRankings(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Power Rankings").setDescription("Open /menu inside a REC Discord server to view power rankings.")],
      components: buildScheduleRows(),
    });
  }
  try {
    const data = await recApi.getPowerRankings(interaction.guildId, interaction.user.id);
    return interaction.editReply({ embeds: [buildPowerRankingsEmbed(data, data?.viewerTeamId ?? null)], components: buildScheduleRows() });
  } catch (error) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Power Rankings").setColor(0xe74c3c).setDescription(error instanceof Error ? error.message : String(error))],
      components: buildScheduleRows(),
    });
  }
}

function linkedTeamsByConference(rawConferences: RosterConference[]) {
  return normalizeRosterConferences(rawConferences)
    .map((conference) => ({
      conference: conference.conference,
      teams: conference.divisions.flatMap((division) =>
        division.teams
          .filter((team) => Boolean(team.linkedDiscordId))
          .map((team) => ({ ...team, division: team.division ?? division.label })),
      ),
    }))
    .filter((conference) => conference.teams.length);
}

function buildLinkedTeamSelectRows(rawConferences: RosterConference[], customIdBase: string) {
  const conferences = linkedTeamsByConference(rawConferences);
  if (!conferences.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${customIdBase}:none`)
      .setPlaceholder("No linked user teams available")
      .setMinValues(1)
      .setMaxValues(1)
      .setDisabled(true)
      .addOptions(new StringSelectMenuOptionBuilder().setLabel("No linked teams").setValue("none"));
    return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
  }
  return conferences.slice(0, 5).map((conference) => {
    const options = conference.teams.slice(0, 25).map((team: RosterTeam) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${team.abbreviation ?? teamDisplayLabel(team as any)} - ${team.linkedName ?? "Linked user"}`.slice(0, 100))
        .setDescription((team.division ?? conference.conference).slice(0, 100))
        .setValue(team.linkedDiscordId!),
    );
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${customIdBase}:${conference.conference}`)
        .setPlaceholder(`${conference.conference} linked teams`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  });
}

async function loadLinkedTeamSelectPayload(guildId: string, title: string, description: string, customIdBase: string) {
  const confData = await recApi.getLeagueConferences(guildId);
  const conferences: RosterConference[] = confData?.conferences ?? [];
  const rows = buildLinkedTeamSelectRows(conferences, customIdBase);
  return {
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x3498db)],
    components: [
      ...rows,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.schedule).setLabel("Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.scheduleBack).setLabel("Main Menu").setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function fmtNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

function buildStatsEmbed(snapshot: any, requestedDiscordId: string) {
  const display = snapshot?.display ?? {};
  const team = snapshot?.team ?? {};
  const seasonRecord = snapshot?.seasonRecord ?? {};
  const seasonStats = snapshot?.seasonStats ?? {};
  const identity = snapshot?.identity ?? snapshot?.currentIdentity ?? display?.identity ?? null;
  const seasonBadges: any[] = snapshot?.seasonBadges ?? [];
  const weeklyBadges: any[] = snapshot?.weeklyBadges ?? [];
  const lines = [
    `Coach: <@${requestedDiscordId}>`,
    `Team: **${display.teamName ?? team.name ?? "Unlinked"}**`,
    `Record: **${seasonRecord.text ?? "0-0"}** | PF ${fmtNumber(seasonRecord.pointsFor)} | PA ${fmtNumber(seasonRecord.pointsAgainst)} | Diff ${fmtNumber(seasonRecord.pointDifferential)}`,
    `H2H: **${seasonRecord.text ?? "0-0"}**`,
    `Identity: **${identity?.name ?? identity?.label ?? seasonStats.identity ?? "Not assigned"}**`,
    "",
    "**Current Season Stats**",
    `Box scores uploaded: **${fmtNumber(seasonRecord.boxScoresUploaded ?? seasonStats.boxScoresUploaded)}**`,
    `Active streak: **${seasonRecord.activeStreak ?? seasonStats.activeStreak ?? "None"}**`,
    `GOTW voting: **${snapshot?.gotwGuessing ? `${snapshot.gotwGuessing.correct}/${snapshot.gotwGuessing.total} (${snapshot.gotwGuessing.accuracy}%)` : "No votes yet"}**`,
    `GOTW H2H: **${snapshot?.gotwCompetition ? `${snapshot.gotwCompetition.wins}-${snapshot.gotwCompetition.losses}` : "No GOTW games yet"}**`,
    "",
    "**Active Badges**",
    `Weekly: ${weeklyBadges.length ? weeklyBadges.map((badge) => badge.badgeName ?? badge.name ?? "Badge").slice(0, 8).join(", ") : "None"}`,
    `Season: ${seasonBadges.length ? seasonBadges.map((badge) => badge.badgeName ?? badge.name ?? "Badge").slice(0, 8).join(", ") : "None"}`,
  ];
  return new EmbedBuilder()
    .setTitle(`${display.teamName ?? team.name ?? "Team"} Stats`)
    .setColor(0x2ecc71)
    .setDescription(lines.join("\n").slice(0, 4096));
}

export async function startScheduleTeamSelect(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) {
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Team Schedule").setDescription("Open /menu inside a REC Discord server.")], components: buildScheduleRows() });
  }
  return interaction.editReply(await loadLinkedTeamSelectPayload(
    interaction.guildId,
    "Team Schedule",
    "Select an active linked team to view that coach's current schedule.",
    MENU_CUSTOM_IDS.scheduleTeamSelect,
  ));
}

export async function handleScheduleTeamSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Team Schedule").setDescription("Guild context required.")], components: buildScheduleRows() });
  const discordId = interaction.values[0];
  const schedule = await recApi.getUserSchedule(discordId, interaction.guildId);
  return interaction.editReply({
    embeds: [buildScheduleEmbed({
      leagueName: schedule?.league?.name ?? null,
      teamName: schedule?.team?.name ?? null,
      isLinked: Boolean(schedule?.isLinked),
      hasLoggedSchedule: Boolean(schedule?.hasLoggedSchedule),
      currentWeek: schedule?.league?.currentWeek ?? schedule?.league?.current_week ?? null,
      games: schedule?.games ?? [],
    })],
    components: buildScheduleRows(),
  });
}

export async function handleScheduleStats(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Stats").setDescription("Open /menu inside a REC Discord server.")], components: buildScheduleRows() });
  const snapshot = await recApi.getUserSnapshot(interaction.user.id, interaction.guildId);
  const selectPayload = await loadLinkedTeamSelectPayload(
    interaction.guildId,
    "Stats",
    "Your current season stats are shown below. Use the dropdowns to view another active linked user team.",
    MENU_CUSTOM_IDS.scheduleStatsTeamSelect,
  );
  return interaction.editReply({ embeds: [buildStatsEmbed(snapshot, interaction.user.id)], components: selectPayload.components });
}

export async function handleScheduleStatsTeamSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  if (!interaction.guildId) return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Stats").setDescription("Guild context required.")], components: buildScheduleRows() });
  const discordId = interaction.values[0];
  const snapshot = await recApi.getUserSnapshot(discordId, interaction.guildId);
  const selectPayload = await loadLinkedTeamSelectPayload(
    interaction.guildId,
    "Stats",
    "Use the dropdowns to view another active linked user team.",
    MENU_CUSTOM_IDS.scheduleStatsTeamSelect,
  );
  return interaction.editReply({ embeds: [buildStatsEmbed(snapshot, discordId)], components: selectPayload.components });
}

export async function startManualScheduleEntry(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can set the league schedule.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });

  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Manual Schedule...").setDescription("Fetching league teams so you can choose weekly matchups.")], components: [] });
  try {
    const data = await recApi.listScheduleTeams(interaction.guildId);
    const teams: ManualTeam[] = data?.teams ?? [];
    if (teams.length < 2) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Manual Schedule").setDescription("No league teams are set up yet.")],
        components: [scheduleBackRow()],
      });
    }
    const session: ManualScheduleSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      seasonNumber: Number(data?.league?.seasonNumber ?? 1),
      currentWeek: Number(data?.league?.currentWeek ?? 1),
      weekNumber: 1,
      teams,
      selectedTeamIds: [],
      games: [],
      warnedIncomplete: false,
      notice: null,
      mode: "admin",
    };
    manualScheduleSessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderManualWeekPicker(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Manual Schedule").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [scheduleBackRow()],
    });
  }
}

export async function handleManualScheduleWeekSelect(interaction: StringSelectMenuInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  session.weekNumber = Number(interaction.values[0] ?? 1);
  session.selectedTeamIds = [];
  session.warnedIncomplete = false;
  session.notice = null;
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Week...").setDescription("Fetching the saved matchups for the selected week.")], components: [] });
  await refreshWeek(session);
  return interaction.editReply(renderManualEntry(session));
}

export async function handleManualScheduleTeamSelect(interaction: StringSelectMenuInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  const next = [...session.selectedTeamIds];
  for (const teamId of interaction.values) {
    if (next.length >= 2) break;
    if (!next.includes(teamId)) next.push(teamId);
  }
  session.selectedTeamIds = next.slice(0, 2);
  session.notice = session.selectedTeamIds.length === 2
    ? "Selection ready. The first team is Away and the second team is Home."
    : "Select one more team. The first selected team is Away; the second selected team is Home.";
  return interaction.update(renderManualEntry(session));
}

export async function handleManualScheduleConferenceSelect(interaction: StringSelectMenuInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  session.selectedConference = interaction.values[0] ?? null;
  return interaction.update(renderManualEntry(session));
}

export async function handleManualScheduleNextMatchup(interaction: ButtonInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Saving Matchup...").setDescription("Saving the selected Away/Home matchup to the weekly schedule.")], components: [] });
  const saved = await saveSelectedMatchup(session, interaction.user.id).catch((err) => {
    session.notice = err instanceof Error ? err.message : String(err);
    return false;
  });
  if (saved) {
    const channelNotice = await maybeCreateImmediateGameChannel(interaction, session, saved).catch(() => null);
    session.selectedTeamIds = [];
    session.warnedIncomplete = false;
    session.notice = ["Matchup saved. Select the next Away/Home pair.", channelNotice].filter(Boolean).join(" ");
  }
  return interaction.editReply(renderManualEntry(session));
}

export async function handleManualScheduleNextWeek(interaction: ButtonInteraction, force = false) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Next Week...").setDescription("Checking whether this week is complete, then loading the next schedule page.")], components: [] });

  const expected = expectedGamesForWeek(session);
  if (!force && session.games.length < expected) {
    session.warnedIncomplete = true;
    session.notice = `Week ${session.weekNumber} has ${session.games.length}/${expected} expected games. Continuing without the full schedule can cause schedule issues and game channel creation issues.`;
    return interaction.editReply(renderManualEntry(session));
  }

  const maxWeek = session.mode === "post_setup" ? POST_SETUP_MAX_WEEK : 22;
  if (session.weekNumber >= maxWeek) {
    session.notice = session.mode === "post_setup"
      ? `Week ${POST_SETUP_MAX_WEEK} is the last regular-season week for setup. Finish entering matchups, then press **Finish Setup**.`
      : `Week ${maxWeek} is the last supported week in this flow.`;
    return interaction.editReply(renderManualEntry(session));
  }

  session.weekNumber = Math.min(maxWeek, session.weekNumber + 1);
  session.selectedTeamIds = [];
  session.warnedIncomplete = false;
  session.notice = null;
  await refreshWeek(session);
  return interaction.editReply(renderManualEntry(session));
}

export async function handleManualScheduleComplete(interaction: ButtonInteraction) {
  const session = getManualSession(interaction);
  if (!session) return interaction.reply({ content: "Manual schedule session expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Completing Schedule Entry...").setDescription("Saving any selected matchup and returning to League Mgmt.")], components: [] });
  if (session.selectedTeamIds.length === 2) {
    const saved = await saveSelectedMatchup(session, interaction.user.id).catch((err) => {
      session.notice = err instanceof Error ? err.message : String(err);
      return false;
    });
    if (!saved) return interaction.editReply(renderManualEntry(session));
    await maybeCreateImmediateGameChannel(interaction, session, saved).catch(() => null);
  }
  manualScheduleSessions.delete(sessionKey(session.guildId, session.userId));
  if (session.mode === "post_setup") return handlePostSetupScheduleFinish(interaction);
  return interaction.editReply({
    embeds: [buildAdminPanelEmbed().setDescription("Manual schedule entry completed. Your saved matchups are logged in the league schedule.")],
    components: buildAdminPanelRows(),
  });
}

export async function handleManualScheduleBack(interaction: ButtonInteraction) {
  const session = getManualSession(interaction);
  if (session?.mode === "post_setup") {
    manualScheduleSessions.delete(sessionKey(session.guildId, session.userId));
    return interaction.update(renderPostSetupScheduleInputChoice());
  }
  if (interaction.inCachedGuild()) manualScheduleSessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Schedule")
      .setDescription("Choose how you want to upload, enter, or view league schedule data.")],
    components: scheduleManagementRows(),
  });
}

export async function startScheduleViewer(interaction: ButtonInteraction) {
  if (!isFullLeagueAdminInteraction(interaction)) {
    return interaction.reply({ content: "Only commissioners or server admins can view the full league schedule.", flags: MessageFlags.Ephemeral });
  }
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Schedule...").setDescription("Fetching all regular-season, postseason, and Super Bowl week pages.")], components: [] });
  try {
    const result = await recApi.listScheduleSeason({ guildId: interaction.guildId });
    const session: ScheduleViewSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      leagueName: result?.league?.name ?? null,
      seasonNumber: Number(result?.league?.seasonNumber ?? 1),
      pageIndex: 0,
      weeks: result?.weeks ?? [],
      mode: "admin",
    };
    scheduleViewSessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderScheduleView(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("View Schedule").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [scheduleBackRow()],
    });
  }
}

export async function startPublicLeagueScheduleViewer(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading League Schedule...").setDescription("Fetching the full league schedule.")], components: [] });
  try {
    const result = await recApi.listScheduleSeason({ guildId: interaction.guildId });
    const session: ScheduleViewSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      leagueName: result?.league?.name ?? null,
      seasonNumber: Number(result?.league?.seasonNumber ?? 1),
      pageIndex: 0,
      weeks: result?.weeks ?? [],
      mode: "public",
    };
    scheduleViewSessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderScheduleView(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("League Schedule").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: buildScheduleRows(),
    });
  }
}

export async function startPreviousSeasonScheduleViewer(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return interaction.reply({ content: "Guild context required.", flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Loading Schedule History...").setDescription("Fetching the previous season schedule, including playoff weeks if stored.")], components: [] });
  try {
    const current = await recApi.listScheduleSeason({ guildId: interaction.guildId });
    const currentSeason = Number(current?.league?.seasonNumber ?? 1);
    if (currentSeason <= 1) {
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("Schedule History").setDescription("No previous REC season is available for this league yet.")], components: buildScheduleRows() });
    }
    const result = await recApi.listScheduleSeason({ guildId: interaction.guildId, seasonNumber: currentSeason - 1 });
    const session: ScheduleViewSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      leagueName: `${result?.league?.name ?? "League"} History`,
      seasonNumber: Number(result?.league?.seasonNumber ?? currentSeason - 1),
      pageIndex: 0,
      weeks: result?.weeks ?? [],
      mode: "public",
    };
    scheduleViewSessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    return interaction.editReply(renderScheduleView(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Schedule History").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: buildScheduleRows(),
    });
  }
}

export async function handleScheduleViewPage(interaction: ButtonInteraction, delta: number) {
  const session = getScheduleViewSession(interaction);
  if (!session) return interaction.reply({ content: "Schedule view expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  session.pageIndex = Math.max(0, Math.min(session.weeks.length - 1, session.pageIndex + delta));
  return interaction.update(renderScheduleView(session));
}

export async function handleScheduleViewPostPublicly(interaction: ButtonInteraction) {
  const session = getScheduleViewSession(interaction);
  if (!session) return interaction.reply({ content: "Schedule view expired. Reopen League Mgmt > Schedule.", flags: MessageFlags.Ephemeral });
  if (!interaction.channel?.isTextBased() || !("send" in interaction.channel)) return interaction.reply({ content: "I can't post in this channel.", flags: MessageFlags.Ephemeral });
  await interaction.channel.send({ embeds: [buildScheduleWeekEmbed(session)] });
  return interaction.reply({ content: "Posted this schedule page publicly.", flags: MessageFlags.Ephemeral });
}

export async function handleScheduleViewBack(interaction: ButtonInteraction) {
  const session = getScheduleViewSession(interaction);
  if (session?.mode === "post_setup") return handlePostSetupScheduleFinish(interaction);
  if (interaction.inCachedGuild()) scheduleViewSessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  if (session?.mode === "public") {
    return renderScheduleMenu(interaction);
  }
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle("Schedule")
      .setDescription("Choose how you want to upload, enter, or view league schedule data.")],
    components: scheduleManagementRows(),
  });
}

function filterPostSetupWeeks(weeks: ScheduleViewSession["weeks"]) {
  const byWeek = new Map(
    weeks
      .filter((week) => week.weekNumber >= 1 && week.weekNumber <= POST_SETUP_MAX_WEEK)
      .map((week) => [week.weekNumber, week] as const)
  );
  return Array.from({ length: POST_SETUP_MAX_WEEK }, (_, idx) => {
    const weekNumber = idx + 1;
    return byWeek.get(weekNumber) ?? { weekNumber, phase: "regular_season", games: [] };
  });
}

function renderPostSetupScheduleInputChoice() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("League Setup: Enter Schedule")
        .setDescription([
          "Your franchise is **not in Year 1**, so REC did not seed a default NFL schedule.",
          "",
          "Enter matchups manually for Weeks 1–18 now, or finish setup and add the schedule later from **League Mgmt → Schedule**.",
        ].join("\n")),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.enterManual)
          .setLabel("Enter Schedule Manually")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.finish)
          .setLabel("Finish Setup")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export async function startPostSetupScheduleStep(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const postSetup = postSetupSessions.get(interaction.user.id);
  if (postSetup?.franchiseYearOne) return loadPostSetupScheduleReview(interaction);
  return interaction.editReply(renderPostSetupScheduleInputChoice());
}

async function loadPostSetupScheduleReview(interaction: ButtonInteraction) {
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Loading Schedule...").setDescription(`Fetching Weeks 1–${POST_SETUP_MAX_WEEK} for review.`)],
    components: [],
  });
  try {
    const result = await recApi.listScheduleSeason({ guildId: interaction.guildId! });
    const session: ScheduleViewSession = {
      guildId: interaction.guildId!,
      userId: interaction.user.id,
      leagueName: result?.league?.name ?? null,
      seasonNumber: Number(result?.league?.seasonNumber ?? 1),
      pageIndex: 0,
      weeks: filterPostSetupWeeks(result?.weeks ?? []),
      mode: "post_setup",
    };
    scheduleViewSessions.set(sessionKey(interaction.guildId!, interaction.user.id), session);
    return interaction.editReply(renderPostSetupScheduleView(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Schedule Review").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.finish).setLabel("Finish Setup").setStyle(ButtonStyle.Success)
        ),
      ],
    });
  }
}


export async function startPostSetupManualScheduleEntry(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [new EmbedBuilder().setTitle("Loading Manual Schedule...").setDescription("Fetching league teams so you can enter weekly matchups.")],
    components: [],
  });
  try {
    const data = await recApi.listScheduleTeams(interaction.guildId);
    const teams: ManualTeam[] = data?.teams ?? [];
    if (teams.length < 2) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Enter Schedule").setDescription("No league teams are available yet.")],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.finish).setLabel("Finish Setup").setStyle(ButtonStyle.Success)
          ),
        ],
      });
    }
    const session: ManualScheduleSession = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      seasonNumber: Number(data?.league?.seasonNumber ?? 1),
      currentWeek: Number(data?.league?.currentWeek ?? 1),
      weekNumber: 1,
      teams,
      selectedTeamIds: [],
      games: [],
      warnedIncomplete: false,
      notice: "Enter each matchup for Week 1. The first team selected is Away; the second is Home.",
      mode: "post_setup",
    };
    manualScheduleSessions.set(sessionKey(interaction.guildId, interaction.user.id), session);
    await refreshWeek(session);
    return interaction.editReply(renderManualEntry(session));
  } catch (err) {
    return interaction.editReply({
      embeds: [new EmbedBuilder().setTitle("Enter Schedule").setColor(0xe74c3c).setDescription(err instanceof Error ? err.message : String(err))],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.finish).setLabel("Finish Setup").setStyle(ButtonStyle.Success)
        ),
      ],
    });
  }
}

export async function handlePostSetupScheduleViewPage(interaction: ButtonInteraction, delta: number) {
  const session = getScheduleViewSession(interaction);
  if (!session || session.mode !== "post_setup") {
    return interaction.reply({ content: "Schedule review expired. Open Admin Panel → League Setup again.", flags: MessageFlags.Ephemeral });
  }
  session.pageIndex = Math.max(0, Math.min(session.weeks.length - 1, session.pageIndex + delta));
  return interaction.update(renderPostSetupScheduleView(session));
}

export async function handlePostSetupScheduleFinish(interaction: ButtonInteraction) {
  if (interaction.inCachedGuild()) scheduleViewSessions.delete(sessionKey(interaction.guildId, interaction.user.id));
  clearPostSetupSession(interaction.user.id);
  return interaction.update({ embeds: [buildAdminPanelEmbed()], components: buildAdminPanelRows() });
}

function getScheduleViewSession(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return null;
  return scheduleViewSessions.get(sessionKey(interaction.guildId, interaction.user.id)) ?? null;
}

function getManualSession(interaction: ButtonInteraction | StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return null;
  return manualScheduleSessions.get(sessionKey(interaction.guildId, interaction.user.id)) ?? null;
}

async function refreshWeek(session: ManualScheduleSession) {
  const week = await recApi.listScheduleWeek({ guildId: session.guildId, seasonNumber: session.seasonNumber, weekNumber: session.weekNumber });
  session.games = week?.games ?? [];
}

async function saveSelectedMatchup(session: ManualScheduleSession, requestedByDiscordId: string) {
  if (session.selectedTeamIds.length !== 2) {
    session.notice = "Select exactly two teams before saving a matchup. The first selected team is Away; the second selected team is Home.";
    return false;
  }
  const [awayTeamId, homeTeamId] = session.selectedTeamIds;
  const result = await recApi.saveManualScheduleGame({
    guildId: session.guildId,
    seasonNumber: session.seasonNumber,
    weekNumber: session.weekNumber,
    slotNumber: session.games.length + 1,
    awayTeamId,
    homeTeamId,
    requestedByDiscordId,
  });
  session.games = result?.week?.games ?? [];
  return result?.game ?? true;
}

async function maybeCreateImmediateGameChannel(interaction: ButtonInteraction, session: ManualScheduleSession, game: any) {
  if (!interaction.inCachedGuild()) return null;
  if (!game || Number(session.weekNumber) !== Number(session.currentWeek)) return null;
  if (!game.away_user_id || !game.home_user_id) return null;
  const config = await recApi.getEconomyConfig(session.guildId).catch(() => null);
  const categoryId = config?.routes?.game_channels_category_id;
  const category = categoryId ? await interaction.guild.channels.fetch(categoryId).catch(() => null) : null;
  if (!category || category.type !== ChannelType.GuildCategory) return "No game channel category is configured.";
  const away = teamDisplayName(game.away_team ?? session.teams.find((team) => team.id === game.away_team_id));
  const home = teamDisplayName(game.home_team ?? session.teams.find((team) => team.id === game.home_team_id));
  const name = `${away} vs ${home}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
  const channel = await interaction.guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id }).catch(() => null);
  if (!channel?.isTextBased()) return "Game channel creation failed.";
  await channel.lockPermissions().catch(() => undefined);
  await recApi.registerGameChannel({
    guildId: session.guildId,
    gameId: game.id ?? null,
    discordChannelId: channel.id,
    seasonNumber: session.seasonNumber,
    weekNumber: session.weekNumber,
    awayTeamId: game.away_team_id ?? null,
    homeTeamId: game.home_team_id ?? null,
    awayUserId: game.away_user_id ?? null,
    homeUserId: game.home_user_id ?? null,
  }).catch(() => undefined);
  await channel.send({
    content: `<@${game.away_user_id}> <@${game.home_user_id}>`,
    embeds: [new EmbedBuilder().setTitle("Game Channel").setDescription(`Current-week matchup added manually: **${away} at ${home}**.`)],
    allowedMentions: { users: [game.away_user_id, game.home_user_id] },
  }).catch(() => undefined);
  return `Created game channel <#${channel.id}>.`;
}

function expectedGamesForWeek(session: ManualScheduleSession) {
  // Playoff rounds have a fixed number of games per conference; everything else
  // is a full slate (one game per pair of teams).
  switch (session.weekNumber) {
    case 19: return 6; // Wild Card: 3 AFC + 3 NFC
    case 20: return 4; // Divisional: 2 AFC + 2 NFC
    case 21: return 2; // Conference Championship: 1 AFC + 1 NFC
    case 22: return 1; // Super Bowl
    default: return Math.floor(session.teams.length / 2);
  }
}

function displayTeam(team: ManualTeam | any) {
  return teamDisplayAbbr(team);
}

function conferenceOf(team: ManualTeam) {
  return canonicalConferenceName(team.conference, team.division);
}

// Distinct conferences present among a team pool, in the shared canonical order.
function conferencesPresent(teams: ManualTeam[]): string[] {
  const present = new Set(teams.map((team) => conferenceOf(team)));
  return [...present].sort((a, b) => (CONFERENCE_ORDER.indexOf(a) + 1 || 99) - (CONFERENCE_ORDER.indexOf(b) + 1 || 99));
}

function renderManualWeekPicker(session: ManualScheduleSession) {
  const options = Array.from({ length: 22 }, (_, idx) => {
    const week = idx + 1;
    const label = week <= 18 ? `Week ${week}` : ["Wild Card", "Divisional", "Conference Championship", "Super Bowl"][week - 19] ?? `Week ${week}`;
    return new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(week));
  });
  return {
    embeds: [new EmbedBuilder()
      .setTitle("Manual Schedule")
      .setDescription("Select the week you want to enter manually. After selecting a week, choose two teams per matchup. The first team selected is logged as Away; the second team selected is logged as Home.")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualWeekSelect).setPlaceholder("Select week").addOptions(options)
      ),
      scheduleBackRow(),
    ],
  };
}

function renderManualEntry(session: ManualScheduleSession) {
  const selected = session.selectedTeamIds.map((id, idx) => `${idx === 0 ? "Away" : "Home"}: **${displayTeam(session.teams.find((team) => team.id === id))}**`);
  const games = session.games.map((game: any, idx: number) => {
    const away = displayTeam(game.away_team ?? session.teams.find((team) => team.id === game.away_team_id));
    const home = displayTeam(game.home_team ?? session.teams.find((team) => team.id === game.home_team_id));
    return `${idx + 1}. ${away} at ${home}`;
  });
  const expected = expectedGamesForWeek(session);
  const description = [
    `Week ${session.weekNumber} manual entry`,
    "",
    "**Selection order matters:** first selected team is Away, second selected team is Home.",
    selected.length ? selected.join("\n") : "No teams selected for the next matchup.",
    "",
    `Saved matchups: ${session.games.length}/${expected}`,
    games.length ? games.join("\n") : "No matchups saved for this week yet.",
    session.notice ? `\n**Notice:** ${session.notice}` : "",
  ].filter(Boolean).join("\n");

  return {
    embeds: [new EmbedBuilder()
      .setTitle(session.mode === "post_setup" ? `League Setup: Enter Schedule - Week ${session.weekNumber}` : "Manual Schedule")
      .setDescription(description.slice(0, 4096))
      .setColor(session.warnedIncomplete ? 0xf1c40f : 0x3498db)],
    components: [...teamSelectRows(session), ...actionRows(session)],
  };
}

function teamSelectRows(session: ManualScheduleSession) {
  const used = new Set(session.games.flatMap((game: any) => [game.away_team_id, game.home_team_id]).filter(Boolean));
  const availableTeams = session.teams.filter((team) => !used.has(team.id) && !session.selectedTeamIds.includes(team.id));
  const confs = conferencesPresent(session.teams);
  const isNflLayout = confs.length <= 2 && confs.every((conf) => conf === "AFC" || conf === "NFC");

  if (isNflLayout) {
    const buildSelect = (conference: "AFC" | "NFC", customId: string) => {
      const teams = availableTeams.filter((team) => conferenceOf(team) === conference).slice(0, 25);
      const menu = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(`${conference} teams`)
        .setMinValues(1)
        .setMaxValues(Math.min(2, Math.max(1, teams.length)))
        .setDisabled(session.selectedTeamIds.length >= 2 || teams.length === 0);
      if (teams.length) {
        menu.addOptions(teams.map((team) => new StringSelectMenuOptionBuilder()
          .setLabel(displayTeam(team).slice(0, 100))
          .setValue(team.id)
          .setDescription((team.division ?? conference).slice(0, 100))));
      } else {
        menu.addOptions(new StringSelectMenuOptionBuilder().setLabel(`No ${conference} teams available`).setValue(`none-${conference}`));
      }
      return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
    };
    return [
      buildSelect("AFC", SCHEDULE_MGMT_CUSTOM_IDS.manualAfcSelect),
      buildSelect("NFC", SCHEDULE_MGMT_CUSTOM_IDS.manualNfcSelect),
    ];
  }

  // Non-NFL (CFB, or any league with more than two conferences): too many teams to fit
  // two side-by-side dropdowns, so pick a conference first, then a team within it.
  const selectedConference = confs.includes(session.selectedConference ?? "") ? session.selectedConference! : confs[0];
  const conferenceMenu = new StringSelectMenuBuilder()
    .setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualConferenceSelect)
    .setPlaceholder("Select conference")
    .addOptions(confs.slice(0, 25).map((conf) =>
      new StringSelectMenuOptionBuilder().setLabel(conf.slice(0, 100)).setValue(conf).setDefault(conf === selectedConference)));

  const teams = availableTeams.filter((team) => conferenceOf(team) === selectedConference).slice(0, 25);
  const teamMenu = new StringSelectMenuBuilder()
    .setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualTeamSelect)
    .setPlaceholder(`${selectedConference} teams`)
    .setMinValues(1)
    .setMaxValues(Math.min(2, Math.max(1, teams.length)))
    .setDisabled(session.selectedTeamIds.length >= 2 || teams.length === 0);
  if (teams.length) {
    teamMenu.addOptions(teams.map((team) => new StringSelectMenuOptionBuilder()
      .setLabel(displayTeam(team).slice(0, 100))
      .setValue(team.id)
      .setDescription((team.division ?? selectedConference).slice(0, 100))));
  } else {
    teamMenu.addOptions(new StringSelectMenuOptionBuilder().setLabel(`No ${selectedConference} teams available`).setValue(`none-${selectedConference}`));
  }

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(conferenceMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(teamMenu),
  ];
}

function actionRows(session: ManualScheduleSession) {
  const completeLabel = session.mode === "post_setup" ? "Finish Setup" : "Complete Week";
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualNextMatchup).setLabel("Next Matchup").setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(session.warnedIncomplete ? SCHEDULE_MGMT_CUSTOM_IDS.manualContinueNextWeek : SCHEDULE_MGMT_CUSTOM_IDS.manualNextWeek)
        .setLabel(session.warnedIncomplete ? "Continue Next Week" : "Next Week")
        .setStyle(session.warnedIncomplete ? ButtonStyle.Danger : ButtonStyle.Success)
        .setDisabled(session.mode === "post_setup" && session.weekNumber >= POST_SETUP_MAX_WEEK),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualComplete).setLabel(completeLabel).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualBack).setLabel("Back").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function scheduleBackRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.manualBack).setLabel("Back").setStyle(ButtonStyle.Secondary)
  );
}

function scheduleManagementRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleView).setLabel("View Schedule").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleManual).setLabel("Set Manually").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleOneWeek).setLabel("Upload One Week").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleWizard).setLabel("Schedule Wizard").setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtScheduleBack).setLabel("Back to League Mgmt").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(MENU_CUSTOM_IDS.leagueMgmtBack).setLabel("Main Menu").setStyle(ButtonStyle.Danger),
    ),
  ];
}

function formatViewWeekLabel(weekNumber: number) {
  if (weekNumber <= 18) return `Week ${weekNumber}`;
  if (weekNumber === 19) return "Wild Card Week";
  if (weekNumber === 20) return "Divisional Week";
  if (weekNumber === 21) return "Conference Championship Week";
  if (weekNumber === 22) return "Super Bowl Week";
  return `Week ${weekNumber}`;
}

function formatScheduleParticipant(team: any, discordId?: string | null) {
  if (discordId) return `<@${discordId}>`;
  if (!team) return "Unassigned";
  return teamDisplayAbbr(team);
}

function buildPostSetupWeekEmbed(session: ScheduleViewSession) {
  const page = session.weeks[session.pageIndex] ?? { weekNumber: session.pageIndex + 1, games: [] };
  const lines = page.games.length
    ? page.games.map((game: any, idx: number) => {
      const away = formatScheduleParticipant(game.away_team, game.away_discord_id);
      const home = formatScheduleParticipant(game.home_team, game.home_discord_id);
      return `${idx + 1}. ${away} vs ${home}`;
    }).join("\n")
    : "No matchups have been set for this week yet.";
  return new EmbedBuilder()
    .setTitle(`Week ${page.weekNumber}`)
    .setDescription(lines.slice(0, 4096))
    .setFooter({ text: `Page ${session.pageIndex + 1} of ${POST_SETUP_MAX_WEEK}` });
}

function buildScheduleWeekEmbed(session: ScheduleViewSession) {
  const page = session.weeks[session.pageIndex] ?? { weekNumber: session.pageIndex + 1, games: [] };
  const lines = page.games.length
    ? page.games.map((game: any, idx: number) => {
      const away = formatScheduleParticipant(game.away_team, game.away_discord_id);
      const home = formatScheduleParticipant(game.home_team, game.home_discord_id);
      return `${idx + 1}. ${away} at ${home}`;
    }).join("\n")
    : "No games have been set for this week yet.";
  return new EmbedBuilder()
    .setTitle(`${session.leagueName ?? "League"} Schedule - ${formatViewWeekLabel(page.weekNumber)}`)
    .setDescription(lines.slice(0, 4096))
    .setFooter({ text: `Season ${session.seasonNumber} - Page ${session.pageIndex + 1}/${session.weeks.length || 22}` });
}

function renderScheduleView(session: ScheduleViewSession) {
  const last = Math.max(0, session.weeks.length - 1);
  return {
    embeds: [buildScheduleWeekEmbed(session)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.viewPrev).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(session.pageIndex <= 0),
        new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.viewNext).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(session.pageIndex >= last),
        new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.viewPostPublicly).setLabel("Post Publicly").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(SCHEDULE_MGMT_CUSTOM_IDS.viewBack).setLabel("Back").setStyle(ButtonStyle.Secondary)
      )
    ],
  };
}

function renderPostSetupScheduleView(session: ScheduleViewSession) {
  const last = POST_SETUP_MAX_WEEK - 1;
  const onLastPage = session.pageIndex >= last;
  return {
    embeds: [buildPostSetupWeekEmbed(session)],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.prev).setLabel("Previous Week").setStyle(ButtonStyle.Secondary).setDisabled(session.pageIndex <= 0),
        new ButtonBuilder().setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.next).setLabel("Next Week").setStyle(ButtonStyle.Primary).setDisabled(onLastPage),
        new ButtonBuilder()
          .setCustomId(POST_SETUP_SCHEDULE_CUSTOM_IDS.finish)
          .setLabel("Finish Setup")
          .setStyle(ButtonStyle.Success)
          .setDisabled(!onLastPage),
      ),
    ],
  };
}
