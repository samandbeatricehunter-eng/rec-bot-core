import { createHash } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import {
  fetchEaAllWeekSchedules,
  fetchEaLeagueFeed,
  fetchEaLeagueTeams,
  fetchEaLeagueTeamsAndRosters,
  fetchEaStandings,
  fetchEaWeeklyStats,
  refreshCompanionToken,
  retrieveBlazeSession,
  type EaBlazeSession,
  type EaCompanionToken,
  extractArray
} from "./ea-companion-client.js";
import { getImportJob, updateEndpointAttempt, updateImportJobStatus } from "./import.service.js";
import {
  stageGames,
  stageLeagueFeed,
  stagePlayerStats,
  stageRosters,
  stageStandings,
  stageTeamStats,
  stageTeams
} from "./import-staging.service.js";
import { captureImportRawFields } from "./raw-field-dictionary.service.js";

export type ImportEndpointExecutionResult = {
  endpointKey: string;
  endpointLabel: string;
  status: "success" | "failed" | "skipped";
  recordsFound: number;
  responseSummary?: Record<string, unknown>;
  errorMessage?: string | null;
};

type EaExecutionContext = {
  accountId: string;
  token: EaCompanionToken;
  eaLeagueId: number;
  seasonNumber: number;
  seasonIndex: number | null;
  weekFrom: number;
  weekTo: number;
  weeks: number[];
  stageIndex: number;
};

type ExecutorContext = {
  importJobId: string;
  endpointKey: string;
  endpointLabel: string;
  job: any;
  token: EaCompanionToken;
  eaLeagueId: number;
  seasonNumber: number;
  seasonIndex: number | null;
  weekFrom: number;
  weekTo: number;
  weeks: number[];
  stageIndex: number;
  session?: EaBlazeSession;
};

type EndpointExecutor = (context: ExecutorContext) => Promise<ImportEndpointExecutionResult & { session?: EaBlazeSession }>;

const DEFAULT_ENDPOINT_KEYS = ["league_metadata", "teams", "standings", "schedule", "rosters", "player_stats", "team_stats", "news", "transactions", "injuries"];

const IMPORT_PROGRESS_ENDPOINTS = [
  "league_metadata",
  "teams",
  "standings",
  "schedule",
  "rosters",
  "team_stats",
  "player_stats",
  "news",
  "transactions",
  "injuries"
] as const;

const POS_NUM: Record<number, string> = {
  0: "QB", 1: "HB", 2: "FB", 3: "WR", 4: "TE", 5: "LT", 6: "LG", 7: "C", 8: "RG", 9: "RT", 10: "LE", 11: "RE", 12: "DT", 13: "LOLB", 14: "MLB", 15: "ROLB", 16: "CB", 17: "FS", 18: "SS", 19: "K", 20: "P", 21: "KR", 22: "PR", 23: "LS"
};

