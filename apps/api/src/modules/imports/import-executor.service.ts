import { ApiError } from "../../lib/errors.js";
import { supabase } from "../../lib/supabase.js";
import {
  fetchEaAllWeekSchedules,
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
  stagePlayerStats,
  stageStandings,
  stageTeamStats
} from "./import-staging.service.js";

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
  weekFrom: number;
  weekTo: number;
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
  weekFrom: number;
  weekTo: number;
  stageIndex: number;
  session?: EaBlazeSession;
};

type EndpointExecutor = (context: ExecutorContext) => Promise<ImportEndpointExecutionResult & { session?: EaBlazeSession }>;

const DEFAULT_ENDPOINT_KEYS = ["league_metadata", "teams", "standings", "schedule", "rosters", "players", "player_stats", "team_stats"];

function endpointLabel(endpointKey: string) {
  return endpointKey
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringOrNull(value: unknown) {
  if (value == null) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

function summarizePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return { type: typeof payload };
  const keys = Object.keys(payload as Record<string, unknown>).slice(0, 20);
  return { keys };
}

function getWeekBounds(job: any) {
  if (job.import_scope === "selected_weeks") {
    return {
      weekFrom: toNumber(job.week_from, 1),
      weekTo: toNumber(job.week_to, 18)
    };
  }

  if (job.import_scope === "single_week") {
    const week = toNumber(job.week_from, 1);
    return { weekFrom: week, weekTo: week };
  }

  if (job.import_scope === "full_available" || job.import_scope === "full_regular_season_schedule") {
    return { weekFrom: 1, weekTo: 18 };
  }

  return { weekFrom: toNumber(job.week_from, 1), weekTo: toNumber(job.week_to, toNumber(job.week_from, 1)) };
}

async function loadEaContext(importJobId: string, job: any): Promise<EaExecutionContext> {
  const externalLeagueId = job.ea_external_league_id;
  if (!externalLeagueId) {
    throw new ApiError(409, "Import job is missing EA external league id.");
  }

  const franchise = await supabase
    .from("rec_ea_franchises")
    .select("*, account:rec_ea_accounts(*)")
    .eq("external_league_id", String(externalLeagueId))
    .maybeSingle();

  if (franchise.error) {
    throw new ApiError(500, "Failed to load selected EA franchise.", franchise.error);
  }

  const account = (franchise.data as any)?.account;
  if (!franchise.data || !account) {
    throw new ApiError(404, "Selected EA franchise/account was not found. Reconnect EA and rediscover franchises.");
  }

  if (!account.access_token || !account.refresh_token || !account.expires_at || !account.blaze_id) {
    throw new ApiError(401, "EA reconnect required. Saved EA token data is missing or expired.", {
      reconnectRequired: true,
      importJobId
    });
  }

  const token: EaCompanionToken = {
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    expiry: new Date(account.expires_at),
    console: (account.platform ?? franchise.data.console ?? "pc") as EaCompanionToken["console"],
    blazeId: String(account.blaze_id)
  };

  const seasonNumber = toNumber(franchise.data.calendar_year, new Date().getFullYear());
  const { weekFrom, weekTo } = getWeekBounds(job);

  return {
    accountId: account.id,
    token,
    eaLeagueId: Number(franchise.data.external_league_id),
    seasonNumber,
    weekFrom,
    weekTo,
    stageIndex: 1
  };
}

async function persistRefreshedEaToken(accountId: string, token: EaCompanionToken) {
  const result = await supabase
    .from("rec_ea_accounts")
    .update({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expires_at: token.expiry.toISOString(),
      blaze_id: token.blazeId,
      updated_at: new Date().toISOString()
    })
    .eq("id", accountId);

  if (result.error) {
    throw new ApiError(500, "Failed to persist refreshed EA token.", result.error);
  }
}

function extractTeamRows(payload: unknown, importJobId: string, leagueId: string, seasonNumber: number) {
  const teams = extractArray(payload, ["leagueTeamInfoList", "teamInfoList", "teams"]);

  return teams.map((team: any) => ({
    importJobId,
    leagueId,
    seasonNumber,
    seasonStage: "regular_season",
    teamExternalId: toStringOrNull(team.teamId ?? team.id ?? team.teamInfo?.teamId),
    teamName: toStringOrNull(
      team.displayName && team.cityName
        ? `${team.cityName} ${team.displayName}`
        : team.displayName ?? team.nickName ?? team.teamName ?? team.fullName ?? team.cityName ?? team.abbrName ?? team.abbrev
    ),
    stats: team,
    rawPayload: team
  }));
}

function extractStandingRows(payload: unknown, importJobId: string, leagueId: string, seasonNumber: number) {
  const standings = extractArray(payload, ["teamStandingInfoList", "standingInfoList", "standings", "items"]);
  return standings.map((standing: any) => ({
    importJobId,
    leagueId,
    seasonNumber,
    seasonStage: "regular_season",
    teamExternalId: toStringOrNull(standing.teamId ?? standing.teamExternalId ?? standing.id),
    teamName: toStringOrNull(standing.teamName ?? standing.displayName ?? standing.abbrName ?? standing.team?.teamName),
    wins: toNumber(standing.totalWins ?? standing.wins ?? standing.win),
    losses: toNumber(standing.totalLosses ?? standing.losses ?? standing.loss),
    ties: toNumber(standing.totalTies ?? standing.ties ?? standing.tie),
    pointsFor: toNumber(standing.ptsFor ?? standing.pointsFor ?? standing.pf),
    pointsAgainst: toNumber(standing.ptsAgainst ?? standing.pointsAgainst ?? standing.pa),
    rawPayload: standing
  }));
}

function extractGameRows(payload: unknown, importJobId: string, leagueId: string, seasonNumber: number, weekNumber: number) {
  const games = extractArray(payload, ["gameScheduleInfoList", "leagueSchedule", "scheduleInfoList", "games", "items"]);

  return games.map((game: any, index) => {
    const homeScore = game.homeScore ?? game.homeTeamScore ?? game.home?.score ?? game.seasonGameInfo?.homeScore;
    const awayScore = game.awayScore ?? game.awayTeamScore ?? game.away?.score ?? game.seasonGameInfo?.awayScore;
    const isPlayed = Boolean(game.isGamePlayed ?? game.played ?? game.seasonGameInfo?.isGamePlayed ?? game.status === 2 ?? (homeScore != null && awayScore != null));

    return {
      importJobId,
      leagueId,
      seasonNumber,
      seasonStage: "regular_season",
      weekNumber,
      externalGameId: toStringOrNull(game.scheduleId ?? game.gameId ?? game.id ?? `${weekNumber}-${index}`),
      homeTeamExternalId: toStringOrNull(game.homeTeamId ?? game.home?.teamId ?? game.seasonGameInfo?.homeTeamId),
      awayTeamExternalId: toStringOrNull(game.awayTeamId ?? game.away?.teamId ?? game.seasonGameInfo?.awayTeamId),
      homeTeamName: toStringOrNull(game.homeTeamName ?? game.home?.teamName ?? game.homeDisplayName),
      awayTeamName: toStringOrNull(game.awayTeamName ?? game.away?.teamName ?? game.awayDisplayName),
      homeScore: homeScore == null ? null : toNumber(homeScore),
      awayScore: awayScore == null ? null : toNumber(awayScore),
      gameStatus: isPlayed ? "complete" : "scheduled",
      rawPayload: game
    };
  });
}

function extractTeamStatRows(payload: unknown, importJobId: string, leagueId: string, seasonNumber: number, weekNumber: number) {
  const rows = extractArray(payload, ["teamStatInfoList", "teamStatsInfoList", "teamStats", "items"]);
  return rows.map((row: any) => ({
    importJobId,
    leagueId,
    seasonNumber,
    seasonStage: "regular_season",
    weekNumber,
    teamExternalId: toStringOrNull(row.teamId ?? row.teamExternalId ?? row.id),
    teamName: toStringOrNull(row.teamName ?? row.displayName ?? row.abbrName),
    stats: row,
    rawPayload: row
  }));
}

function extractPlayerStatRows(payload: unknown, category: string, importJobId: string, leagueId: string, seasonNumber: number, weekNumber: number) {
  const rows = extractArray(payload, [
    "playerPassingStatInfoList",
    "playerRushingStatInfoList",
    "playerReceivingStatInfoList",
    "playerDefensiveStatInfoList",
    "playerKickingStatInfoList",
    "playerPuntingStatInfoList",
    "playerStatInfoList",
    "playerStatsInfoList",
    "statInfoList",
    "items"
  ]);

  return rows.map((row: any) => ({
    importJobId,
    leagueId,
    seasonNumber,
    seasonStage: "regular_season",
    weekNumber,
    playerExternalId: toStringOrNull(row.rosterId ?? row.playerId ?? row.id ?? row.playerExternalId),
    playerName: toStringOrNull(row.fullName ?? row.playerName ?? row.name ?? [row.firstName, row.lastName].filter(Boolean).join(" ")),
    teamExternalId: toStringOrNull(row.teamId ?? row.teamExternalId),
    teamName: toStringOrNull(row.teamName ?? row.displayName ?? row.abbrName),
    position: toStringOrNull(row.position ?? row.pos),
    stats: { category, ...row },
    rawPayload: row
  }));
}

function extractRosterPlayerRows(payload: unknown, importJobId: string, leagueId: string, seasonNumber: number, teamId?: number) {
  const rows = extractArray(payload, ["rosterInfoList", "playerInfoList", "players", "items"]);

  return rows.map((row: any) => ({
    importJobId,
    leagueId,
    seasonNumber,
    seasonStage: "regular_season",
    weekNumber: null,
    playerExternalId: toStringOrNull(row.rosterId ?? row.playerId ?? row.id ?? row.playerExternalId),
    playerName: toStringOrNull(row.fullName ?? row.playerName ?? row.name ?? [row.firstName, row.lastName].filter(Boolean).join(" ")),
    teamExternalId: toStringOrNull(row.teamId ?? teamId ?? row.teamExternalId),
    teamName: toStringOrNull(row.teamName ?? row.displayName ?? row.abbrName),
    position: toStringOrNull(row.position ?? row.pos),
    stats: row,
    rawPayload: row
  }));
}

async function stageTeamsAsTeamStats(context: ExecutorContext, payload: unknown) {
  const rows = extractTeamRows(payload, context.importJobId, context.job.league_id, context.seasonNumber);
  const staged = await stageTeamStats(rows);
  return staged.count;
}

const EXECUTORS: Record<string, EndpointExecutor> = {
  league_metadata: async (context) => ({
    endpointKey: context.endpointKey,
    endpointLabel: context.endpointLabel,
    status: "success",
    recordsFound: 1,
    responseSummary: {
      eaLeagueId: context.eaLeagueId,
      importScope: context.job.import_scope,
      weekFrom: context.weekFrom,
      weekTo: context.weekTo
    }
  }),

  teams: async (context) => {
    const result = await fetchEaLeagueTeams({
      token: context.token,
      eaLeagueId: context.eaLeagueId,
      session: context.session
    });
    const recordsFound = await stageTeamsAsTeamStats(context, result.data);
    return {
      endpointKey: context.endpointKey,
      endpointLabel: context.endpointLabel,
      status: "success",
      recordsFound,
      responseSummary: { payload: summarizePayload(result.data), stagingWrites: recordsFound },
      session: result.session
    };
  },

  standings: async (context) => {
    const result = await fetchEaStandings({
      token: context.token,
      eaLeagueId: context.eaLeagueId,
      session: context.session
    });
    const rows = extractStandingRows(result.data, context.importJobId, context.job.league_id, context.seasonNumber);
    const staged = await stageStandings(rows);
    return {
      endpointKey: context.endpointKey,
      endpointLabel: context.endpointLabel,
      status: "success",
      recordsFound: staged.count,
      responseSummary: { payload: summarizePayload(result.data), stagingWrites: staged.count },
      session: result.session
    };
  },

  schedule: async (context) => {
    const result = context.weekFrom === context.weekTo
      ? {
          ...(await fetchEaWeeklyStats({
            token: context.token,
            eaLeagueId: context.eaLeagueId,
            weekIndex: context.weekFrom - 1,
            stageIndex: context.stageIndex,
            session: context.session
          })),
          weekResults: undefined
        }
      : await fetchEaAllWeekSchedules({
          token: context.token,
          eaLeagueId: context.eaLeagueId,
          startWeek: context.weekFrom,
          totalWeeks: context.weekTo,
          stageIndex: context.stageIndex,
          session: context.session
        });

    const allRows: any[] = [];
    if ("payloads" in result) {
      allRows.push(...extractGameRows(result.payloads.schedules, context.importJobId, context.job.league_id, context.seasonNumber, context.weekFrom));
    } else {
      for (const week of result.weekResults) {
        allRows.push(...extractGameRows(week.data, context.importJobId, context.job.league_id, context.seasonNumber, week.weekNumber));
      }
    }

    const staged = await stageGames(allRows);
    return {
      endpointKey: context.endpointKey,
      endpointLabel: context.endpointLabel,
      status: "success",
      recordsFound: staged.count,
      responseSummary: { stagingWrites: staged.count },
      session: result.session
    };
  },

  team_stats: async (context) => {
    let total = 0;
    let session = context.session;
    for (let week = context.weekFrom; week <= context.weekTo; week += 1) {
      const result = await fetchEaWeeklyStats({
        token: context.token,
        eaLeagueId: context.eaLeagueId,
        weekIndex: week - 1,
        stageIndex: context.stageIndex,
        session
      });
      session = result.session;
      const rows = extractTeamStatRows(result.payloads.teamStats, context.importJobId, context.job.league_id, context.seasonNumber, week);
      const staged = await stageTeamStats(rows);
      total += staged.count;
    }

    return {
      endpointKey: context.endpointKey,
      endpointLabel: context.endpointLabel,
      status: "success",
      recordsFound: total,
      responseSummary: { stagingWrites: total },
      session
    };
  },

  player_stats: async (context) => {
    let total = 0;
    let session = context.session;
    for (let week = context.weekFrom; week <= context.weekTo; week += 1) {
      const result = await fetchEaWeeklyStats({
        token: context.token,
        eaLeagueId: context.eaLeagueId,
        weekIndex: week - 1,
        stageIndex: context.stageIndex,
        session
      });
      session = result.session;

      const rows = [
        ...extractPlayerStatRows(result.payloads.passing, "passing", context.importJobId, context.job.league_id, context.seasonNumber, week),
        ...extractPlayerStatRows(result.payloads.rushing, "rushing", context.importJobId, context.job.league_id, context.seasonNumber, week),
        ...extractPlayerStatRows(result.payloads.receiving, "receiving", context.importJobId, context.job.league_id, context.seasonNumber, week),
        ...extractPlayerStatRows(result.payloads.defense, "defense", context.importJobId, context.job.league_id, context.seasonNumber, week),
        ...extractPlayerStatRows(result.payloads.kicking, "kicking", context.importJobId, context.job.league_id, context.seasonNumber, week),
        ...extractPlayerStatRows(result.payloads.punting, "punting", context.importJobId, context.job.league_id, context.seasonNumber, week)
      ];

      const staged = await stagePlayerStats(rows);
      total += staged.count;
    }

    return {
      endpointKey: context.endpointKey,
      endpointLabel: context.endpointLabel,
      status: "success",
      recordsFound: total,
      responseSummary: { stagingWrites: total },
      session
    };
  },

  rosters: async (context) => {
    const result = await fetchEaLeagueTeamsAndRosters({
      token: context.token,
      eaLeagueId: context.eaLeagueId,
      session: context.session
    });

    const rows = [
      ...result.payloads.teamRosters.flatMap((teamRoster) =>
        extractRosterPlayerRows(teamRoster.data, context.importJobId, context.job.league_id, context.seasonNumber, teamRoster.teamId)
      ),
      ...extractRosterPlayerRows(result.payloads.freeAgents, context.importJobId, context.job.league_id, context.seasonNumber)
    ];

    const staged = await stagePlayerStats(rows);
    return {
      endpointKey: context.endpointKey,
      endpointLabel: context.endpointLabel,
      status: "success",
      recordsFound: staged.count,
      responseSummary: {
        teamRosterPayloads: result.payloads.teamRosters.length,
        stagingWrites: staged.count
      },
      session: result.session
    };
  },

  players: async (context) => {
    return EXECUTORS.rosters(context);
  }
};

export async function executeImportJob(importJobId: string) {
  const details = await getImportJob(importJobId);
  const job = details.job;

  if (!["created", "queued", "running", "completed_with_warnings", "validating"].includes(job.status)) {
    throw new ApiError(409, "Import job is not in an executable state.", { currentStatus: job.status });
  }

  const endpointKeys = Array.isArray(job.selected_endpoint_keys) && job.selected_endpoint_keys.length > 0
    ? job.selected_endpoint_keys as string[]
    : DEFAULT_ENDPOINT_KEYS;

  const eaContext = await loadEaContext(importJobId, job);

  try {
    eaContext.token = await refreshCompanionToken(eaContext.token);
    await persistRefreshedEaToken(eaContext.accountId, eaContext.token);
  } catch (error) {
    throw new ApiError(401, "EA reconnect required. The saved EA refresh token is invalid or expired. Open the EA login URL again and paste a fresh redirect URL.", {
      reconnectRequired: true,
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  let session: EaBlazeSession | undefined = await retrieveBlazeSession(eaContext.token);

  await updateImportJobStatus({ importJobId, status: "running" });

  const results: ImportEndpointExecutionResult[] = [];

  for (const endpointKey of endpointKeys) {
    const label = endpointLabel(endpointKey);
    const startedAt = Date.now();

    await updateEndpointAttempt({
      importJobId,
      endpointKey,
      endpointLabel: label,
      status: "running",
      attemptNumber: 1,
      responseSummary: {}
    });

    const executor = EXECUTORS[endpointKey];

    if (!executor) {
      const skipped = {
        endpointKey,
        endpointLabel: label,
        status: "skipped" as const,
        recordsFound: 0,
        responseSummary: { reason: "endpoint_not_registered" },
        errorMessage: "Endpoint is not registered in the execution registry."
      };
      results.push(skipped);
      await updateEndpointAttempt({
        importJobId,
        endpointKey,
        endpointLabel: label,
        status: skipped.status,
        attemptNumber: 1,
        durationMs: Date.now() - startedAt,
        recordsFound: skipped.recordsFound,
        errorMessage: skipped.errorMessage,
        responseSummary: skipped.responseSummary
      });
      continue;
    }

    try {
      const result = await executor({
        importJobId,
        endpointKey,
        endpointLabel: label,
        job,
        ...eaContext,
        session
      });

      session = result.session ?? session;
      const { session: _session, ...withoutSession } = result;
      results.push(withoutSession);

      await updateEndpointAttempt({
        importJobId,
        endpointKey,
        endpointLabel: label,
        status: result.status,
        attemptNumber: 1,
        durationMs: Date.now() - startedAt,
        recordsFound: result.recordsFound,
        errorMessage: result.errorMessage ?? null,
        responseSummary: result.responseSummary ?? {}
      });
    } catch (error) {
      const failed = {
        endpointKey,
        endpointLabel: label,
        status: "failed" as const,
        recordsFound: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
        responseSummary: {}
      };
      results.push(failed);

      await updateEndpointAttempt({
        importJobId,
        endpointKey,
        endpointLabel: label,
        status: "failed",
        attemptNumber: 1,
        durationMs: Date.now() - startedAt,
        recordsFound: 0,
        errorMessage: failed.errorMessage,
        responseSummary: {}
      });
    }
  }

  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const successful = results.filter((result) => result.status === "success").length;
  const stagingWrites = results.reduce((sum, result) => sum + result.recordsFound, 0);

  return updateImportJobStatus({
    importJobId,
    status: failed > 0 ? "failed" : skipped > 0 ? "completed_with_warnings" : "validating",
    previewSummary: {
      ...(job.preview_summary ?? {}),
      endpointExecution: {
        successful,
        skipped,
        failed,
        results
      },
      stagingWrites,
      payouts: "Deferred until league advance."
    },
    validationWarnings: skipped > 0 ? [{ code: "endpoint_execution_skipped", message: "One or more endpoints were skipped." }] : [],
    validationErrors: failed > 0 ? [{ code: "endpoint_execution_failed", message: "One or more endpoints failed." }] : []
  });
}