import { firstOffseasonStage, isCfb, isRegularSeasonWeek, isTerminalSeasonStage, nextLeagueStage, stageForWeek, stageLabel } from "@rec/shared";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import { getCurrentLeagueContext } from "../league-context/league-context.service.js";
import { assertLeagueNotFrozen } from "../subscriptions/entitlements.service.js";
import { resolveSeasonId, resolveSeasonNumber } from "../league-context/season.service.js";
import { leagueWeekGamesQuery } from "../league-context/league-games.query.js";
import { rebuildSeasonDisplayRecords } from "../display-records/display-records.service.js";
import { gameResultsApplyKey, rebuildOfficialRecordsAfterBoxScore } from "../official-records/official-records.service.js";
import { computePowerRankings, snapshotPowerRankings } from "../schedule/power-rankings.service.js";
import { invalidateLeagueComputeCaches } from "../../lib/compute-cache.js";
import { postDiscordChannelMessage, purgeDiscordChannelMessages } from "../../lib/discord-guild.js";
import { saveWeeklyPanel } from "../submission-state/submission-state.service.js";
import { loadResultsAndPendingSubmissions } from "../schedule/team-schedule.service.js";
import { setLeagueWeek } from "./league-week.service.js";
import { getLeagueDataMode } from "./data-mode.service.js";
import { recordAdvanceDmRun } from "./advance-dm.service.js";
import { zonedWallTimeToUtc } from "../../lib/timezone.js";
import { formatTeamDisplayName, resolveTeamSchool } from "../users/user-profile-stats.service.js";
import { cancelAllWagersForGame, listConfirmableWagers, resolveWagersOnAdvance } from "../wagers/wagers.service.js";
import { sendPushToUsers } from "../push/push.service.js";
import { mapWithConcurrency } from "../../lib/concurrency.js";
import { stageHasScheduledGames } from "./league-stage.util.js";
import { clearWeeklyScoreReviewsForWeek } from "./weekly-scores.service.js";
import { publishScheduledMediaForAdvance, publishTransitionStory } from "../hub/story-publishing.js";
import { recordHubAnnouncement } from "../hub/hub.service.js";
import { autoAssignGotwForWeek, createGotwPoll, settleGotwPollsForGame } from "../gotw/gotw.service.js";
import { scoreWeekGotwCandidates } from "../gotw/gotw-nomination.service.js";
import { syncDraftOrderFromLeagueStandings } from "../draft-picks/draft-picks.service.js";
import { autoPrepareEosPayouts } from "./eos-payouts.service.js";
import { autoPrepareEosAwards, closeAndSettleEosAwardVoting } from "./eos-awards.service.js";
import { retireStaleDefenseNicknames } from "./defense-nicknames.service.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { cleanupSeasonHighlights, settleGameOfTheYear, settleSeasonHighlightAwards } from "../highlights/highlights.service.js";
import { postGameChatSystemMessage } from "../game-chat/game-chat.service.js";
import { getGlobalEconomyConfig } from "../economy/global-economy-config.service.js";
import { creditOrBacklog } from "../economy/economy-backlog.js";
import { updateAdvanceProgress } from "./advance-progress.service.js";
import { getSchedulingPayoutMultiplier, topUpOtherWeeklyPayoutsForSchedulingBonus } from "../scheduling/scheduling-bonus.service.js";

const PURCHASE_DEADLINE_LABELS: Record<string, string> = {
  custom_player: "custom players", legend: "legends", attribute: "attribute upgrades",
  dev_upgrade: "development upgrades", age_reset: "age resets", contract: "contract adjustments",
};

async function publishPurchaseDeadlineReminder(input: { guildId: string; leagueId: string; nextStage: string; nextWeek: number }) {
  const config = await supabase.from("rec_league_configuration").select("purchase_deadlines").eq("league_id", input.leagueId).maybeSingle();
  if (config.error) throw config.error;
  const deadlines = config.data?.purchase_deadlines && typeof config.data.purchase_deadlines === "object"
    ? config.data.purchase_deadlines as Record<string, { stage?: string; week?: number }>
    : {};
  const upcoming = Object.entries(deadlines).filter(([, deadline]) => {
    const deadlineWeek = Number(deadline?.week ?? 0);
    return deadline?.stage === input.nextStage && (deadlineWeek - input.nextWeek === 1 || deadlineWeek - input.nextWeek === 2);
  });
  if (!upcoming.length) return;
  const grouped = new Map<number, string[]>();
  for (const [kind, deadline] of upcoming) {
    const week = Number(deadline.week);
    grouped.set(week, [...(grouped.get(week) ?? []), PURCHASE_DEADLINE_LABELS[kind] ?? kind.replaceAll("_", " ")]);
  }
  const lines = [...grouped.entries()].sort(([a], [b]) => a - b).map(([week, labels]) =>
    `Week ${week}: ${labels.join(", ")}. Purchases close when that week begins.`,
  );
  await recordHubAnnouncement({
    guildId: input.guildId,
    title: "Purchase deadline approaching",
    body: lines.join("\n"),
  });
}

async function notifyLeagueMembersOfAdvance(input: {
  leagueId: string;
  leagueName: string;
  game: string;
  weekNumber: number;
}) {
  const [assignments, memberships] = await Promise.all([
    supabase
      .from("rec_team_assignments")
      .select("user_id")
      .eq("league_id", input.leagueId)
      .eq("assignment_status", "active")
      .is("ended_at", null),
    supabase.from("rec_league_memberships").select("user_id").eq("league_id", input.leagueId),
  ]);
  if (assignments.error || memberships.error) throw assignments.error ?? memberships.error;
  const userIds = [...new Set(
    [...(assignments.data ?? []), ...(memberships.data ?? [])]
      .map((row: any) => row.user_id)
      .filter(Boolean),
  )];
  if (!userIds.length) return;
  const gameLabel = input.game.replaceAll("_", " ").toUpperCase();
  const title = `${input.leagueName} (${gameLabel}) has advanced to week ${input.weekNumber}`;
  const inserted = await supabase.from("rec_site_notifications").insert(
    userIds.map((userId) => ({
      user_id: userId,
      league_id: input.leagueId,
      kind: "league_advanced",
      title,
      body: input.game.startsWith("madden")
        ? "Open League News for the latest around-the-league news."
        : "Open Campus Buzz for the latest around-the-league news.",
      href: `/l/${input.leagueId}/buzz`,
    })),
  );
  if (inserted.error) throw inserted.error;
}

async function publishLeagueAdvanceAnnouncement(input: {
  guildId: string;
  leagueId: string;
  seasonNumber: number;
  weekNumber: number;
  seasonStage: string;
  game: string;
  nextAdvanceLabel: string;
}) {
  const label = stageLabel(input.seasonStage, input.weekNumber, input.game);
  const title =
    input.seasonStage === "regular_season"
      ? `League advanced to Week ${input.weekNumber}`
      : `League advanced to ${label}`;

  // Offseason stages (end of season recap, transfer portal, signing day, etc.) have no real
  // slate — skip the games query entirely rather than risk listing stale/leftover rows that
  // happen to share this week_number from the last real gameplay week.
  const hasScheduledGames = stageHasScheduledGames(input.seasonStage, input.game);
  const games = hasScheduledGames
    ? await (async () => {
        // Every season restarts at week 1, so rec_games legitimately has a week_number=1 row
        // for each past season too — without a season_id filter this pulls every season's
        // slate for that week number, not just the current one (the exact bug that put last
        // year's Week 1 games in this year's advance announcement).
        const seasonId = await resolveSeasonId(input.leagueId, input.seasonNumber);
        return leagueWeekGamesQuery(supabase, { leagueId: input.leagueId, seasonId, weekNumber: input.weekNumber },
          "id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(name,display_nick,display_city,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(name,display_nick,display_city,is_relocated)",
        )
          .not("home_user_id", "is", null)
          .not("away_user_id", "is", null)
          .order("created_at", { ascending: true });
      })()
    : { data: [] as any[] };

  const lines = (games.data ?? []).map((game: any) => {
    const away = input.game === "cfb_27" ? resolveTeamSchool(game.away_team) ?? formatTeamDisplayName(game.away_team) : formatTeamDisplayName(game.away_team);
    const home = input.game === "cfb_27" ? resolveTeamSchool(game.home_team) ?? formatTeamDisplayName(game.home_team) : formatTeamDisplayName(game.home_team);
    return `${away} at ${home}`;
  });

  const body = lines.length
    ? `Next advance: ${input.nextAdvanceLabel}\n\nH2H Matchups:\n${lines.map((line) => `• ${line}`).join("\n")}\n\nUse your matchup card on the main League page for scheduling, uploads, reactions, and help.`
    : `Next advance: ${input.nextAdvanceLabel}\n\n${label} is live. Check the main League page for this week's slate.`;

  await recordHubAnnouncement({
    guildId: input.guildId,
    title,
    body,
  });
}

function powerRankingMoveArrow(change: number | null | undefined): string {
  if (change == null) return "NEW";
  if (change > 0) return `+${change}`;
  if (change < 0) return `${change}`;
  return "–";
}