function endpointLabel(endpointKey: string) {
  return endpointKey.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function getN(obj: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (value != null && value !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function getStr(obj: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (value != null && value !== "") return String(value);
  }
  return "";
}

function getBool(obj: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  }
  return false;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableJson(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function getPosition(row: Record<string, unknown>) {
  const raw = row.position ?? row.pos ?? row.playerPosition;
  if (raw == null || raw === "") {
    const numeric = Number(row.positionId ?? row.posId ?? row.playerPositionId);
    return Number.isFinite(numeric) ? POS_NUM[numeric] ?? String(numeric) : null;
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && POS_NUM[numeric]) return POS_NUM[numeric];
  return String(raw);
}

function summarizePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return { type: typeof payload };
  const keys = Object.keys(payload as Record<string, unknown>).slice(0, 20);
  return { keys };
}

async function captureRawPayload(input: { context: ExecutorContext; careerModeGet: string; payloadGroup: string; payload: unknown }) {
  await captureImportRawFields({
    leagueId: input.context.job.league_id,
    importJobId: input.context.importJobId,
    endpointKey: input.context.endpointKey,
    careerModeGet: input.careerModeGet,
    payloadGroup: input.payloadGroup,
    payload: input.payload
  });
}

async function captureWeeklyStatsPayloads(context: ExecutorContext, week: number, payloads: any) {
  await Promise.all([
    captureRawPayload({ context, careerModeGet: "CareerMode_GetWeeklyStats", payloadGroup: `week_${week}_schedules`, payload: payloads.schedules }),
    captureRawPayload({ context, careerModeGet: "CareerMode_GetWeeklyStats", payloadGroup: `week_${week}_team_stats`, payload: payloads.teamStats }),
    captureRawPayload({ context, careerModeGet: "CareerMode_GetWeeklyStats", payloadGroup: `week_${week}_passing`, payload: payloads.passing }),
    captureRawPayload({ context, careerModeGet: "CareerMode_GetWeeklyStats", payloadGroup: `week_${week}_rushing`, payload: payloads.rushing }),
    captureRawPayload({ context, careerModeGet: "CareerMode_GetWeeklyStats", payloadGroup: `week_${week}_receiving`, payload: payloads.receiving }),
    captureRawPayload({ context, careerModeGet: "CareerMode_GetWeeklyStats", payloadGroup: `week_${week}_defense`, payload: payloads.defense }),
    captureRawPayload({ context, careerModeGet: "CareerMode_GetWeeklyStats", payloadGroup: `week_${week}_kicking`, payload: payloads.kicking }),
    captureRawPayload({ context, careerModeGet: "CareerMode_GetWeeklyStats", payloadGroup: `week_${week}_punting`, payload: payloads.punting })
  ]);
}

function extractSeasonIndex(payload: unknown, rows: Record<string, unknown>[]) {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    for (const key of ["seasonIndex", "leagueSeasonIndex", "cfmSeasonIndex", "season", "seasonNum"]) {
      if (body[key] != null) return toNumber(body[key], 0);
    }
  }
  if (rows.length > 0) {
    const first = rows[0];
    for (const key of ["seasonIndex", "leagueSeasonIndex", "cfmSeasonIndex"]) {
      if (first[key] != null) return toNumber(first[key], 0);
    }
  }
  return null;
}

function getSeasonNumber(context: ExecutorContext, payload: unknown, rows: Record<string, unknown>[]) {
  const seasonIndex = extractSeasonIndex(payload, rows);
  return { seasonIndex, seasonNumber: seasonIndex == null ? context.seasonNumber : seasonIndex + 1 };
}

function getWeekBounds(job: any): { weekFrom: number; weekTo: number; weeks: number[] } {
  if (job.import_scope === "full_regular_season_schedule") return { weekFrom: 1, weekTo: 18, weeks: Array.from({ length: 18 }, (_, index) => index + 1) };
  const selected = Array.isArray(job.selected_weeks) ? [...new Set((job.selected_weeks as any[]).map((w) => toNumber(w, 0)).filter((w) => w >= 1))].sort((a, b) => a - b) : [];
  const weeks = selected.length ? selected : [toNumber(job.week_from, 1)];
  return { weekFrom: weeks[0], weekTo: weeks[weeks.length - 1], weeks };
}

async function loadEaContext(importJobId: string, job: any): Promise<EaExecutionContext> {
  const externalLeagueId = job.ea_external_league_id;
  if (!externalLeagueId) throw new ApiError(409, "Import job is missing EA external league id.");
  const franchise = await supabase.from("rec_ea_franchises").select("*, account:rec_ea_accounts(*)").eq("external_league_id", String(externalLeagueId)).maybeSingle();
  if (franchise.error) throw new ApiError(500, "Failed to load selected EA franchise.", franchise.error);
  const account = (franchise.data as any)?.account;
  if (!franchise.data || !account) throw new ApiError(404, "Selected EA franchise/account was not found. Reconnect EA and rediscover franchises.");
  if (!account.access_token || !account.refresh_token || !account.expires_at || !account.blaze_id) throw new ApiError(401, "EA reconnect required. Saved EA token data is missing or expired.", { reconnectRequired: true, importJobId });
  const token: EaCompanionToken = { accessToken: account.access_token, refreshToken: account.refresh_token, expiry: new Date(account.expires_at), console: (account.platform ?? franchise.data.console ?? "pc") as EaCompanionToken["console"], blazeId: String(account.blaze_id) };
  const { weekFrom, weekTo, weeks } = getWeekBounds(job);
  const seasonIndex = franchise.data.season_index == null ? null : toNumber(franchise.data.season_index, 0);
  const seasonNumber = seasonIndex == null ? toNumber(job.season_number ?? franchise.data.calendar_year, 1) : seasonIndex + 1;
  return { accountId: account.id, token, eaLeagueId: Number(franchise.data.external_league_id), seasonNumber, seasonIndex, weekFrom, weekTo, weeks, stageIndex: 1 };
}

async function persistRefreshedEaToken(accountId: string, token: EaCompanionToken) {
  const result = await supabase.from("rec_ea_accounts").update({ access_token: token.accessToken, refresh_token: token.refreshToken, expires_at: token.expiry.toISOString(), blaze_id: token.blazeId, updated_at: new Date().toISOString() }).eq("id", accountId);
  if (result.error) throw new ApiError(500, "Failed to persist refreshed EA token.", result.error);
}

function teamIdFromRaw(row: Record<string, unknown>) { return getN(row, "teamId", "id", "rosterId", "teamExternalId", "homeTeamId", "awayTeamId"); }

function extractTeamRows(payload: unknown, context: ExecutorContext) {
  const teams = extractArray(payload, ["leagueTeamInfoList", "teamInfoList", "teams", "leagueTeams"]) as Record<string, unknown>[];
  const { seasonIndex, seasonNumber } = getSeasonNumber(context, payload, teams);
  return teams.map((team) => {
    const teamId = teamIdFromRaw(team);
    const cityName = getStr(team, "cityName");
    const nickName = getStr(team, "nickName", "displayName", "teamName");
    const teamName = cityName && nickName ? `${cityName} ${nickName}` : nickName || cityName || `Team ${teamId}`;
    return { importJobId: context.importJobId, leagueId: context.job.league_id, eaLeagueId: context.eaLeagueId, seasonNumber, seasonIndex, teamExternalId: teamId ? String(teamId) : toStringOrNull(team.teamExternalId ?? team.abbrName), teamName, cityName: cityName || null, nickName: nickName || null, abbrName: getStr(team, "abbrName", "teamAbbr", "abbrev") || null, conference: getStr(team, "conferenceName", "conference", "confName") || null, divisionName: getStr(team, "divisionName", "divName") || null, userName: getStr(team, "userName", "user") || null, isHuman: getBool(team, "isUserControlled", "isHuman"), normalized: { teamId, teamName, cityName, nickName, abbrName: getStr(team, "abbrName", "teamAbbr", "abbrev") || null }, rawPayload: team };
  });
}

function extractStandingRows(payload: unknown, context: ExecutorContext) {
  const standings = extractArray(payload, ["teamStandingInfoList", "standingInfoList", "standings", "items"]) as Record<string, unknown>[];
  const { seasonIndex, seasonNumber } = getSeasonNumber(context, payload, standings);
  return standings.map((standing) => {
    const teamId = teamIdFromRaw(standing);
    const teamName = getStr(standing, "teamName", "displayName", "abbrName") || (teamId ? `Team ${teamId}` : "");
    return { importJobId: context.importJobId, leagueId: context.job.league_id, eaLeagueId: context.eaLeagueId, seasonNumber, seasonIndex, seasonStage: "regular_season", weekNumber: null, teamExternalId: teamId ? String(teamId) : toStringOrNull(standing.teamExternalId), teamName: teamName || null, wins: getN(standing, "totalWins", "wins", "win"), losses: getN(standing, "totalLosses", "losses", "loss"), ties: getN(standing, "totalTies", "ties", "tie"), pointsFor: getN(standing, "ptsFor", "pointsFor", "pf"), pointsAgainst: getN(standing, "ptsAgainst", "pointsAgainst", "pa"), normalized: { teamId, teamName, conferenceName: getStr(standing, "conferenceName", "confName") || null, divisionName: getStr(standing, "divisionName", "divName") || null }, rawPayload: standing };
  });
}

function extractGameRows(payload: unknown, context: ExecutorContext, weekNumber: number) {
  const games = extractArray(payload, ["gameScheduleInfoList", "leagueSchedule", "scheduleInfoList", "games", "items"]) as Record<string, unknown>[];
  const { seasonIndex, seasonNumber } = getSeasonNumber(context, payload, games);
  return games.map((game, index) => {
    const homeScore = game.homeScore ?? game.homeTeamScore ?? (game.home as any)?.score ?? (game.seasonGameInfo as any)?.homeScore;
    const awayScore = game.awayScore ?? game.awayTeamScore ?? (game.away as any)?.score ?? (game.seasonGameInfo as any)?.awayScore;
    const isPlayed = Boolean(game.isGamePlayed ?? game.played ?? (game.seasonGameInfo as any)?.isGamePlayed ?? ((game.status === 2) || (homeScore != null && awayScore != null)));
    return { importJobId: context.importJobId, leagueId: context.job.league_id, eaLeagueId: context.eaLeagueId, seasonNumber, seasonIndex, seasonStage: "regular_season", weekNumber, externalGameId: toStringOrNull(game.scheduleId ?? game.gameId ?? game.id) ?? `${weekNumber}-${index}`, homeTeamExternalId: toStringOrNull(game.homeTeamId ?? (game.home as any)?.teamId ?? (game.seasonGameInfo as any)?.homeTeamId), awayTeamExternalId: toStringOrNull(game.awayTeamId ?? (game.away as any)?.teamId ?? (game.seasonGameInfo as any)?.awayTeamId), homeTeamName: toStringOrNull(game.homeTeamName ?? (game.home as any)?.teamName ?? game.homeDisplayName), awayTeamName: toStringOrNull(game.awayTeamName ?? (game.away as any)?.teamName ?? game.awayDisplayName), homeScore: homeScore == null ? null : toNumber(homeScore), awayScore: awayScore == null ? null : toNumber(awayScore), gameStatus: isPlayed ? "complete" : "scheduled", normalized: { weekNumber, isPlayed }, rawPayload: game };
  });
}

function extractTeamStatRows(payload: unknown, context: ExecutorContext, weekNumber: number) {
  const rows = extractArray(payload, ["teamStatInfoList", "teamStatsInfoList", "teamStats", "items"]) as Record<string, unknown>[];
  const { seasonIndex, seasonNumber } = getSeasonNumber(context, payload, rows);
  return rows.map((row, index) => {
    const teamId = teamIdFromRaw(row);
    return { importJobId: context.importJobId, leagueId: context.job.league_id, eaLeagueId: context.eaLeagueId, seasonNumber, seasonIndex, seasonStage: "regular_season", weekNumber, statCategory: "team", teamExternalId: teamId ? String(teamId) : toStringOrNull(row.teamExternalId ?? `team-stat-${index}`), teamName: getStr(row, "teamName", "displayName", "abbrName") || null, stats: row, normalized: { teamId, weekNumber }, rawPayload: row };
  });
}

function extractPlayerStatRows(payload: unknown, category: string, context: ExecutorContext, weekNumber: number) {
  const rows = extractArray(payload, ["playerPassingStatInfoList", "playerPassStatInfoList", "playerPassingStatsInfoList", "playerRushingStatInfoList", "playerRushStatInfoList", "playerRushingStatsInfoList", "playerReceivingStatInfoList", "playerRecStatInfoList", "playerReceivingStatsInfoList", "playerDefensiveStatInfoList", "playerDefenseStatInfoList", "playerDefStatInfoList", "playerKickingStatInfoList", "playerKickStatInfoList", "playerPuntingStatInfoList", "playerPuntStatInfoList", "playerStatInfoList", "playerStatsInfoList", "statInfoList", "items"]) as Record<string, unknown>[];
  const { seasonIndex, seasonNumber } = getSeasonNumber(context, payload, rows);
  return rows.map((row, index) => {
    const playerId = getN(row, "rosterId", "playerId", "id");
    const teamId = getN(row, "teamId", "teamExternalId");
    const firstName = getStr(row, "firstName", "first");
    const lastName = getStr(row, "lastName", "last");
    const playerName = getStr(row, "fullName", "playerName", "name") || [firstName, lastName].filter(Boolean).join(" ");
    const sourceStatId = toStringOrNull(row.statId ?? row.sourceStatId ?? row.id);
    const sourceScheduleId = toStringOrNull(row.scheduleId ?? row.sourceScheduleId ?? row.gameId);
    return { importJobId: context.importJobId, leagueId: context.job.league_id, eaLeagueId: context.eaLeagueId, seasonNumber, seasonIndex, seasonStage: "regular_season", weekNumber, statCategory: category, sourceStatId, sourceScheduleId, playerExternalId: playerId ? String(playerId) : toStringOrNull(row.playerExternalId ?? `${category}-${weekNumber}-${index}`), playerName: playerName || null, teamExternalId: teamId ? String(teamId) : toStringOrNull(row.teamExternalId), teamName: getStr(row, "teamName", "displayName", "abbrName") || null, position: getPosition(row), stats: row, normalized: { playerId, teamId, playerName, weekNumber, category, sourceStatId, sourceScheduleId }, rawPayload: row };
  });
}

function extractRosterPlayerRows(payload: unknown, context: ExecutorContext, teamId?: number) {
  const rows = extractArray(payload, ["rosterInfoList", "playerArray", "teamRosterInfoList", "activeRosterInfoList", "playerInfoList", "rosters", "players", "rosterArray", "teamPlayerInfoList", "playerRosterInfoList", "items"]) as Record<string, unknown>[];
  const { seasonIndex, seasonNumber } = getSeasonNumber(context, payload, rows);
  return rows.map((row, index) => {
    const playerId = getN(row, "rosterId", "playerId", "id");
    const resolvedTeamId = getN(row, "teamId", "teamExternalId") || teamId || 0;
    const firstName = getStr(row, "firstName", "first");
    const lastName = getStr(row, "lastName", "last");
    const playerName = getStr(row, "fullName", "playerName", "name") || [firstName, lastName].filter(Boolean).join(" ");
    return { importJobId: context.importJobId, leagueId: context.job.league_id, eaLeagueId: context.eaLeagueId, seasonNumber, seasonIndex, teamExternalId: resolvedTeamId ? String(resolvedTeamId) : toStringOrNull(row.teamExternalId), teamName: getStr(row, "teamName", "displayName", "abbrName") || null, playerExternalId: playerId ? String(playerId) : toStringOrNull(row.playerExternalId ?? `roster-player-${index}`), playerName: playerName || null, firstName: firstName || null, lastName: lastName || null, position: getPosition(row), jerseyNumber: getN(row, "jerseyNum", "jerseyNumber", "uniformNumber") || null, overallRating: getN(row, "overallRating", "ovrRating", "overall") || null, age: getN(row, "age") || null, devTrait: getStr(row, "devTrait", "devTraitName", "developmentTrait") || null, normalized: { playerId, teamId: resolvedTeamId, playerName, position: getPosition(row) }, rawPayload: row };
  });
}

function feedEventType(endpointKey: string, row: Record<string, unknown>) {
  if (endpointKey === "news") return "league_news";
  if (endpointKey === "injuries") return "injury_update";

  const rawType = getStr(row, "transactionType", "type", "eventType", "newsType", "category").toLowerCase();
  if (rawType.includes("sign")) return "player_signed";
  if (rawType.includes("release") || rawType.includes("cut")) return "player_released";
  if (rawType.includes("trade")) return "player_traded";
  if (rawType.includes("position")) return "position_change";
  if (rawType.includes("injur")) return "injury_update";
  if (rawType.includes("ability") || rawType.includes("xfactor") || rawType.includes("superstar")) return "ability_update";
  return endpointKey === "transactions" ? "transaction" : endpointKey;
}

function extractLeagueFeedRows(payload: unknown, context: ExecutorContext, endpointKey: "news" | "transactions" | "injuries") {
  const candidateKeys = endpointKey === "news"
    ? ["newsItemList", "newsItems", "news", "leagueNews", "items"]
    : endpointKey === "transactions"
      ? ["transactionList", "transactions", "transactionInfoList", "items"]
      : ["injuryList", "injuries", "playerInjuryInfoList", "items"];
  const rows = extractArray(payload, candidateKeys) as Record<string, unknown>[];
  const { seasonIndex, seasonNumber } = getSeasonNumber(context, payload, rows);
  const guildId = toStringOrNull(context.job.server?.guild_id ?? context.job.guild_id);

  return rows.map((row, index) => {
    const eventType = feedEventType(endpointKey, row);
    const externalEventId = toStringOrNull(row.newsId ?? row.id ?? row.newsItemId ?? row.transactionId ?? row.eventId ?? row.injuryId);
    const playerId = getN(row, "rosterId", "playerId", "playerExternalId");
    const teamId = getN(row, "teamId", "teamExternalId");
    const fromTeamId = getN(row, "fromTeamId", "oldTeamId");
    const toTeamId = getN(row, "toTeamId", "newTeamId");
    const title = getStr(row, "headline", "title", "newsHeadline", "header", "summary", "description")
      || `${endpointLabel(endpointKey)} ${index + 1}`;
    const body = getStr(row, "body", "newsBody", "content", "details", "message");
    const occurredAt = toStringOrNull(row.createdAt ?? row.occurredAt ?? row.timestamp ?? row.date);
    const sourceHash = externalEventId
      ? hashPayload({ endpointKey, externalEventId })
      : hashPayload({ endpointKey, title, body, row });

    return {
      importJobId: context.importJobId,
      leagueId: context.job.league_id,
      guildId,
      eaLeagueId: context.eaLeagueId,
      seasonNumber,
      seasonIndex,
      seasonStage: "regular_season",
      weekNumber: toNumber(row.week ?? row.weekIndex ?? row.stageWeek ?? context.weekFrom, context.weekFrom),
      endpointKey,
      eventType,
      eventCategory: toStringOrNull(row.newsType ?? row.category ?? row.type ?? row.transactionType),
      externalEventId,
      title,
      body: body || null,
      playerExternalId: playerId ? String(playerId) : toStringOrNull(row.playerExternalId),
      playerName: getStr(row, "playerName", "name", "fullName") || null,
      teamExternalId: teamId ? String(teamId) : toStringOrNull(row.teamExternalId),
      teamName: getStr(row, "teamName", "team", "displayName") || null,
      fromTeamExternalId: fromTeamId ? String(fromTeamId) : toStringOrNull(row.fromTeamExternalId),
      fromTeamName: getStr(row, "fromTeam", "fromTeamName", "oldTeamName") || null,
      toTeamExternalId: toTeamId ? String(toTeamId) : toStringOrNull(row.toTeamExternalId),
      toTeamName: getStr(row, "toTeam", "toTeamName", "newTeamName") || null,
      occurredAt,
      sourceHash,
      normalized: { endpointKey, eventType, externalEventId },
      rawPayload: row
    };
  });
}

const EXECUTORS: Record<string, EndpointExecutor> = {
  league_metadata: async (context) => ({ endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: 1, responseSummary: { eaLeagueId: context.eaLeagueId, importScope: context.job.import_scope, weekFrom: context.weekFrom, weekTo: context.weekTo, weeks: context.weeks } }),
  teams: async (context) => {
    const result = await fetchEaLeagueTeams({ token: context.token, eaLeagueId: context.eaLeagueId, session: context.session });
    await captureRawPayload({ context, careerModeGet: "CareerMode_GetLeagueTeams", payloadGroup: "teams", payload: result.data });
    const rows = extractTeamRows(result.data, context);
    const staged = await stageTeams(rows);
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: staged.count, responseSummary: { payload: summarizePayload(result.data), stagingWrites: staged.count }, session: result.session };
  },
  standings: async (context) => {
    const result = await fetchEaStandings({ token: context.token, eaLeagueId: context.eaLeagueId, session: context.session });
    await captureRawPayload({ context, careerModeGet: "CareerMode_GetStandings", payloadGroup: "standings", payload: result.data });
    const rows = extractStandingRows(result.data, context);
    const staged = await stageStandings(rows);
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: staged.count, responseSummary: { payload: summarizePayload(result.data), stagingWrites: staged.count }, session: result.session };
  },
  schedule: async (context) => {
    let session = context.session;
    const allRows: any[] = [];
    if (context.job.import_scope === "full_regular_season_schedule") {
      const result = await fetchEaAllWeekSchedules({ token: context.token, eaLeagueId: context.eaLeagueId, startWeek: context.weekFrom, totalWeeks: context.weekTo, stageIndex: context.stageIndex, session });
      session = result.session;
      for (const week of result.weekResults) {
        await captureRawPayload({ context, careerModeGet: "CareerMode_GetSchedule", payloadGroup: `week_${week.weekNumber}_schedule`, payload: week.data });
        allRows.push(...extractGameRows(week.data, context, week.weekNumber));
      }
    } else {
      for (const week of context.weeks) {
        const result = await fetchEaWeeklyStats({ token: context.token, eaLeagueId: context.eaLeagueId, weekIndex: week - 1, stageIndex: context.stageIndex, session });
        session = result.session;
        await captureWeeklyStatsPayloads(context, week, result.payloads);
        allRows.push(...extractGameRows(result.payloads.schedules, context, week));
      }
    }
    const staged = await stageGames(allRows);
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: staged.count, responseSummary: { stagingWrites: staged.count }, session };
  },
  team_stats: async (context) => {
    let total = 0;
    let session = context.session;
    for (const week of context.weeks) {
      const result = await fetchEaWeeklyStats({ token: context.token, eaLeagueId: context.eaLeagueId, weekIndex: week - 1, stageIndex: context.stageIndex, session });
      session = result.session;
      await captureWeeklyStatsPayloads(context, week, result.payloads);
      const statRows = extractTeamStatRows(result.payloads.teamStats, context, week);
      const stagedStats = await stageTeamStats(statRows);
      total += stagedStats.count;
      const gameRows = extractGameRows(result.payloads.schedules, context, week);
      if (gameRows.length) await stageGames(gameRows);
    }
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: total, responseSummary: { stagingWrites: total }, session };
  },
  player_stats: async (context) => {
    let total = 0;
    let session = context.session;
    for (const week of context.weeks) {
      const result = await fetchEaWeeklyStats({ token: context.token, eaLeagueId: context.eaLeagueId, weekIndex: week - 1, stageIndex: context.stageIndex, session });
      session = result.session;
      await captureWeeklyStatsPayloads(context, week, result.payloads);
      const rows = [ ...extractPlayerStatRows(result.payloads.passing, "passing", context, week), ...extractPlayerStatRows(result.payloads.rushing, "rushing", context, week), ...extractPlayerStatRows(result.payloads.receiving, "receiving", context, week), ...extractPlayerStatRows(result.payloads.defense, "defense", context, week), ...extractPlayerStatRows(result.payloads.kicking, "kicking", context, week), ...extractPlayerStatRows(result.payloads.punting, "punting", context, week) ];
      const staged = await stagePlayerStats(rows);
      total += staged.count;
      const gameRows = extractGameRows(result.payloads.schedules, context, week);
      if (gameRows.length) await stageGames(gameRows);
    }
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: total, responseSummary: { stagingWrites: total }, session };
  },
  rosters: async (context) => {
    const result = await fetchEaLeagueTeamsAndRosters({ token: context.token, eaLeagueId: context.eaLeagueId, session: context.session });
    await Promise.all([ ...result.payloads.teamRosters.map((teamRoster) => captureRawPayload({ context, careerModeGet: "CareerMode_GetTeamRoster", payloadGroup: `team_${teamRoster.teamId}_roster`, payload: teamRoster.data })), captureRawPayload({ context, careerModeGet: "CareerMode_GetFreeAgents", payloadGroup: "free_agents", payload: result.payloads.freeAgents }) ]);
    const rows = [ ...result.payloads.teamRosters.flatMap((teamRoster) => extractRosterPlayerRows(teamRoster.data, context, teamRoster.teamId)), ...extractRosterPlayerRows(result.payloads.freeAgents, context) ];
    const staged = await stageRosters(rows);
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: staged.count, responseSummary: { teamRosterPayloads: result.payloads.teamRosters.length, stagingWrites: staged.count }, session: result.session };
  },
  players: async (context) => EXECUTORS.rosters(context),
  news: async (context) => {
    const result = await fetchEaLeagueFeed({ token: context.token, eaLeagueId: context.eaLeagueId, endpointKey: "news", session: context.session });
    await captureRawPayload({ context, careerModeGet: "CareerMode_GetNews", payloadGroup: "league_news", payload: result.data });
    const rows = extractLeagueFeedRows(result.data, context, "news");
    const staged = await stageLeagueFeed(rows);
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: staged.count, responseSummary: { payload: summarizePayload(result.data), stagingWrites: staged.count }, session: result.session };
  },
  transactions: async (context) => {
    const result = await fetchEaLeagueFeed({ token: context.token, eaLeagueId: context.eaLeagueId, endpointKey: "transactions", session: context.session });
    await captureRawPayload({ context, careerModeGet: "CareerMode_GetTransactions", payloadGroup: "transactions", payload: result.data });
    const rows = extractLeagueFeedRows(result.data, context, "transactions");
    const staged = await stageLeagueFeed(rows);
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: staged.count, responseSummary: { payload: summarizePayload(result.data), stagingWrites: staged.count }, session: result.session };
  },
  injuries: async (context) => {
    const result = await fetchEaLeagueFeed({ token: context.token, eaLeagueId: context.eaLeagueId, endpointKey: "injuries", session: context.session });
    await captureRawPayload({ context, careerModeGet: "CareerMode_GetInjuries", payloadGroup: "injuries", payload: result.data });
    const rows = extractLeagueFeedRows(result.data, context, "injuries");
    const staged = await stageLeagueFeed(rows);
    return { endpointKey: context.endpointKey, endpointLabel: context.endpointLabel, status: "success", recordsFound: staged.count, responseSummary: { payload: summarizePayload(result.data), stagingWrites: staged.count }, session: result.session };
  }
};

export function getDefaultImportEndpointKeys() { return [...IMPORT_PROGRESS_ENDPOINTS]; }

// EA rejects rapid repeated Blaze logins for the same account: the first login
// in a window returns a valid session, but a second login a few seconds later
// returns HTTP 200 with no sessionKey ("Could not create EA Blaze session"). The
// bot steps imports endpoint-by-endpoint (/v1/imports/job/stage-endpoint), so
// without caching every endpoint triggers a fresh login and all but the first
// fail. Cache the session per EA account and reuse it across endpoints; evict on
// failure so the next attempt re-logs in once the throttle window has passed.
const BLAZE_SESSION_TTL_MS = 5 * 60 * 1000;
const blazeSessionCache = new Map<string, { token: EaCompanionToken; session: EaBlazeSession; cachedAt: number }>();

function invalidateBlazeSession(accountId: string) {
  blazeSessionCache.delete(accountId);
}

async function prepareEaExecution(importJobId: string, job: any) {
  const eaContext = await loadEaContext(importJobId, job);
  const cached = blazeSessionCache.get(eaContext.accountId);
  if (cached && Date.now() - cached.cachedAt < BLAZE_SESSION_TTL_MS) {
    eaContext.token = cached.token;
    return { eaContext, session: cached.session };
  }
  try { eaContext.token = await refreshCompanionToken(eaContext.token); await persistRefreshedEaToken(eaContext.accountId, eaContext.token); } catch (error) { throw new ApiError(401, "EA reconnect required. The saved EA refresh token is invalid or expired. Open the EA login URL again and paste a fresh redirect URL.", { reconnectRequired: true, cause: error instanceof Error ? error.message : String(error) }); }
  let session: EaBlazeSession | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { session = await retrieveBlazeSession(eaContext.token); break; } catch (error) { if (attempt === 3) throw error; await new Promise((resolve) => setTimeout(resolve, 750 * attempt)); }
  }
  if (!session) throw new ApiError(502, "Could not create EA Blaze session after retries.");
  blazeSessionCache.set(eaContext.accountId, { token: eaContext.token, session, cachedAt: Date.now() });
  return { eaContext, session };
}