// Plain REST embed (no discord.js dependency here — apps/api posts straight to Discord's
// REST API) mirroring the bot's own buildPowerRankingsEmbed (apps/bot/src/flows/schedule.ts).
function buildPowerRankingsEmbedPayload(data: any) {
  const teams: any[] = data?.teams ?? [];
  const title = `Power Rankings — Season ${data?.currentSeason ?? 1}`;
  if (!teams.length) return { title, color: 0x8b5cf6, description: "No teams to rank yet." };
  const header = data.hasPreviousWeek
    ? "Record + point differential, with bonus weight for actually playing (posted box scores) and winning close H2H games. Movement compares to last week."
    : "Record + point differential, with bonus weight for actually playing (posted box scores) and winning close H2H games.";
  const board = teams.map((t) => `(${powerRankingMoveArrow(t.change)}) \`${String(t.rank).padStart(2)}\` ${t.abbr ?? t.teamName} — **${(t.score ?? 0).toFixed(3)}**`);
  return { title, color: 0x8b5cf6, description: [header, "", board.join("\n")].join("\n").slice(0, 4096) };
}

// The same Announcements channel the site/app hub announcement mirrors to (see
// recordHubAnnouncement) also gets the weekly power-rankings board upon advance.
async function publishPowerRankingsToDiscord(input: { guildId: string; announcementsChannelId: string | null | undefined; completedWeekNumber: number }) {
  if (!input.announcementsChannelId) return;
  const data = await computePowerRankings(input.guildId, null, { completedWeekNumber: input.completedWeekNumber });
  await postDiscordChannelMessage(input.announcementsChannelId, { embeds: [buildPowerRankingsEmbedPayload(data)] });
}

const WEEKLY_SUBMISSIONS_PLAYABLE_STAGES = new Set(["regular_season", "wild_card", "divisional", "conference_championship", "super_bowl", "cfp_first_round", "cfp_quarterfinals", "cfp_semifinals", "national_championship"]);

// Server-side twin of the bot's publishWeeklySubmissionsPanel (apps/bot/src/flows/weekly-submissions.ts)
// — posts straight to Discord's REST API instead of through a live gateway client, since
// advance completion can now be triggered from the web with no bot process involved. Custom
// IDs must stay byte-identical to WEEKLY_SUBMISSIONS_CUSTOM_IDS so the bot's interaction
// handler still responds to clicks on this panel.
async function republishWeeklySubmissionsPanel(input: { guildId: string; routes: Record<string, unknown>; seasonNumber: number; seasonStage: string; weekNumber: number }) {
  if (!WEEKLY_SUBMISSIONS_PLAYABLE_STAGES.has(input.seasonStage)) return;
  const channelId = String(input.routes?.box_scores_channel_id ?? "");
  if (!channelId) return;
  const context = await getCurrentLeagueContext(input.guildId);
  // This "BOX SCORE SUBMISSIONS" panel only makes sense when the league is actually on box
  // scores — an import/manual-mode league doesn't expect coaches to post screenshots here.
  if ((await getLeagueDataMode(context.leagueId)) !== "box_scores") return;
  await purgeDiscordChannelMessages(channelId);
  const stageText = input.seasonStage.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
  const weekText = input.seasonStage === "regular_season" ? `Week ${input.weekNumber}` : stageText;
  // rec_games is scoped by season_id, not season_number (the column doesn't exist on rec_games) —
  // filtering by season_number errored on every call, so this panel load always threw.
  const seasonId = await resolveSeasonId(context.leagueId, input.seasonNumber);
  const games = await leagueWeekGamesQuery(supabase, { leagueId: context.leagueId, seasonId, weekNumber: input.weekNumber },
    "id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(name,abbreviation),away_team:rec_teams!rec_games_away_team_id_fkey(name,abbreviation)");
  if (games.error) throw new ApiError(500, "We couldn't load box-score channel matchups. Please try again.", games.error);
  const fields = (games.data ?? []).filter((game: any) => game.home_user_id || game.away_user_id).slice(0, 25).map((game: any) => {
    const home = Array.isArray(game.home_team) ? game.home_team[0] : game.home_team;
    const away = Array.isArray(game.away_team) ? game.away_team[0] : game.away_team;
    return { name: `${away?.abbreviation ?? away?.name ?? "Away"} at ${home?.abbreviation ?? home?.name ?? "Home"}`, value: game.home_user_id && game.away_user_id ? "H2H" : "Human vs CPU", inline: false };
  });
  const currentPanel = await postDiscordChannelMessage(channelId, {
    content: "@everyone",
    embeds: [{
      title: `SEASON ${input.seasonNumber} · ${weekText.toUpperCase()}`,
      color: 0xd9a521,
      description: [
        "## BOX SCORE SUBMISSIONS",
        "Only coaches listed below may post. Submit exactly **two console screenshots**—together in one message or one at a time within 60 seconds. Text and non-image posts are removed automatically.",
        "For CFB, use the postgame statistics box score or reopen the completed game's box score from the Dynasty main page. Submit the overview/top screen first and remaining team-stat screen second. REC parses both images and sends the result to commissioner review.",
      ].join("\n\n"),
      fields: fields.length ? fields : [{ name: "No eligible matchups", value: "There are no H2H or human-vs-CPU box scores due for this stage." }],
    }, {
      title: "REFERENCE IMAGE 1 OF 2 · SUBMIT FIRST", color: 0xd9a521,
      image: { url: `${process.env.REC_SITE_URL ?? "https://rec-leagues.com"}/guides/cfb-box-score-example-1.jpg` },
    }, {
      title: "REFERENCE IMAGE 2 OF 2 · SUBMIT SECOND", color: 0xd9a521,
      image: { url: `${process.env.REC_SITE_URL ?? "https://rec-leagues.com"}/guides/cfb-box-score-example-2.jpg` },
    }],
    allowed_mentions: { parse: ["everyone"] },
  });
  if (currentPanel) await saveWeeklyPanel({ guildId: input.guildId, seasonNumber: input.seasonNumber, seasonStage: input.seasonStage, weekNumber: input.weekNumber, channelId, messageId: currentPanel.id });
  return;

  /* Legacy multi-purpose weekly-submissions panel retained for migration history.
  {
    const sent = await postDiscordChannelMessage(channelId, {
      content: "@everyone",
      embeds: [{
        title: "REC Weekly Submissions",
        color: 0xd9a521,
        description: weeklySubmissionsDescription({ seasonNumber: input.seasonNumber, weekText }),
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: "rec:weekly_submissions:box_scores", label: "Box Scores" },
          { type: 2, style: 2, custom_id: "rec:weekly_submissions:player_stats", label: "Player Stats" },
          { type: 2, style: 3, custom_id: "rec:weekly_submissions:recruiting", label: "Recruiting Commits" },
        ],
      }],
      allowed_mentions: { parse: ["everyone"] },
    });
    if (sent) {
      await saveWeeklyPanel({ guildId: input.guildId, seasonNumber: input.seasonNumber, seasonStage: input.seasonStage, weekNumber: input.weekNumber, channelId, messageId: sent.id });
    }
    return;
  }
  const sent = await postDiscordChannelMessage(channelId, {
    embeds: [{
      title: "REC Weekly Submissions",
      color: 0xd9a521,
      description: `Season ${input.seasonNumber} • ${weekText}\n\nUse the buttons below. Submission messages are captured and removed so this panel stays in focus.`,
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: "rec:weekly_submissions:box_scores", label: "Box Scores" },
        { type: 2, style: 2, custom_id: "rec:weekly_submissions:player_stats", label: "Player Stats" },
        { type: 2, style: 3, custom_id: "rec:weekly_submissions:recruiting", label: "Recruiting Commits" },
      ],
    }],
  });
  if (sent) {
    await saveWeeklyPanel({ guildId: input.guildId, seasonNumber: input.seasonNumber, seasonStage: input.seasonStage, weekNumber: input.weekNumber, channelId, messageId: sent!.id });
  }
  */
}

type AdvanceGameResultInput = {
  gameId: string;
  outcome: "home" | "away" | "tie";
  // Optional real final scores; when absent we fall back to a 1–0 win/loss flag.
  homeScore?: number | null;
  awayScore?: number | null;
  designation?: "played" | "fair_sim" | "force_win";
};