async function runSingleEndpoint(input: { importJobId: string; job: any; endpointKey: string; eaContext: EaExecutionContext; session?: EaBlazeSession }) {
  const label = endpointLabel(input.endpointKey);
  const startedAt = Date.now();
  await updateEndpointAttempt({ importJobId: input.importJobId, endpointKey: input.endpointKey, endpointLabel: label, status: "running", attemptNumber: 1, responseSummary: {} });
  const executor = EXECUTORS[input.endpointKey];
  if (!executor) {
    const skipped = { endpointKey: input.endpointKey, endpointLabel: label, status: "skipped" as const, recordsFound: 0, responseSummary: { reason: "endpoint_not_registered" }, errorMessage: "Endpoint is not registered in the execution registry." };
    await updateEndpointAttempt({ importJobId: input.importJobId, endpointKey: input.endpointKey, endpointLabel: label, status: skipped.status, attemptNumber: 1, durationMs: Date.now() - startedAt, recordsFound: skipped.recordsFound, errorMessage: skipped.errorMessage, responseSummary: skipped.responseSummary });
    return { ...skipped, session: input.session };
  }
  try {
    const result = await executor({ importJobId: input.importJobId, endpointKey: input.endpointKey, endpointLabel: label, job: input.job, ...input.eaContext, session: input.session });
    await updateEndpointAttempt({ importJobId: input.importJobId, endpointKey: input.endpointKey, endpointLabel: label, status: result.status, attemptNumber: 1, durationMs: Date.now() - startedAt, recordsFound: result.recordsFound, errorMessage: result.errorMessage ?? null, responseSummary: result.responseSummary ?? {} });
    console.log("[IMPORT ENDPOINT COMPLETE]", { importJobId: input.importJobId, endpointKey: input.endpointKey, status: result.status, recordsFound: result.recordsFound, responseSummary: result.responseSummary ?? {} });
    return result;
  } catch (error) {
    const details = error instanceof ApiError ? error.details : null;
    const failed = { endpointKey: input.endpointKey, endpointLabel: label, status: "failed" as const, recordsFound: 0, errorMessage: error instanceof Error ? error.message : String(error), responseSummary: { error: error instanceof Error ? error.message : String(error), details }, session: input.session };
    await updateEndpointAttempt({ importJobId: input.importJobId, endpointKey: input.endpointKey, endpointLabel: label, status: "failed", attemptNumber: 1, durationMs: Date.now() - startedAt, recordsFound: 0, errorMessage: failed.errorMessage, responseSummary: failed.responseSummary });
    console.error("[IMPORT ENDPOINT FAILED]", { importJobId: input.importJobId, endpointKey: input.endpointKey, error: failed.errorMessage });
    return failed;
  }
}