async function postWeeklyFinalResultsRecap(input: { guildId: string; leagueId: string; seasonNumber: number; weekNumber: number; game: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const channelId = String((context.routes as any)?.announcements_channel_id ?? "");
  if (!channelId) return { posted: false, games: 0 };
  const results = await supabase.from("rec_game_results")
    .select("game_id,home_team_id,away_team_id,home_score,away_score,is_tie")
    .eq("league_id", input.leagueId).eq("season_number", input.seasonNumber).eq("week_number", input.weekNumber);
  if (results.error) throw results.error;
  const rows = results.data ?? [];
  if (!rows.length) return { posted: false, games: 0 };
  const teamIds = [...new Set(rows.flatMap((row: any) => [row.home_team_id, row.away_team_id]).filter(Boolean))];
  const teams = teamIds.length
    ? await supabase.from("rec_teams").select("id,name,display_nick,display_city,is_relocated").in("id", teamIds)
    : { data: [], error: null };
  if (teams.error) throw teams.error;
  const teamById = new Map<string, any>((teams.data ?? []).map((team: any): [string, any] => [String(team.id), team]));
  const label = (teamId: string | null) => {
    const team = teamId ? teamById.get(String(teamId)) : null;
    return input.game === "cfb_27" ? resolveTeamSchool(team) ?? formatTeamDisplayName(team) ?? "TBD" : formatTeamDisplayName(team) ?? "TBD";
  };
  const lines = rows.map((row: any) => {
    const away = label(row.away_team_id);
    const home = label(row.home_team_id);
    const awayScore = Number(row.away_score ?? 0);
    const homeScore = Number(row.home_score ?? 0);
    const winner = row.is_tie ? null : homeScore > awayScore ? home : away;
    return row.is_tie
      ? `**${away} ${awayScore} — ${homeScore} ${home}** · Tie`
      : `**${away} ${awayScore} — ${homeScore} ${home}** · ${winner} wins`;
  });
  const descriptions: string[] = [];
  let chunk = "";
  for (const line of lines) {
    if (chunk && chunk.length + line.length + 2 > 3900) { descriptions.push(chunk); chunk = ""; }
    chunk += `${chunk ? "\n" : ""}${line}`;
  }
  if (chunk) descriptions.push(chunk);
  await postDiscordChannelMessage(channelId, {
    embeds: descriptions.slice(0, 10).map((description, index) => ({
      title: index === 0 ? `Week ${input.weekNumber} — Final Results` : `Week ${input.weekNumber} — Final Results (continued)`,
      color: 0xd9a521,
      description,
      footer: index === descriptions.length - 1 ? { text: `${rows.length} game${rows.length === 1 ? "" : "s"} completed` } : undefined,
    })),
  });
  return { posted: true, games: rows.length };
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

/** Publishes the Madden playoff race from Week 16 onward. Imported EA seeds are the
 * authority when available; the stored season seed table remains authoritative once
 * commissioners lock the bracket. Postseason rounds use the actual next-week schedule,
 * which naturally preserves NFL reseeding instead of trying to predict future pairings. */
async function publishMaddenPlayoffPicture(input: {
  guildId: string; leagueId: string; seasonNumber: number; weekNumber: number; seasonStage: string; game: string;
}) {
  if (!input.game.startsWith("madden")) return;
  const isRaceWeek = input.seasonStage === "regular_season" && input.weekNumber >= 16 && input.weekNumber <= 18;
  const isPostseason = ["wild_card", "divisional", "conference_championship", "super_bowl"].includes(input.seasonStage);
  if (!isRaceWeek && !isPostseason) return;

  const primaryAngle = `playoff_picture_${input.seasonStage}_${input.weekNumber}`;
  const existing = await supabase.from("rec_game_stories").select("id").eq("league_id", input.leagueId)
    .eq("season", input.seasonNumber).eq("primary_angle", primaryAngle).limit(1);
  if (existing.error) throw existing.error;
  if (existing.data?.length) return;

  const [teams, fixedSeeds, importedSeeds] = await Promise.all([
    supabase.from("rec_teams").select("id,name,display_nick,display_city,is_relocated,conference").eq("league_id", input.leagueId),
    supabase.from("rec_season_team_seeds").select("team_id,conference,seed,made_playoffs,division_winner")
      .eq("league_id", input.leagueId).eq("season_number", input.seasonNumber),
    supabase.from("rec_team_standings_snapshots").select("team_id,conference_name,playoff_seed,made_playoffs,week_number,updated_at")
      .eq("league_id", input.leagueId).eq("season_number", input.seasonNumber)
      .order("week_number", { ascending: false }).order("updated_at", { ascending: false }),
  ]);
  if (teams.error || fixedSeeds.error || importedSeeds.error) throw teams.error ?? fixedSeeds.error ?? importedSeeds.error;
  const teamById = new Map<string, any>((teams.data ?? []).map((team: any) => [String(team.id), team]));
  const importedByTeam = new Map<string, any>();
  for (const row of importedSeeds.data ?? []) if (!importedByTeam.has(String(row.team_id))) importedByTeam.set(String(row.team_id), row);
  const fixedByTeam = new Map<string, any>((fixedSeeds.data ?? []).map((row: any) => [String(row.team_id), row]));
  const seeded = [...teamById.keys()].map((teamId) => {
    const fixed = fixedByTeam.get(teamId);
    const imported = importedByTeam.get(teamId);
    const team = teamById.get(teamId);
    const seed = Number(fixed?.seed ?? imported?.playoff_seed ?? 0);
    const conference = String(fixed?.conference ?? imported?.conference_name ?? team?.conference ?? "").toUpperCase();
    return { teamId, team, seed, conference, madePlayoffs: Boolean(fixed?.made_playoffs ?? imported?.made_playoffs ?? seed > 0) };
  }).filter((row) => row.seed > 0 && row.madePlayoffs && (row.conference.includes("AFC") || row.conference.includes("NFC")));
  const seedLabel = (teamId: string) => {
    const row = seeded.find((item) => item.teamId === teamId);
    const team = teamById.get(teamId);
    const name = formatTeamDisplayName(team) ?? "TBD";
    return row ? `${name} (${ordinal(row.seed)} Seed - ${row.conference.includes("AFC") ? "AFC" : "NFC"})` : name;
  };

  const sections: string[] = [];
  if (seeded.length) {
    for (const conference of ["AFC", "NFC"]) {
      const rows = seeded.filter((row) => row.conference.includes(conference)).sort((a, b) => a.seed - b.seed);
      if (rows.length) sections.push(`**${conference} Playoff Field**\n${rows.map((row) => `${row.seed}. ${seedLabel(row.teamId)}`).join("\n")}`);
    }
  }

  if (isRaceWeek && seeded.length) {
    const projected: string[] = [];
    for (const conference of ["AFC", "NFC"]) {
      const rows = seeded.filter((row) => row.conference.includes(conference));
      const bySeed = new Map(rows.map((row) => [row.seed, row]));
      const bye = bySeed.get(1);
      if (bye) projected.push(`• ${seedLabel(bye.teamId)} — first-round bye`);
      for (const [high, low] of [[2, 7], [3, 6], [4, 5]] as const) {
        const home = bySeed.get(high); const away = bySeed.get(low);
        if (home && away) projected.push(`• ${seedLabel(away.teamId)} at ${seedLabel(home.teamId)}`);
      }
    }
    if (projected.length) sections.push(`**Projected Wild Card Matchups**\n${projected.join("\n")}`);
  } else if (isPostseason) {
    const seasonId = await resolveSeasonId(input.leagueId, input.seasonNumber);
    const games = await leagueWeekGamesQuery(supabase, { leagueId: input.leagueId, seasonId, weekNumber: input.weekNumber }, "id,away_team_id,home_team_id");
    if (games.error) throw games.error;
    const matchupLines = (games.data ?? []).map((game: any) => `• ${seedLabel(String(game.away_team_id))} at ${seedLabel(String(game.home_team_id))}`);
    if (matchupLines.length) sections.push(`**${stageLabel(input.seasonStage, input.weekNumber, input.game)} Matchups**\n${matchupLines.join("\n")}`);
  }
  if (!sections.length) sections.push("The playoff field is still being finalized. Updated seeds and matchups will appear as soon as the league data confirms them.");

  const headline = isRaceWeek ? `Week ${input.weekNumber} NFL Playoff Picture` : `${stageLabel(input.seasonStage, input.weekNumber, input.game)} Playoff Bracket Update`;
  const body = `${sections.join("\n\n")}\n\nNFL format: seven teams per conference, the No. 1 seed receives the first-round bye, and each conference is reseeded after every round.`;
  await publishTransitionStory({ guildId: input.guildId, headline, body, primaryAngle, storyType: "article" });
  await recordHubAnnouncement({ guildId: input.guildId, title: headline, body });
}

// Delegates to the shared canonical week->stage mapping instead of hand-rolling a second,
// independently-drifting copy of it (this one had fallen out of sync with league-stage.ts twice).
function phaseForWeek(weekNumber: number, game: string | null) {
  return stageForWeek(weekNumber, game);
}

const BOX_SCORE_SOURCES = ["box_score", "box_score_screenshot"];
// Sources that already settle a game so the advance wizard doesn't re-ask for it.
// schedule_screenshot = scores pre-logged from a League Schedule screenshot upload.
// manual = scores/outcomes entered via the Manual Scores tool.
// madden_companion_import = scores pre-logged from a Madden Companion App schedule export.
const RESOLVED_RESULT_SOURCES = [...BOX_SCORE_SOURCES, "schedule_screenshot", "manual", "madden_companion_import"];

// Extracted so the multi-week Advance Jump preview can walk several future weeks'
// worth of "games needing input" without mutating any league state (getAdvanceWeekGames
// below always reads the league's live current week/stage; this takes them as params).
async function loadWeekGamesForStage(context: any, seasonNumber: number, weekNumber: number, seasonStage: string) {
  if (!stageHasScheduledGames(seasonStage, context.rec_leagues.game)) return { games: [], gamesNeedingInput: [] };

  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);

  const { data: games, error } = await leagueWeekGamesQuery(supabase, { leagueId: context.leagueId, seasonId, weekNumber },
    "id,external_game_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,is_bowl_game,is_national_championship,advance_outcome_override,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)");
  if (error) throw new ApiError(500, "We couldn't load the week schedule. Please try again.", error);

  const [results, boxScores] = await Promise.all([
    supabase
      .from("rec_game_results")
      .select("id,external_game_id,home_team_id,away_team_id,source,home_score,away_score")
      .eq("league_id", context.leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", weekNumber),
    supabase
      .from("rec_box_score_submissions")
      .select("id,game_id,status")
      .eq("league_id", context.leagueId)
      .eq("season_number", seasonNumber)
      .eq("week_number", weekNumber)
      .in("status", ["pending", "approved"]),
  ]);

  if (results.error) throw new ApiError(500, "We couldn't load existing game results right now. Please try again.", results.error);
  if (boxScores.error) throw new ApiError(500, "We couldn't load box score submissions right now. Please try again.", boxScores.error);

  // Live assignments — schedule seed often writes null home_user_id/away_user_id before
  // coaches claim teams. Game channels (and advance H2H filtering) must not treat those
  // stale columns as authoritative; same overlay as GOTW nomination/auto-assign.
  const teamIds = [...new Set((games ?? []).flatMap((g: any) => [g.home_team_id, g.away_team_id]).filter(Boolean))];
  const assignments = teamIds.length
    ? await supabase.from("rec_team_assignments").select("team_id,user_id")
      .eq("league_id", context.leagueId).in("team_id", teamIds)
      .eq("assignment_status", "active").is("ended_at", null)
    : { data: [] as any[], error: null };
  if (assignments.error) throw new ApiError(500, "We couldn't load team assignments for this week's games. Please try again.", assignments.error);
  const userByTeam = new Map((assignments.data ?? []).map((row: any) => [row.team_id, row.user_id as string]));

  const boxScoreGameIds = new Set((boxScores.data ?? []).map((row) => String(row.game_id)).filter(Boolean));
  const resultByMatchup = new Map<string, { source: string | null; home_score: number | null; away_score: number | null }>(
    (results.data ?? []).map((row: any) => [`${row.home_team_id}:${row.away_team_id}`, { source: row.source ?? null, home_score: row.home_score ?? null, away_score: row.away_score ?? null }]),
  );

  // Force Win is a manual-apply label only (see scheduling/matchup-scheduling.service.ts) --
  // this just surfaces which matchups were flagged so the commissioner knows to apply one
  // during advance. Fair Sim is the unflagged default and needs no equivalent badge.
  const gameIds = (games ?? []).map((g: any) => g.id);
  const fwFlags = gameIds.length
    ? await supabase.from("rec_game_scheduling").select("game_id,fw_flagged,fw_flagged_for_user_id").in("game_id", gameIds).eq("fw_flagged", true)
    : { data: [] as any[], error: null };
  const fwFlagByGameId = new Map((fwFlags.data ?? []).map((row: any) => [String(row.game_id), row.fw_flagged_for_user_id as string | null]));

  const mapped = (games ?? []).map((game: any) => {
    const hasBoxScore = boxScoreGameIds.has(String(game.id));
    const resultRow = resultByMatchup.get(`${game.home_team_id}:${game.away_team_id}`) ?? null;
    const existingSource = resultRow?.source ?? null;
    const hasOfficialResult = existingSource != null && RESOLVED_RESULT_SOURCES.includes(String(existingSource));
    const needsInput = !hasBoxScore && !hasOfficialResult;
    const homeUserId = userByTeam.get(game.home_team_id) ?? game.home_user_id ?? null;
    const awayUserId = userByTeam.get(game.away_team_id) ?? game.away_user_id ?? null;
    const isH2h = Boolean(homeUserId && awayUserId);
    return {
      gameId: game.id,
      weekNumber: game.week_number,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeUserId,
      awayUserId,
      homeTeamName: formatTeamDisplayName(game.home_team) ?? game.home_team?.name ?? "Home",
      awayTeamName: formatTeamDisplayName(game.away_team) ?? game.away_team?.name ?? "Away",
      hasBoxScore,
      existingResultSource: existingSource,
      needsInput,
      isCpuGame: !isH2h,
      isH2h,
      isBowlGame: Boolean(game.is_bowl_game),
      isNationalChampionship: Boolean(game.is_national_championship),
      homeScore: resultRow?.home_score ?? null,
      awayScore: resultRow?.away_score ?? null,
      fwFlaggedForUserId: fwFlagByGameId.get(String(game.id)) ?? null,
      approvedDesignation: game.advance_outcome_override === "fw" ? "force_win" : game.advance_outcome_override === "fs" ? "fair_sim" : null,
    };
  });

  return { games: mapped, gamesNeedingInput: mapped.filter((game) => game.needsInput) };
}

export async function getAdvanceWeekGames(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  const nextTarget = nextLeagueStage(currentWeek, currentStage, context.rec_leagues.game);
  const nextLabel = stageLabel(nextTarget.seasonStage, nextTarget.weekNumber, context.rec_leagues.game);

  const { games, gamesNeedingInput } = await loadWeekGamesForStage(context, seasonNumber, currentWeek, currentStage);

  return {
    league: context.rec_leagues,
    dataMode: await getLeagueDataMode(context.leagueId),
    lastAdvanceAt: context.rec_leagues.last_advance_at ?? null,
    lastAdvanceTimezone: context.rec_leagues.last_advance_timezone ?? null,
    seasonNumber,
    currentWeek,
    currentStage,
    nextWeekNumber: nextTarget.weekNumber,
    nextSeasonStage: nextTarget.seasonStage,
    nextLabel,
    games,
    gamesNeedingInput,
  };
}

// Commissioner Command Center's missing-box-score panel: a targeted nudge to one or both
// coaches of a specific game still needing input, distinct from the bulk advance-deadline DM
// (advance-dm.service.ts) which fires league-wide only once, close to the deadline.
// Posts "SCHEDULE YOUR GAME ASAP" into wherever the two coaches actually are — the game's
// Discord channel (tagging them) if one is tracked and still active, and the site's game
// chat for that matchup either way. Dynamic import of game-channels.service.js avoids a
// circular static import (it already imports getAdvanceWeekGames from this file).
async function notifyScheduleGameAsap(input: { leagueId: string; gameId: string; userIds: string[]; headline?: string; chatBody?: string }) {
  const { getGameChannelByGameId } = await import("../game-channels/game-channels.service.js");
  const channel = await getGameChannelByGameId(input.gameId);
  if (!channel) return;

  const accounts = await supabase.from("rec_discord_accounts").select("user_id,discord_id").in("user_id", input.userIds);
  if (accounts.error) throw new ApiError(500, "We couldn't load Discord mentions for the schedule notice. Please try again.", accounts.error);
  const discordIds = (accounts.data ?? []).map((row: any) => String(row.discord_id)).filter(Boolean);
  const headline = input.headline ?? "**SCHEDULE YOUR GAME ASAP**";

  if (channel.discord_channel_id) {
    const mentions = discordIds.map((id) => `<@${id}>`).join(" ");
    await postDiscordChannelMessage(channel.discord_channel_id, {
      content: `${mentions ? `${mentions} ` : ""}${headline}`.trim(),
      allowed_mentions: { users: discordIds },
    });
  }

  await postGameChatSystemMessage({
    gameChannelId: channel.id,
    leagueId: input.leagueId,
    gameId: input.gameId,
    body: input.chatBody ?? `${headline} — a commissioner flagged this matchup as overdue.`,
  });
}

const NOTIFY_MISSING_BOX_SCORE_COPY = {
  box_score: {
    pushTitle: "Box score needed",
    pushBody: (away: string, home: string) => `${away} @ ${home} still needs a result before the league can advance.`,
    headline: "**BOX SCORE NEEDED**",
    chatBody: "**BOX SCORE NEEDED** — a commissioner is waiting on this game's final result before the league can advance.",
  },
  schedule: {
    pushTitle: "Schedule your game",
    pushBody: (away: string, home: string) => `${away} @ ${home} hasn't been played yet — get it scheduled.`,
    headline: "**SCHEDULE YOUR GAME ASAP**",
    chatBody: "**SCHEDULE YOUR GAME ASAP** — a commissioner flagged this matchup as overdue.",
  },
  both: {
    pushTitle: "Box score needed / schedule your game",
    pushBody: (away: string, home: string) => `${away} @ ${home} — get it scheduled and played, or submit its result, before the league can advance.`,
    headline: "**BOX SCORE NEEDED / SCHEDULE YOUR GAME ASAP**",
    chatBody: "**BOX SCORE NEEDED / SCHEDULE YOUR GAME ASAP** — a commissioner is waiting on this matchup, either to get it played or to get its result submitted.",
  },
} as const;

export async function notifyMissingBoxScore(input: { guildId: string; gameId: string; target: "home" | "away" | "both"; reason?: "box_score" | "schedule" | "both"; notifiedByDiscordId: string }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const week = await getAdvanceWeekGames(input.guildId);
  const game = week.gamesNeedingInput.find((g) => g.gameId === input.gameId);
  if (!game) throw new ApiError(404, "This game isn't currently missing a result.");

  const userIds = [
    input.target !== "away" ? game.homeUserId : null,
    input.target !== "home" ? game.awayUserId : null,
  ].filter((id): id is string => Boolean(id));
  if (!userIds.length) throw new ApiError(400, "No user to notify for this side.");

  const copy = NOTIFY_MISSING_BOX_SCORE_COPY[input.reason ?? "box_score"];

  await sendPushToUsers(userIds, {
    title: copy.pushTitle,
    body: copy.pushBody(game.awayTeamName, game.homeTeamName),
    url: `/matchups/${game.gameId}`,
  });

  await notifyScheduleGameAsap({
    leagueId: context.leagueId,
    gameId: game.gameId,
    userIds,
    headline: copy.headline,
    chatBody: copy.chatBody,
  }).catch((err) =>
    console.error("[ERROR] Failed to post box-score/schedule notice (non-fatal):", err),
  );

  await writeAuditLog({
    action: "notify_missing_box_score",
    entityType: "missing_box_score_notice",
    entityId: game.gameId,
    newValue: { target: input.target, notifyReason: input.reason ?? "box_score", userIds, weekNumber: game.weekNumber, notifiedByDiscordId: input.notifiedByDiscordId, leagueId: context.leagueId },
    reason: `Notified ${input.target} for ${game.awayTeamName} @ ${game.homeTeamName}`,
  });

  return { ok: true as const, notifiedUserIds: userIds };
}

// Commissioner marks a CFB postseason game as a bowl game / the national championship
// (auto-suggested by week where derivable, but always editable) — both are automatic GOTW
// games, so flagging one immediately assigns its poll if it's an H2H matchup without one yet.
export async function setGamePostseasonFlags(input: { guildId: string; gameId: string; isBowlGame: boolean; isNationalChampionship: boolean }) {
  const context = await getCurrentLeagueContext(input.guildId);
  const game = await supabase
    .from("rec_games")
    .select("id,week_number,home_user_id,away_user_id")
    .eq("id", input.gameId)
    .eq("league_id", context.leagueId)
    .maybeSingle();
  if (game.error) throw new ApiError(500, "We couldn't load that game. Please try again.", game.error);
  if (!game.data) throw new ApiError(404, "Game was not found in this league.");

  const updated = await supabase
    .from("rec_games")
    .update({ is_bowl_game: input.isBowlGame, is_national_championship: input.isNationalChampionship, updated_at: new Date().toISOString() })
    .eq("id", input.gameId)
    .select("*")
    .single();
  if (updated.error) throw new ApiError(500, "We couldn't save postseason flags. Please try again.", updated.error);

  if ((input.isBowlGame || input.isNationalChampionship) && game.data.home_user_id && game.data.away_user_id) {
    await autoAssignGotwForWeek({ guildId: input.guildId, weekNumber: game.data.week_number }).catch((err) => {
      console.error("[ERROR] autoAssignGotwForWeek failed after flagging a postseason game (non-fatal):", err);
    });
  }

  return { game: updated.data };
}

export type WeeklyH2hGame = {
  gameId: string;
  homeUserId: string | null;
  awayUserId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  status: "missing" | "awaiting_review" | "final";
  result: { homeScore: number; awayScore: number; isTie: boolean; winnerTeamName: string | null } | null;
};

// Home page's read-only "this week's H2H games" panel — same week/team-pair source as
// getAdvanceWeekGames above, but scoped to human-vs-human matchups only and enriched with
// actual scores (getAdvanceWeekGames only needs to know IF a result exists, not what it
// says, so it never selects home_score/away_score). Reuses the same result/pending-
// submission correlation as the schedule builder (loadResultsAndPendingSubmissions) instead
// of re-deriving that logic a third time.
export async function getWeeklyH2hGames(guildId: string): Promise<{ weekLabel: string; games: WeeklyH2hGame[] }> {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  const weekLabel = stageLabel(currentStage, currentWeek, context.rec_leagues.game ?? null);

  if (!stageHasScheduledGames(currentStage, context.rec_leagues.game)) {
    return { weekLabel, games: [] };
  }

  const seasonId = await resolveSeasonId(context.leagueId, seasonNumber);
  const { data: games, error } = await leagueWeekGamesQuery(supabase, { leagueId: context.leagueId, seasonId, weekNumber: currentWeek },
    "id,week_number,home_team_id,away_team_id,home_user_id,away_user_id,home_team:rec_teams!rec_games_home_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(id,name,abbreviation,display_city,display_nick,is_relocated)");
  if (error) throw new ApiError(500, "We couldn't load the week schedule. Please try again.", error);

  const h2hGames = (games ?? []).filter((g: any) => g.home_user_id && g.away_user_id);
  const resultsAndSubmissions = await loadResultsAndPendingSubmissions(
    context.leagueId,
    seasonNumber,
    h2hGames.map((g: any) => ({ id: g.id, weekNumber: g.week_number, homeTeamId: g.home_team_id, awayTeamId: g.away_team_id })),
  );

  const mapped: WeeklyH2hGame[] = h2hGames.map((g: any) => {
    const extra = resultsAndSubmissions.get(g.id);
    const homeTeamName = formatTeamDisplayName(g.home_team) ?? g.home_team?.name ?? "Home";
    const awayTeamName = formatTeamDisplayName(g.away_team) ?? g.away_team?.name ?? "Away";
    let status: WeeklyH2hGame["status"] = "missing";
    let result: WeeklyH2hGame["result"] = null;
    if (extra?.result) {
      status = "final";
      const winnerTeamName = extra.result.isTie ? null : extra.result.homeScore > extra.result.awayScore ? homeTeamName : awayTeamName;
      result = { homeScore: extra.result.homeScore, awayScore: extra.result.awayScore, isTie: extra.result.isTie, winnerTeamName };
    } else if (extra?.pendingBoxScoreSubmissionId) {
      status = "awaiting_review";
    }
    return { gameId: g.id, homeUserId: g.home_user_id ?? null, awayUserId: g.away_user_id ?? null, homeTeamName, awayTeamName, status, result };
  });

  return { weekLabel, games: mapped };
}

export async function completeAdvanceWeek(input: {
  guildId: string;
  nextWeekNumber: number;
  nextSeasonStage: string;
  advancedByDiscordId: string;
  results: AdvanceGameResultInput[];
  nextAdvance?: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    tzLabel: string;
  } | null;
  nextGotwGameId?: string | null;
  advanceRunId?: string | null;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  await assertLeagueNotFrozen(context.leagueId);
  const seasonNumber = resolveSeasonNumber(context);
  const currentWeek = Number(context.rec_leagues.current_week ?? 1);
  const currentStage = String(context.rec_leagues.season_stage ?? "regular_season");
  const nextTarget = nextLeagueStage(currentWeek, currentStage, context.rec_leagues.game);
  const now = new Date().toISOString();

  // Fully sequential here used to mean one HTTP request awaiting several DB round-trips PLUS
  // GOTW/wager/story side effects for EVERY game in the week, one at a time — a CFB week's ~20
  // games routinely pushed this past a minute of wall-clock time, long enough for the mobile
  // network or a reverse-proxy timeout to kill the connection ("Load failed" client-side) before
  // the response ever came back, even though the advance itself was still completing server-side.
  // Each game's work here is independent (its own row, no shared mutable state across iterations
  // besides read-only context/seasonNumber/currentWeek/now), so bounded concurrency is safe.
  await mapWithConcurrency(input.results, 6, async (result) => {
    const game = await supabase
      .from("rec_games")
      .select(
        "id,external_game_id,week_number,phase,home_team_id,away_team_id,home_user_id,away_user_id,is_bowl_game,is_national_championship,bowl_name,home_team:rec_teams!rec_games_home_team_id_fkey(name,display_nick,display_city,is_relocated),away_team:rec_teams!rec_games_away_team_id_fkey(name,display_nick,display_city,is_relocated)",
      )
      .eq("id", result.gameId)
      .eq("league_id", context.leagueId)
      .maybeSingle();
    if (game.error) throw new ApiError(500, "We couldn't load that game for the week advance. Please try again.", game.error);
    if (!game.data) throw new ApiError(404, "Scheduled game not found.");

    // rec_games.home_user_id/away_user_id can be stale or null (schedule seed writes them
    // before coaches claim teams — see loadWeekGamesForStage above for the same overlay).
    // Trusting those raw columns here silently wrote null user ids into rec_game_results,
    // which official-records rebuilds key off of — a whole week's results could go missing
    // from every affected user's W/L record with no error anywhere.
    const assignments = await supabase
      .from("rec_team_assignments")
      .select("team_id,user_id")
      .eq("league_id", context.leagueId)
      .in("team_id", [game.data.home_team_id, game.data.away_team_id].filter(Boolean))
      .eq("assignment_status", "active")
      .is("ended_at", null);
    if (assignments.error) throw new ApiError(500, "We couldn't load team assignments for this week's games. Please try again.", assignments.error);
    const userByTeam = new Map((assignments.data ?? []).map((row: any) => [row.team_id, row.user_id as string]));
    const homeUserId = userByTeam.get(game.data.home_team_id) ?? game.data.home_user_id ?? null;
    const awayUserId = userByTeam.get(game.data.away_team_id) ?? game.data.away_user_id ?? null;

    // Prefer real final scores when the commissioner supplied them; otherwise fall
    // back to a 1–0 win/loss flag (legacy behavior).
    const hasRealScores = result.homeScore != null && result.awayScore != null;
    const homeScore = hasRealScores ? Number(result.homeScore) : result.outcome === "home" ? 1 : 0;
    const awayScore = hasRealScores ? Number(result.awayScore) : result.outcome === "away" ? 1 : 0;
    const isTie = result.outcome === "tie";
    const winningUserId = isTie ? null : result.outcome === "home" ? homeUserId : awayUserId;
    const losingUserId = isTie ? null : result.outcome === "home" ? awayUserId : homeUserId;
    const winningTeamId = isTie ? null : result.outcome === "home" ? game.data.home_team_id : game.data.away_team_id;
    const losingTeamId = isTie ? null : result.outcome === "home" ? game.data.away_team_id : game.data.home_team_id;
    const recordsApplyKey = gameResultsApplyKey({
      gameId: game.data.id,
      leagueId: context.leagueId,
      seasonNumber,
      weekNumber: game.data.week_number ?? currentWeek,
      homeTeamId: game.data.home_team_id,
      awayTeamId: game.data.away_team_id,
    });

    const priorResult = await supabase.from("rec_game_results").select("source").eq("records_apply_key", recordsApplyKey).maybeSingle();
    await supabase.from("rec_game_results").upsert(
      {
        league_id: context.leagueId,
        game_id: game.data.id,
        season_number: seasonNumber,
        week_number: game.data.week_number ?? currentWeek,
        game_type: game.data.phase ?? phaseForWeek(currentWeek, context.rec_leagues.game),
        external_game_id: game.data.external_game_id ?? null,
        home_team_id: game.data.home_team_id,
        away_team_id: game.data.away_team_id,
        home_user_id: homeUserId,
        away_user_id: awayUserId,
        home_score: homeScore,
        away_score: awayScore,
        winning_user_id: winningUserId,
        losing_user_id: losingUserId,
        winning_team_id: winningTeamId,
        losing_team_id: losingTeamId,
        is_user_h2h: Boolean(homeUserId && awayUserId),
        is_cpu_game: !(homeUserId && awayUserId),
        is_tie: isTie,
        is_playoff: !isRegularSeasonWeek(game.data.week_number ?? currentWeek, context.rec_leagues.game),
        source: priorResult.data?.source ?? "commissioner_advance",
        records_apply_key: recordsApplyKey,
        updated_at: now,
      },
      { onConflict: "records_apply_key", ignoreDuplicates: false },
    );

    // Settle any GOTW poll tied to this game against the real result (idempotent — a no-op
    // if box-score approval or manual score entry already settled it earlier). Force Wins are
    // predetermined, so those polls are voided instead of logged to records/payouts. Fair Sims
    // still settle picks — the simulated result is a 50/50 outcome.
    await settleGotwPollsForGame({
      guildId: input.guildId,
      gameId: game.data.id,
      winningTeamId,
      administrativeOutcome: result.designation === "force_win",
    }).catch((err) => {
      console.error("[ERROR] settleGotwPollsForGame failed during advance (non-fatal):", err);
    });
    // Imported/manual scores receive the same result payout as an approved box score. Fair
    // Sims and Force Wins are administrative outcomes, so neither participant is paid.
    if (result.designation !== "fair_sim" && result.designation !== "force_win" && !BOX_SCORE_SOURCES.includes(String(priorResult.data?.source ?? ""))) {
      const payoutConfig = (await getGlobalEconomyConfig()).submissions;
      const schedulingMultiplier = await getSchedulingPayoutMultiplier({ gameId: game.data.id, homeUserId, awayUserId });
      for (const [userId, baseAmount, outcomeLabel] of [[winningUserId, payoutConfig.boxScoreWin, "win"], [losingUserId, payoutConfig.boxScoreLoss, "loss"]] as const) {
        if (!userId || isTie) continue;
        await creditOrBacklog({
          leagueId: context.leagueId,
          seasonNumber,
          userId,
          amount: baseAmount,
          description: `Game result payout (${outcomeLabel}) — Wk ${game.data.week_number ?? currentWeek}`,
          transactionType: "game_result_payout",
          source: "box_score",
          sourceReference: { gameId: game.data.id, userId, outcome: outcomeLabel },
        });
        if (schedulingMultiplier === 2) {
          await creditOrBacklog({
            leagueId: context.leagueId,
            seasonNumber,
            userId,
            amount: baseAmount,
            description: `Scheduling completion bonus (${outcomeLabel}) — Wk ${game.data.week_number ?? currentWeek}`,
            transactionType: "scheduling_bonus_payout",
            source: "box_score",
            sourceReference: { gameId: game.data.id, userId },
          });
          await topUpOtherWeeklyPayoutsForSchedulingBonus({
            leagueId: context.leagueId,
            seasonNumber,
            weekNumber: game.data.week_number ?? currentWeek,
            gameId: game.data.id,
            userId,
          }).catch((error) => console.error("[ERROR] Failed to top up other weekly payouts for scheduling bonus (non-fatal):", error));
        }
      }
    }
    if (result.designation === "force_win") {
      await cancelAllWagersForGame({ guildId: input.guildId, gameId: game.data.id, reason: "force_win" });
    }

    // Surface any pending wager this result just made settle-ready. The Discord bot does this
    // itself (refreshConfirmableWagerEmbeds, called from its own interactive advance wizard)
    // but that only fires for an advance actually run through the bot — a web-dashboard advance,
    // or a late/corrected result entered for an already-passed week, went straight through this
    // API path with nothing ever re-checking wagers for it. Confirmed live: a week-2 wager sat
    // "pending" with no commissioner-inbox row for a full week after its result was entered,
    // because the week-2-to-3 advance had already run resolveWagersOnAdvance before this result
    // existed, and nothing re-checked it afterward. listConfirmableWagers is idempotent —
    // already-recorded inbox rows are a no-op via recordWagerInbox's own dedupe.
    await listConfirmableWagers(context.leagueId).catch((err) => {
      console.error("[ERROR] listConfirmableWagers failed during advance (non-fatal):", err);
    });

    // Bowl games and the national championship don't get a regular weekly recap otherwise
    // (they're often the only game that week, or the league is heading straight into the
    // offseason) — post a dedicated recap so who-played/who-won isn't lost.
    if (game.data.is_bowl_game || game.data.is_national_championship) {
      const away: any = game.data.away_team;
      const home: any = game.data.home_team;
      const awayName = context.rec_leagues.game === "cfb_27" ? resolveTeamSchool(away) ?? formatTeamDisplayName(away) : formatTeamDisplayName(away);
      const homeName = context.rec_leagues.game === "cfb_27" ? resolveTeamSchool(home) ?? formatTeamDisplayName(home) : formatTeamDisplayName(home);
      const winnerName = isTie ? null : winningTeamId === game.data.home_team_id ? homeName : awayName;
      const loserName = isTie ? null : winnerName === homeName ? awayName : homeName;
      const gameLabel = game.data.is_national_championship
        ? "National Championship"
        : (String(game.data.bowl_name ?? "").trim() || "Bowl Game");
      await publishTransitionStory({
        guildId: input.guildId,
        headline: winnerName ? `${gameLabel}: ${winnerName} Wins` : `${gameLabel} Ends in a Tie`,
        body: winnerName
          ? `${winnerName} defeated ${loserName} ${Math.max(homeScore, awayScore)}-${Math.min(homeScore, awayScore)} in the ${gameLabel}.`
          : `${awayName} and ${homeName} tied ${awayScore}-${homeScore} in the ${gameLabel}.`,
        primaryAngle: game.data.is_national_championship ? "national_championship_recap" : "bowl_game_recap",
      }).catch((err) => console.error("[ERROR] Failed to publish bowl/national championship recap (non-fatal):", err));
    }
  });

  updateAdvanceProgress(input.advanceRunId, "Advancing league week and processing awards");

  const advanceResult = await setLeagueWeek({
    guildId: input.guildId,
    weekNumber: nextTarget.weekNumber,
    seasonStage: nextTarget.seasonStage,
    seasonNumber,
  });

  await notifyLeagueMembersOfAdvance({
    leagueId: context.leagueId,
    leagueName: context.rec_leagues.name,
    game: context.rec_leagues.game,
    weekNumber: nextTarget.weekNumber,
  }).catch((err) => {
    console.error("[ERROR] notifyLeagueMembersOfAdvance failed after advance (non-fatal):", err);
  });

  updateAdvanceProgress(input.advanceRunId, "Publishing the playoff picture and bracket");
  await publishMaddenPlayoffPicture({
    guildId: input.guildId,
    leagueId: context.leagueId,
    seasonNumber,
    weekNumber: nextTarget.weekNumber,
    seasonStage: nextTarget.seasonStage,
    game: context.rec_leagues.game,
  }).catch((err) => console.error("[ERROR] Madden playoff-picture publishing failed after advance (non-fatal):", err));

  // Bowl games / the national championship are automatic GOTW games in CFB leagues —
  // catches any flagged game in the week just advanced INTO that doesn't have a poll yet.
  await autoAssignGotwForWeek({
    guildId: input.guildId,
    weekNumber: nextTarget.weekNumber,
    allH2h: nextTarget.seasonStage !== "regular_season",
  }).catch((err) => {
    console.error("[ERROR] autoAssignGotwForWeek failed after advance (non-fatal):", err);
  });
  if (nextTarget.seasonStage === "regular_season" && input.nextGotwGameId) {
    const candidates = await scoreWeekGotwCandidates(input.guildId, nextTarget.weekNumber);
    const selected = candidates.find((candidate) => candidate.gameId === input.nextGotwGameId);
    if (!selected) throw new ApiError(400, "The selected Game of the Week is not an eligible H2H matchup for the next week.");
    await createGotwPoll({
      guildId: input.guildId,
      gameId: selected.gameId,
      awayTeamId: selected.awayTeamId,
      homeTeamId: selected.homeTeamId,
      awayUserId: selected.awayUserId,
      homeUserId: selected.homeUserId,
      awayTeamName: selected.awayTeamName,
      homeTeamName: selected.homeTeamName,
      weekNumber: nextTarget.weekNumber,
    });
  }

  // EOS payouts: automatic for every league, firing once postseason play actually ends —
  // advancing out of the terminal stage (super_bowl/national_championship) into the first
  // offseason stage (coach_hiring for Madden, players_leaving for CFB's dynasty pipeline).
  const isPostseasonEnd = isTerminalSeasonStage(String(context.rec_leagues.season_stage ?? ""), context.rec_leagues.game)
    && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game);
  if (isPostseasonEnd) {
    await autoPrepareEosPayouts({
      guildId: input.guildId,
      leagueId: context.leagueId,
      game: context.rec_leagues.game,
      seasonNumber,
      requestedByDiscordId: input.advancedByDiscordId,
    }).catch((err) => console.error("[ERROR] autoPrepareEosPayouts failed after advance (non-fatal):", err));
  }

  // EOS Awards: auto-issues Best Passing/Rushing/Defense outright and opens the 3 web
  // voting polls (MVP, Best User Skills, Most Heart) on the same postseason-end boundary
  // as the EOS payouts above. Voting stays open for the whole first offseason stage —
  // see the settle trigger further below, which fires when the league advances OUT of it.
  if (isPostseasonEnd) {
    await autoPrepareEosAwards(input.guildId).catch((err) => console.error("[ERROR] autoPrepareEosAwards failed after advance (non-fatal):", err));
  }

  // Power rankings/SOS/ratings are short-TTL cached (see compute-cache.ts) — an advance
  // changes the results those are computed from, so drop the cache now instead of leaving
  // the next viewer looking at a stale week for up to the TTL.
  invalidateLeagueComputeCaches(input.guildId);

  // Independent, non-fatal cleanup/rebuild steps — none feed data into another,
  // so run them in parallel instead of one after another.
  await Promise.all([
    // The previously-scheduled advance just happened, so clear it -- but keep its timestamp as
    // last_advance_at first, so the next Advance modal can default to "same time, next day"
    // instead of requiring the commissioner to re-enter it from scratch every week.
    supabase
      .from("rec_leagues")
      .update({
        next_advance_at: null, next_advance_timezone: null,
        last_advance_at: context.rec_leagues.next_advance_at ?? new Date().toISOString(),
        last_advance_timezone: context.rec_leagues.next_advance_timezone ?? context.rec_leagues.last_advance_timezone ?? null,
      })
      .eq("id", context.leagueId)
      .then(({ error }) => {
        if (error) console.error("[ERROR] Failed to clear next_advance_at on advance (non-fatal):", error);
      }),
    // The completed week's weekly-score review is now stale — clear it.
    clearWeeklyScoreReviewsForWeek(context.leagueId, seasonNumber, currentWeek).catch((err) => {
      console.error("[ERROR] clearWeeklyScoreReviewsForWeek failed after advance (non-fatal):", err);
    }),
    // Rebuild display records after advancing — non-fatal so a stale/empty table doesn't block the week flip.
    rebuildSeasonDisplayRecords(context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] rebuildSeasonDisplayRecords failed after advance (non-fatal):", err);
    }),
    // commissioner_advance is an OFFICIAL_RESULT_SOURCES member (a league that advances
    // weeks without ever uploading a box score would otherwise have most of its games
    // missing from official/global win-loss and point-differential records).
    rebuildOfficialRecordsAfterBoxScore({ leagueId: context.leagueId, seasonNumber }).catch((err) => {
      console.error("[ERROR] rebuildOfficialRecordsAfterBoxScore failed after advance (non-fatal):", err);
    }),
    // Snapshot power rankings for the week that just completed, so next week can show movement.
    snapshotPowerRankings(context.leagueId, seasonNumber, currentWeek, context.rec_leagues.game).catch((err) => {
      console.error("[ERROR] snapshotPowerRankings failed after advance (non-fatal):", err);
    }),
    // Shift year-1 (current) draft pick numbers as league standings change.
    (context.rec_leagues.game === "madden_26" || context.rec_leagues.game === "madden_27")
      ? syncDraftOrderFromLeagueStandings({
        leagueId: context.leagueId,
        draftSeasonNumber: seasonNumber,
        standingsSeasonNumber: seasonNumber,
      }).catch((err) => {
        console.error("[ERROR] syncDraftOrderFromLeagueStandings failed after advance (non-fatal):", err);
      })
      : Promise.resolve(),
  ]);

  const timingConfig = await supabase
    .from("rec_league_configuration")
    .select("advance_timing,advance_timing_other")
    .eq("league_id", context.leagueId)
    .maybeSingle();
  const fallbackTiming = String(
    timingConfig.data?.advance_timing === "other"
      ? timingConfig.data?.advance_timing_other || "Custom schedule"
      : timingConfig.data?.advance_timing || "24hr",
  );
  let nextAdvanceLabel = fallbackTiming;
  if (input.nextAdvance) {
    await setNextAdvanceTime({ guildId: input.guildId, ...input.nextAdvance });
    const { year, month, day, hour, minute, tzLabel } = input.nextAdvance;
    const ampm = hour < 12 ? "AM" : "PM";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    nextAdvanceLabel = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${hour12}:${String(minute).padStart(2, "0")} ${ampm} ${tzLabel}`;
  }
  updateAdvanceProgress(input.advanceRunId, "Posting league announcements and rankings");
  await publishLeagueAdvanceAnnouncement({
    guildId: input.guildId,
    leagueId: context.leagueId,
    seasonNumber,
    weekNumber: nextTarget.weekNumber,
    seasonStage: nextTarget.seasonStage,
    game: context.rec_leagues.game,
    nextAdvanceLabel,
  }).catch((err) => {
    console.error("[ERROR] publishLeagueAdvanceAnnouncement failed after advance (non-fatal):", err);
  });
  updateAdvanceProgress(input.advanceRunId, "Posting weekly final-results recap");
  await postWeeklyFinalResultsRecap({ guildId: input.guildId, leagueId: context.leagueId, seasonNumber, weekNumber: currentWeek, game: context.rec_leagues.game })
    .catch((err) => console.error("[ERROR] Weekly final-results recap failed after advance (non-fatal):", err));

  await publishPurchaseDeadlineReminder({
    guildId: input.guildId,
    leagueId: context.leagueId,
    nextStage: nextTarget.seasonStage,
    nextWeek: nextTarget.weekNumber,
  }).catch((err) => {
    console.error("[ERROR] purchase-deadline reminder failed after advance (non-fatal):", err);
  });

  await publishPowerRankingsToDiscord({
    guildId: input.guildId,
    announcementsChannelId: context.routes?.announcements_channel_id as string | null | undefined,
    completedWeekNumber: currentWeek,
  }).catch((err) => {
    console.error("[ERROR] publishPowerRankingsToDiscord failed after advance (non-fatal):", err);
  });

  // Mark the advance run last, after badges/baselines settle, so its badge snapshot
  // reflects end-of-week state and `advanced_at` anchors the next Advance DM window.
  await recordAdvanceDmRun({
    leagueId: context.leagueId,
    seasonNumber,
    fromWeek: currentWeek,
    toWeek: nextTarget.weekNumber,
    fromStage: currentStage,
    toStage: nextTarget.seasonStage,
    advancedByDiscordId: input.advancedByDiscordId,
  }).catch((err) => {
    console.error("[ERROR] recordAdvanceDmRun failed after advance (non-fatal):", err);
  });

  await publishScheduledMediaForAdvance(input.guildId).catch((err) => {
    console.error("[ERROR] publishScheduledMediaForAdvance failed after advance (non-fatal):", err);
  });

  // Career badges are always computed continuously from all-time stored games (see
  // box-score-intelligence/persistence.ts), and game/season-scope badges naturally
  // start fresh once the next season's games begin — no season-end conversion or
  // wipe step needed.

  // Retire any "This Defense Needs a Name" nickname that didn't requalify this season
  // (CFB only — the category itself is CFB-only). Runs on the same terminal-stage ->
  // offseason boundary as the EOS payout auto-fire above.
  if (isCfb(context.rec_leagues.game) && isTerminalSeasonStage(currentStage, context.rec_leagues.game) && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game)) {
    await retireStaleDefenseNicknames(context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] retireStaleDefenseNicknames failed after advance (non-fatal):", err);
    });
  }

  // Play of the Year: auto-tallies every regular-season highlight's reactions (Discord +
  // web) and creates a pending award review per category winner (commissioner still
  // approves the payout in Pending Payouts, same as every other payout in this app —
  // this step only auto-determines the winner and drafts the payout, never issues it
  // itself). Same terminal-stage -> offseason boundary as the automations above, and
  // must run BEFORE the highlight cleanup right below it, which only preserves
  // highlights that already have a season_award review on record.
  if (isTerminalSeasonStage(currentStage, context.rec_leagues.game) && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game)) {
    await settleSeasonHighlightAwards(input.guildId).catch((err) => {
      console.error("[ERROR] settleSeasonHighlightAwards failed after advance (non-fatal):", err);
    });
  }

  // Game of the Year: tallies "like" reactions across every H2H game this season and
  // creates a pending review per tied leader — commissioner picks the winner (approving
  // one denies the rest) from Pending Payouts, same tie-break pattern as everywhere else.
  // Same terminal-stage -> offseason boundary; order relative to POTY/highlight cleanup
  // doesn't matter since it reads game reactions, not highlight posts.
  if (isTerminalSeasonStage(currentStage, context.rec_leagues.game) && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game)) {
    await settleGameOfTheYear(input.guildId).catch((err) => {
      console.error("[ERROR] settleGameOfTheYear failed after advance (non-fatal):", err);
    });
  }

  // EOS Awards voting closes once the league leaves the first offseason stage (the
  // window the 3 web polls stay open for) — tally real votes, settle every open poll,
  // and post one headline per award.
  if (currentStage === firstOffseasonStage(context.rec_leagues.game) && nextTarget.seasonStage !== firstOffseasonStage(context.rec_leagues.game)) {
    await closeAndSettleEosAwardVoting(input.guildId).catch((err) => {
      console.error("[ERROR] closeAndSettleEosAwardVoting failed after advance (non-fatal):", err);
    });
  }

  // Season-end highlight cleanup: hard-deletes every non-POTY-winning highlight
  // (Discord message + Stream asset + DB row) and posts one combined headline
  // announcing every category winner. POTY winners remain playable until the
  // league itself is deleted. Same terminal-stage -> offseason boundary as the
  // automations above — must run AFTER settleSeasonHighlightAwards immediately
  // above, which is what actually creates the season_award reviews this cleanup
  // checks for.
  if (isTerminalSeasonStage(currentStage, context.rec_leagues.game) && nextTarget.seasonStage === firstOffseasonStage(context.rec_leagues.game)) {
    await cleanupSeasonHighlights(input.guildId, context.leagueId, seasonNumber).catch((err) => {
      console.error("[ERROR] cleanupSeasonHighlights failed after advance (non-fatal):", err);
    });
  }

  // Refund any wager past its 1-week box-score grace period (and any peer challenge
  // nobody took). Wagers still within grace, or already resolvable, are left pending —
  // see resolveWagersOnAdvance for the full grace-period rule. Returns Discord message
  // coords so the bot can delete the stale pending embeds / open-challenge announcements.
  // Non-fatal.
  const wagerCleanup = await resolveWagersOnAdvance({
    leagueId: context.leagueId,
    seasonNumber,
    nextWeekNumber: nextTarget.weekNumber,
  }).catch((err) => {
    console.error("[ERROR] resolveWagersOnAdvance failed after advance (non-fatal):", err);
    return { refundedCount: 0, refundedMessages: [] as any[] };
  });

  await republishWeeklySubmissionsPanel({
    guildId: input.guildId,
    routes: context.routes ?? {},
    seasonNumber,
    seasonStage: nextTarget.seasonStage,
    weekNumber: nextTarget.weekNumber,
  }).catch((error) => console.error("[WARN] Failed to refresh box-score channel after advance:", error));
  return { ...advanceResult, nextWeekNumber: nextTarget.weekNumber, nextSeasonStage: nextTarget.seasonStage, nextLabel: stageLabel(nextTarget.seasonStage, nextTarget.weekNumber, context.rec_leagues.game), nextAdvanceLabel, wagerCleanup };
}

export async function getDivisionWinnerOptions(guildId: string) {
  const context = await getCurrentLeagueContext(guildId);
  const seasonNumber = resolveSeasonNumber(context);

  const { data: teams, error } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,display_city,display_nick,is_relocated,conference,division")
    .eq("league_id", context.leagueId)
    .order("conference", { ascending: true })
    .order("division", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new ApiError(500, "We couldn't load teams for division winner selection. Please try again.", error);

  const divisions = new Map<string, any>();
  for (const team of teams ?? []) {
    const conference = String(team.conference ?? "Conference");
    const division = String(team.division ?? "Division");
    const key = `${conference}:${division}`;
    const existing = divisions.get(key) ?? {
      key,
      conference,
      division,
      label: `${conference} ${division}`.trim(),
      teams: [],
    };
    existing.teams.push({
      id: team.id,
      name: formatTeamDisplayName(team) ?? team.name ?? team.abbreviation ?? "Team",
      abbreviation: team.abbreviation ?? null,
    });
    divisions.set(key, existing);
  }

  return { league: { id: context.leagueId, seasonNumber }, divisions: [...divisions.values()] };
}

export async function saveDivisionWinners(input: {
  guildId: string;
  seasonNumber: number;
  selectedByDiscordId: string;
  winners: Array<{ divisionKey: string; teamId: string }>;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const now = new Date().toISOString();
  const requested = new Map(input.winners.map((winner) => [winner.divisionKey, winner.teamId]));
  if (!requested.size) throw new ApiError(400, "Select at least one division winner.");

  const teamIds = [...new Set(input.winners.map((winner) => winner.teamId))];
  const { data: teams, error: teamsError } = await supabase
    .from("rec_teams")
    .select("id,name,abbreviation,conference,division")
    .eq("league_id", context.leagueId)
    .in("id", teamIds);
  if (teamsError) throw new ApiError(500, "We couldn't validate division winners. Please try again.", teamsError);

  const teamsById = new Map<string, any>((teams ?? []).map((team: any) => [team.id, team]));
  const seedRows: Array<Record<string, unknown>> = [];
  for (const [divisionKey, teamId] of requested.entries()) {
    const team = teamsById.get(teamId);
    if (!team) throw new ApiError(400, "One selected division winner is not in this league.");
    const expectedKey = `${team.conference ?? "Conference"}:${team.division ?? "Division"}`;
    if (expectedKey !== divisionKey) {
      throw new ApiError(400, `${team.name ?? team.abbreviation ?? "Selected team"} is not in ${divisionKey.replace(":", " ")}.`);
    }
    seedRows.push({
      league_id: context.leagueId,
      season_number: input.seasonNumber,
      team_id: teamId,
      conference: team.conference ?? null,
      division_name: team.division ?? null,
      division_winner: true,
      made_playoffs: true,
      updated_at: now,
    });
  }

  await supabase
    .from("rec_season_team_seeds")
    .update({ division_winner: false, updated_at: now })
    .eq("league_id", context.leagueId)
    .eq("season_number", input.seasonNumber)
    .then(({ error }) => {
      if (error) throw new ApiError(500, "We couldn't clear previous division winners. Please try again.", error);
    });

  const upsert = await supabase
    .from("rec_season_team_seeds")
    .upsert(seedRows, { onConflict: "league_id,season_number,team_id" })
    .select("team_id,conference,division_name,division_winner");
  if (upsert.error) throw new ApiError(500, "We couldn't save division winners. Please try again.", upsert.error);

  // Division standings/seeding is still real structure for Madden's playoff bracket
  // (rec_season_team_seeds.division_winner/made_playoffs above) — only the badge that
  // used to piggyback on this selection is gone: the new badge set replaces
  // division_champion with conf_champion/div_champion, which are earned automatically
  // by actually winning the conference-championship/divisional-round game (see
  // reigningChampionBadges in box-score-intelligence/persistence.ts), not hand-picked
  // by a commissioner here.
  return {
    saved: upsert.data ?? [],
  };
}

export async function listAdvanceGameStories(input: {
  guildId: string;
  seasonNumber: number;
  weekNumber: number;
  includePosted?: boolean;
}) {
  const context = await getCurrentLeagueContext(input.guildId);

  let query = supabase
    .from("rec_game_stories")
    .select("id,game_id,season,week,winner_team_id,loser_team_id,primary_angle,headline,body,notes,posted_message_id,posted_channel_id,created_at")
    .eq("league_id", context.leagueId)
    .eq("season", input.seasonNumber)
    .eq("week", input.weekNumber)
    .order("created_at", { ascending: true });
  if (!input.includePosted) query = query.is("posted_message_id", null);
  const { data: stories, error } = await query;
  if (error) throw new ApiError(500, "We couldn't load game stories for publishing. Please try again.", error);

  const teamIds = [...new Set((stories ?? []).flatMap((story) => [story.winner_team_id, story.loser_team_id]).filter(Boolean))];

  const teamsResult = teamIds.length
    ? await supabase.from("rec_teams").select("id,name,abbreviation,display_city,display_nick,is_relocated").in("id", teamIds)
    : { data: [] as any[], error: null };
  if (teamsResult.error) throw new ApiError(500, "We couldn't load story teams for publishing. Please try again.", teamsResult.error);

  const teamById = new Map((teamsResult.data ?? []).map((team: any) => [team.id, formatTeamDisplayName(team) ?? team.name ?? team.abbreviation ?? "Team"]));

  return {
    league: { id: context.leagueId, seasonNumber: input.seasonNumber, weekNumber: input.weekNumber },
    stories: (stories ?? []).map((story) => ({
      id: story.id,
      gameId: story.game_id,
      season: story.season,
      week: story.week,
      winnerTeamId: story.winner_team_id,
      loserTeamId: story.loser_team_id,
      winnerTeamName: teamById.get(story.winner_team_id) ?? null,
      loserTeamName: teamById.get(story.loser_team_id) ?? null,
      primaryAngle: story.primary_angle,
      headline: story.headline,
      body: story.body,
      notes: Array.isArray(story.notes) ? story.notes : [],
    })),
  };
}

export async function markAdvanceGameStoryPosted(input: {
  guildId: string;
  storyId: string;
  channelId: string;
  messageId: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);
  const { data, error } = await supabase
    .from("rec_game_stories")
    .update({
      posted_channel_id: input.channelId,
      posted_message_id: input.messageId,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", context.leagueId)
    .eq("id", input.storyId)
    .select("id,posted_channel_id,posted_message_id")
    .single();
  if (error) throw new ApiError(500, "We couldn't mark that game story as posted. Please try again.", error);
  return { story: data };
}

// Store (or clear) the league's next scheduled advance time. The bot supplies a
// wall-clock date/hour plus a timezone label; we resolve it to a UTC instant.
export async function setNextAdvanceTime(input: {
  guildId: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  tzLabel: string;
}) {
  const context = await getCurrentLeagueContext(input.guildId);

  const when = zonedWallTimeToUtc(input.year, input.month, input.day, input.hour, input.minute, input.tzLabel);
  if (isNaN(when.getTime())) throw new ApiError(400, "Invalid next advance date/time.");
  if (when.getTime() <= Date.now()) throw new ApiError(400, "The next advance time must be in the future.");

  const nextAdvanceAt = when.toISOString();
  const result = await supabase
    .from("rec_leagues")
    .update({ next_advance_at: nextAdvanceAt, next_advance_timezone: input.tzLabel })
    .eq("id", context.leagueId)
    .select("id")
    .single();
  if (result.error) throw new ApiError(500, "We couldn't save the next advance time. Please try again.", result.error);

  return {
    nextAdvanceAt,
    epochSeconds: Math.floor(when.getTime() / 1000),
    tzLabel: input.tzLabel,
  };
}