export async function executeImportEndpoint(importJobId: string, endpointKey: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;
  if (!["created", "queued", "running", "completed_with_warnings", "validating"].includes(job.status)) throw new ApiError(409, "Import job is not in an executable state.", { currentStatus: job.status });
  const endpointKeys = Array.isArray(job.selected_endpoint_keys) && job.selected_endpoint_keys.length > 0 ? job.selected_endpoint_keys as string[] : DEFAULT_ENDPOINT_KEYS;
  const attempts = Array.isArray(details.endpointAttempts) ? details.endpointAttempts : [];
  const selectedAttempts = attempts.filter((attempt: any) => endpointKeys.includes(attempt.endpoint_key));
  const successfulKeys = new Set(selectedAttempts.filter((attempt: any) => attempt.status === "success").map((attempt: any) => attempt.endpoint_key));
  if (successfulKeys.has(endpointKey)) {
    return updateImportJobStatus({ importJobId, status: "validating", previewSummary: { ...(job.preview_summary ?? {}), latestEndpoint: { endpointKey, status: "success", recordsFound: selectedAttempts.find((attempt: any) => attempt.endpoint_key === endpointKey)?.records_found ?? 0, responseSummary: { skippedBecauseAlreadyStaged: true } }, successfulEndpointKeys: Array.from(successfulKeys), payouts: "Deferred until league advance." }, validationWarnings: [], validationErrors: [] });
  }
  const { eaContext, session } = await prepareEaExecution(importJobId, job);
  await updateImportJobStatus({ importJobId, status: "running" });
  const result = await runSingleEndpoint({ importJobId, job, endpointKey, eaContext, session });
  if (result.status === "failed") invalidateBlazeSession(eaContext.accountId);
  return updateImportJobStatus({ importJobId, status: result.status === "failed" ? "completed_with_warnings" : "validating", previewSummary: { ...(job.preview_summary ?? {}), latestEndpoint: { endpointKey, status: result.status, recordsFound: result.recordsFound, responseSummary: result.responseSummary ?? {} }, payouts: "Deferred until league advance." }, validationWarnings: result.status === "failed" ? [{ code: "endpoint_execution_failed", message: `${endpointLabel(endpointKey)} failed during staging.` }] : [], validationErrors: [] });
}

export async function executeImportJob(importJobId: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;
  if (!["created", "queued", "running", "completed_with_warnings", "validating"].includes(job.status)) throw new ApiError(409, "Import job is not in an executable state.", { currentStatus: job.status });
  const endpointKeys = Array.isArray(job.selected_endpoint_keys) && job.selected_endpoint_keys.length > 0 ? job.selected_endpoint_keys as string[] : DEFAULT_ENDPOINT_KEYS;
  const attempts = Array.isArray(details.endpointAttempts) ? details.endpointAttempts : [];
  const selectedAttempts = attempts.filter((attempt: any) => endpointKeys.includes(attempt.endpoint_key));
  const successfulAttempts = selectedAttempts.filter((attempt: any) => attempt.status === "success");
  const successfulKeys = new Set(successfulAttempts.map((attempt: any) => attempt.endpoint_key));
  const allSelectedEndpointsAlreadyStaged = endpointKeys.length > 0 && endpointKeys.every((endpointKey) => successfulKeys.has(endpointKey));
  if (allSelectedEndpointsAlreadyStaged) {
    const results = endpointKeys.map((endpointKey) => { const attempt = successfulAttempts.find((item: any) => item.endpoint_key === endpointKey); return { endpointKey, endpointLabel: attempt?.endpoint_label ?? endpointLabel(endpointKey), status: "success" as const, recordsFound: attempt?.records_found ?? 0, responseSummary: { ...(attempt?.response_summary ?? {}), skippedBecauseAlreadyStaged: true } }; });
    const stagingWrites = results.reduce((sum, result) => sum + result.recordsFound, 0);
    return updateImportJobStatus({ importJobId, status: "validating", previewSummary: { ...(job.preview_summary ?? {}), endpointExecution: { successful: results.length, skipped: 0, failed: 0, results }, successfulEndpointKeys: Array.from(successfulKeys), stagingWrites, payouts: "Deferred until league advance." }, validationWarnings: [], validationErrors: [] });
  }
  const { eaContext, session: initialSession } = await prepareEaExecution(importJobId, job);
  await updateImportJobStatus({ importJobId, status: "running" });
  const results: ImportEndpointExecutionResult[] = [];
  let session: EaBlazeSession | undefined = initialSession;
  for (const endpointKey of endpointKeys) {
    if (successfulKeys.has(endpointKey)) {
      const attempt = successfulAttempts.find((item: any) => item.endpoint_key === endpointKey);
      results.push({
        endpointKey,
        endpointLabel: attempt?.endpoint_label ?? endpointLabel(endpointKey),
        status: "success",
        recordsFound: attempt?.records_found ?? 0,
        responseSummary: { ...(attempt?.response_summary ?? {}), skippedBecauseAlreadyStaged: true }
      });
      continue;
    }
    const result = await runSingleEndpoint({ importJobId, job, endpointKey, eaContext, session });
    if (result.status === "failed") invalidateBlazeSession(eaContext.accountId);
    session = result.session ?? session;
    const { session: _session, ...withoutSession } = result;
    results.push(withoutSession);
    if (result.status === "failed") break;
  }
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const successful = results.filter((result) => result.status === "success").length;
  const stagingWrites = results.reduce((sum, result) => sum + result.recordsFound, 0);
  return updateImportJobStatus({ importJobId, status: failed > 0 ? "completed_with_warnings" : skipped > 0 ? "completed_with_warnings" : "validating", previewSummary: { ...(job.preview_summary ?? {}), endpointExecution: { successful, skipped, failed, results }, stagingWrites, payouts: "Deferred until league advance." }, validationWarnings: [ ...(skipped > 0 ? [{ code: "endpoint_execution_skipped", message: "One or more endpoints were skipped." }] : []), ...(failed > 0 ? [{ code: "endpoint_execution_failed", message: "One or more endpoints failed." }] : []) ], validationErrors: [] });
}
