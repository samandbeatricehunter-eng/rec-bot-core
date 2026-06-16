import { constants, createHash, randomBytes } from "node:crypto";
import { Agent, fetch } from "undici";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";

export type RecEaConsole = "xone" | "ps4" | "pc" | "ps5" | "xbsx" | "stadia";

export type EaCompanionToken = {
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  console: RecEaConsole;
  blazeId: string;
};

export type EaBlazeSession = {
  blazeId: number;
  sessionKey: string;
  requestId: number;
};

export type EaLeagueSummary = {
  leagueId: number;
  leagueName: string;
  seasonText?: string;
  seasonSort?: number;
  calendarYear?: number;
  numMembers?: number;
  userTeamId?: number;
  userTeamName?: string;
  isImportable?: boolean;
  raw: Record<string, unknown>;
};

type EaAccountTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type BlazeAuthenticatedResponse = {
  userLoginInfo?: {
    sessionKey?: string;
    blazeId?: number;
    personaDetails?: {
      personaId?: number;
      displayName?: string;
    };
  };
  error?: Record<string, unknown>;
};

type BlazeRequest = {
  commandName: string;
  componentId: number;
  commandId: number;
  requestPayload: Record<string, unknown>;
  componentName: string;
};

type GetMyLeaguesResponse = {
  responseInfo?: {
    value?: {
      leagues?: Array<Record<string, unknown>>;
    };
  };
  error?: Record<string, unknown>;
};

export type WeeklyExportPayloads = {
  schedules: unknown;
  teamStats: unknown;
  passing: unknown;
  rushing: unknown;
  receiving: unknown;
  defense: unknown;
  kicking: unknown;
  punting: unknown;
  errors: Record<string, string>;
};

export type RosterExportPayloads = {
  leagueTeams: unknown;
  teamRosters: Array<{ teamId: number; listIndex: number; data: unknown }>;
  freeAgents: unknown;
};

const YEAR = "2026";

const BLAZE_SERVICE: Record<RecEaConsole, string> = {
  xone: `madden-${YEAR}-xone`,
  ps4: `madden-${YEAR}-ps4`,
  pc: `madden-${YEAR}-pc`,
  ps5: `madden-${YEAR}-ps5`,
  xbsx: `madden-${YEAR}-xbsx`,
  stadia: `madden-${YEAR}-stadia`
};

const BLAZE_PRODUCT_NAME: Record<RecEaConsole, string> = {
  xone: `madden-${YEAR}-xone-mca`,
  ps4: `madden-${YEAR}-ps4-mca`,
  pc: `madden-${YEAR}-pc-mca`,
  ps5: `madden-${YEAR}-ps5-mca`,
  xbsx: `madden-${YEAR}-xbsx-mca`,
  stadia: `madden-${YEAR}-stadia-mca`
};

const EXPORT_ENDPOINTS = {
  passing: "CareerMode_GetWeeklyPassingStatsExport",
  rushing: "CareerMode_GetWeeklyRushingStatsExport",
  receiving: "CareerMode_GetWeeklyReceivingStatsExport",
  defense: "CareerMode_GetWeeklyDefensiveStatsExport",
  kicking: "CareerMode_GetWeeklyKickingStatsExport",
  punting: "CareerMode_GetWeeklyPuntingStatsExport",
  teamStats: "CareerMode_GetWeeklyTeamStatsExport",
  schedules: "CareerMode_GetWeeklySchedulesExport",
  leagueTeams: "CareerMode_GetLeagueTeamsExport",
  standings: "CareerMode_GetStandingsExport",
  teamRoster: "CareerMode_GetTeamRostersExport",
  news: "CareerMode_GetNewsExport",
  transactions: "CareerMode_GetTransactionsExport",
  injuries: "CareerMode_GetInjuriesExport"
} as const;

const dispatcher = new Agent({
  connect: {
    rejectUnauthorized: false,
    secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT
  }
});

function companionHeaders(token: EaCompanionToken) {
  return {
    "Accept-Charset": "UTF-8",
    Accept: "application/json",
    "X-BLAZE-ID": BLAZE_SERVICE[token.console],
    "X-BLAZE-VOID-RESP": "XML",
    "X-Application-Key": "MADDEN-MCA",
    "Content-Type": "application/json",
    "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)"
  };
}

function parseEaTokenResponse(rawText: string) {
  try {
    return JSON.parse(rawText) as EaAccountTokenResponse & Record<string, unknown>;
  } catch {
    return {} as EaAccountTokenResponse & Record<string, unknown>;
  }
}

function logEaTokenExchange(label: string, response: { status: number }, parsed: Record<string, unknown>) {
  console.log(label, {
    clientId: env.EA_MCA_CLIENT_ID,
    hasClientSecret: Boolean(env.EA_MCA_CLIENT_SECRET),
    redirectUri: env.EA_MCA_REDIRECT_URL,
    authSource: env.EA_MCA_AUTH_SOURCE,
    status: response.status,
    tokenType: parsed.token_type ?? null,
    expiresIn: parsed.expires_in ?? null,
    hasAccessToken: Boolean(parsed.access_token),
    hasRefreshToken: Boolean(parsed.refresh_token),
    error: parsed.error ?? null,
    errorDescription: parsed.error_description ?? null,
    code: parsed.code ?? null
  });
}

function redactEaTokenResponse(parsed: Record<string, unknown>) {
  return {
    ...parsed,
    access_token: parsed.access_token ? "[redacted]" : undefined,
    refresh_token: parsed.refresh_token ? "[redacted]" : undefined,
    id_token: parsed.id_token ? "[redacted]" : parsed.id_token
  };
}

export function extractEaAuthCode(raw: string) {
  const trimmed = raw.trim();

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("code") ?? trimmed;
  } catch {
    const queryStart = trimmed.indexOf("?");
    if (queryStart >= 0) {
      const params = new URLSearchParams(trimmed.slice(queryStart + 1));
      const code = params.get("code");
      if (code) return code;
    }

    const standalone = trimmed.match(/(?:^|[?&\s])code=([^&\s]+)/i);
    return standalone ? decodeURIComponent(standalone[1]) : trimmed;
  }
}

export function getEaLoginUrl() {
  const params = new URLSearchParams({
    hide_create: "true",
    release_type: "prod",
    response_type: "code",
    redirect_uri: env.EA_MCA_REDIRECT_URL,
    client_id: env.EA_MCA_CLIENT_ID,
    machineProfileKey: env.EA_MCA_MACHINE_KEY,
    authentication_source: String(env.EA_MCA_AUTH_SOURCE)
  });

  return `https://accounts.ea.com/connect/auth?${params.toString()}`;
}

export async function exchangeEaAuthCode(input: { code: string; console: RecEaConsole }) {
  const code = extractEaAuthCode(input.code);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.EA_MCA_CLIENT_ID,
    redirect_uri: env.EA_MCA_REDIRECT_URL,
    release_type: "prod",
    authentication_source: String(env.EA_MCA_AUTH_SOURCE),
    token_format: "JWS"
  });

  if (env.EA_MCA_CLIENT_SECRET) {
    body.set("client_secret", env.EA_MCA_CLIENT_SECRET);
  }

  const response = await fetch("https://accounts.ea.com/connect/token", {
    method: "POST",
    headers: {
      "Accept-Charset": "UTF-8",
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept-Encoding": "gzip"
    },
    body: body.toString()
  });

  const rawText = await response.text();
  const parsed = parseEaTokenResponse(rawText);
  logEaTokenExchange("[EA AUTH EXCHANGE]", response, parsed);

  if (!response.ok || !parsed.access_token || !parsed.refresh_token || !parsed.expires_in) {
    throw new ApiError(502, "EA auth code exchange failed.", {
      status: response.status,
      parsed: redactEaTokenResponse(parsed)
    });
  }

  const partialToken: EaCompanionToken = {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiry: new Date(Date.now() + Number(parsed.expires_in) * 1000),
    console: input.console,
    blazeId: "0"
  };

  try {
    const session = await retrieveBlazeSession(partialToken);

    return {
      token: {
        ...partialToken,
        blazeId: String(session.blazeId)
      },
      session,
      raw: parsed
    };
  } catch (error) {
    throw new ApiError(502, "EA OAuth succeeded, but Blaze session creation failed.", {
      console: input.console,
      blazeService: BLAZE_SERVICE[input.console],
      blazeProductName: BLAZE_PRODUCT_NAME[input.console],
      cause: error instanceof Error ? error.message : String(error),
      detail: error instanceof ApiError ? error.details : null
    });
  }
}

export async function refreshCompanionToken(token: EaCompanionToken): Promise<EaCompanionToken> {
  if (new Date() <= token.expiry) return token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.EA_MCA_CLIENT_ID,
    release_type: "prod",
    refresh_token: token.refreshToken,
    authentication_source: String(env.EA_MCA_AUTH_SOURCE),
    token_format: "JWS"
  });

  if (env.EA_MCA_CLIENT_SECRET) {
    body.set("client_secret", env.EA_MCA_CLIENT_SECRET);
  }

  const response = await fetch("https://accounts.ea.com/connect/token", {
    method: "POST",
    headers: {
      "Accept-Charset": "UTF-8",
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept-Encoding": "gzip"
    },
    body: body.toString()
  });

  const rawText = await response.text();
  const parsed = parseEaTokenResponse(rawText);
  logEaTokenExchange("[EA TOKEN REFRESH]", response, parsed);

  if (!response.ok || !parsed.access_token || !parsed.refresh_token || !parsed.expires_in) {
    throw new ApiError(502, "EA token refresh failed.", {
      status: response.status,
      parsed: redactEaTokenResponse(parsed)
    });
  }

  return {
    ...token,
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiry: new Date(Date.now() + Number(parsed.expires_in) * 1000)
  };
}

export async function retrieveBlazeSession(token: EaCompanionToken): Promise<EaBlazeSession> {
  const response = await fetch("https://wal2.tools.gos.bio-iad.ea.com/wal/authentication/login", {
    dispatcher,
    method: "POST",
    headers: companionHeaders(token),
    body: JSON.stringify({
      accessToken: token.accessToken,
      productName: BLAZE_PRODUCT_NAME[token.console]
    })
  });

  const text = await response.text();
  console.log("[EA BLAZE LOGIN]", {
    status: response.status,
    console: token.console,
    blazeService: BLAZE_SERVICE[token.console],
    productName: BLAZE_PRODUCT_NAME[token.console],
    hasResponse: Boolean(text)
  });

  let parsed: BlazeAuthenticatedResponse;
  try {
    parsed = JSON.parse(text) as BlazeAuthenticatedResponse;
  } catch {
    throw new ApiError(502, "Could not parse EA Blaze session response.", {
      status: response.status,
      response: text,
      console: token.console,
      blazeService: BLAZE_SERVICE[token.console],
      productName: BLAZE_PRODUCT_NAME[token.console]
    });
  }

  const sessionKey = parsed.userLoginInfo?.sessionKey;
  const blazeId = parsed.userLoginInfo?.personaDetails?.personaId ?? parsed.userLoginInfo?.blazeId;

  if (!sessionKey || !blazeId || parsed.error) {
    // The HTTP call returned 200 but no usable session — log the body (no session key present on
    // this path) so the actual EA response is visible for diagnosis.
    console.error("[EA BLAZE LOGIN] missing session", {
      status: response.status,
      hasUserLoginInfo: Boolean(parsed.userLoginInfo),
      error: parsed.error ?? null,
      body: text.slice(0, 2000)
    });
    throw new ApiError(502, "Could not create EA Blaze session.", {
      status: response.status,
      error: parsed.error ?? null,
      response: text.slice(0, 2000),
      console: token.console,
      blazeService: BLAZE_SERVICE[token.console],
      productName: BLAZE_PRODUCT_NAME[token.console]
    });
  }

  return {
    blazeId,
    sessionKey,
    requestId: 1
  };
}

function calculateMessageAuthData(blazeId: number, requestId: number) {
  const rand4bytes = randomBytes(4);
  const requestData = JSON.stringify({
    staticData: "05e6a7ead5584ab4",
    requestId,
    blazeId
  });
  const staticBytes = Buffer.from("634203362017bf72f70ba900c0aa4e6b", "hex");
  const xorHash = createHash("md5").update(rand4bytes).update(staticBytes).digest();
  const requestBuffer = Buffer.from(requestData, "utf-8");
  const scrambledBytes = requestBuffer.map((byte, index) => byte ^ xorHash[index % 16]);
  const authDataBytes = Buffer.concat([rand4bytes, scrambledBytes]);
  const staticAuthCode = Buffer.from("3a53413521464c3b6531326530705b70203a2900", "hex");
  const authCode = createHash("md5").update(staticAuthCode).update(authDataBytes).digest("base64");

  return {
    authData: authDataBytes.toString("base64"),
    authCode,
    authType: 17039361
  };
}

async function sendBlazeRequest<T>(token: EaCompanionToken, session: EaBlazeSession, request: BlazeRequest): Promise<T> {
  const authData = calculateMessageAuthData(session.blazeId, session.requestId);
  const { requestPayload, ...rest } = request;
  const body = {
    apiVersion: 2,
    clientDevice: 3,
    requestInfo: JSON.stringify({
      ...rest,
      messageAuthData: authData,
      messageExpirationTime: Math.floor(Date.now() / 1000),
      deviceId: env.EA_MCA_MACHINE_KEY,
      ipAddress: "127.0.0.1",
      requestPayload: JSON.stringify(requestPayload)
    })
  };

  const response = await fetch(`https://wal2.tools.gos.bio-iad.ea.com/wal/mca/Process/${session.sessionKey}`, {
    dispatcher,
    method: "POST",
    headers: companionHeaders(token),
    body: JSON.stringify(body)
  });

  const text = await response.text();
  console.log("[EA BLAZE REQUEST]", {
    commandName: request.commandName,
    status: response.status,
    hasResponse: Boolean(text),
    responsePreview: text.slice(0, 500)
  });

  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) throw new ApiError(502, "EA Blaze request returned an error.", parsed);
    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "EA Blaze request failed.", { response: text });
  }
}

function normalizeLeague(rawLeague: Record<string, unknown>): EaLeagueSummary {
  return {
    leagueId: Number(rawLeague.leagueId),
    leagueName: String(rawLeague.leagueName ?? "Unknown Franchise"),
    seasonText: typeof rawLeague.seasonText === "string" ? rawLeague.seasonText : undefined,
    seasonSort: typeof rawLeague.seasonSort === "number" ? rawLeague.seasonSort : undefined,
    calendarYear: typeof rawLeague.calendarYear === "number" ? rawLeague.calendarYear : undefined,
    numMembers: typeof rawLeague.numMembers === "number" ? rawLeague.numMembers : undefined,
    userTeamId: typeof rawLeague.userTeamId === "number" ? rawLeague.userTeamId : undefined,
    userTeamName: typeof rawLeague.userTeamName === "string" ? rawLeague.userTeamName : undefined,
    isImportable: typeof rawLeague.isImportable === "boolean" ? rawLeague.isImportable : undefined,
    raw: rawLeague
  };
}

export async function getEaFranchises(token: EaCompanionToken, session?: EaBlazeSession) {
  const validToken = await refreshCompanionToken(token);
  const validSession = session ?? await retrieveBlazeSession(validToken);
  const response = await sendBlazeRequest<GetMyLeaguesResponse>(validToken, validSession, {
    commandName: "Mobile_GetMyLeagues",
    componentId: 2060,
    commandId: 801,
    requestPayload: {},
    componentName: "careermode"
  });

  const leagues = response.responseInfo?.value?.leagues;
  console.log("[EA FRANCHISE DISCOVERY]", {
    hasResponseInfo: Boolean(response.responseInfo),
    leagueCount: Array.isArray(leagues) ? leagues.length : 0,
    hasError: Boolean(response.error)
  });

  if (!Array.isArray(leagues)) {
    throw new ApiError(502, "EA franchise discovery response did not include a league list.", {
      response
    });
  }

  return {
    token: validToken,
    session: validSession,
    franchises: leagues.map(normalizeLeague)
  };
}

function formatExportError(error: unknown) {
  const anyError = error as any;
  return String(anyError?.message ?? anyError?.errorname ?? error).slice(0, 500);
}

function stripControlCharacters(text: string) {
  return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

export async function fetchEaExportData(
  token: EaCompanionToken,
  session: EaBlazeSession,
  exportType: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(`https://wal2.tools.gos.bio-iad.ea.com/wal/mca/${exportType}/${session.sessionKey}`, {
    dispatcher,
    method: "POST",
    headers: companionHeaders(token),
    body: JSON.stringify(body)
  });

  const text = stripControlCharacters(await response.text());
  console.log("[EA EXPORT FETCH]", {
    exportType,
    status: response.status,
    responsePreview: text.slice(0, 300)
  });

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(502, "Could not parse EA export response.", {
      exportType,
      status: response.status,
      responsePreview: text.slice(0, 500)
    });
  }

  if (!response.ok || parsed?.error) {
    throw new ApiError(502, "EA export endpoint returned an error.", {
      exportType,
      status: response.status,
      error: parsed?.error ?? null,
      responsePreview: text.slice(0, 500)
    });
  }

  return parsed;
}

async function fetchEaExportDataSoft(
  token: EaCompanionToken,
  session: EaBlazeSession,
  exportType: string,
  body: Record<string, unknown>
): Promise<unknown | null> {
  try {
    return await fetchEaExportData(token, session, exportType, body);
  } catch (error) {
    console.warn("[EA EXPORT SOFT SKIP]", {
      exportType,
      error: formatExportError(error)
    });
    return null;
  }
}

export async function fetchEaWeeklyStats(input: {
  token: EaCompanionToken;
  eaLeagueId: number;
  weekIndex: number;
  stageIndex: number;
  session?: EaBlazeSession;
}): Promise<{ token: EaCompanionToken; session: EaBlazeSession; payloads: WeeklyExportPayloads }> {
  const validToken = input.session ? input.token : await refreshCompanionToken(input.token);
  const validSession = input.session ?? await retrieveBlazeSession(validToken);
  const body = { leagueId: input.eaLeagueId, stageIndex: input.stageIndex, weekIndex: input.weekIndex };
  const errors: Record<string, string> = {};

  const fetchRequired = async (key: keyof typeof EXPORT_ENDPOINTS) => {
    try {
      return await fetchEaExportData(validToken, validSession, EXPORT_ENDPOINTS[key], body);
    } catch (error) {
      errors[key] = formatExportError(error);
      return null;
    }
  };

  const fetchOptional = async (key: keyof typeof EXPORT_ENDPOINTS) => {
    const result = await fetchEaExportDataSoft(validToken, validSession, EXPORT_ENDPOINTS[key], body);
    if (result == null) errors[key] = "Endpoint unavailable or returned no data.";
    return result;
  };

  const [schedules, teamStats, passing, rushing, receiving, defense, kicking, punting] = await Promise.all([
    fetchOptional("schedules"),
    fetchRequired("teamStats"),
    fetchRequired("passing"),
    fetchRequired("rushing"),
    fetchRequired("receiving"),
    fetchRequired("defense"),
    fetchOptional("kicking"),
    fetchOptional("punting")
  ]);

  return {
    token: validToken,
    session: validSession,
    payloads: {
      schedules,
      teamStats,
      passing,
      rushing,
      receiving,
      defense,
      kicking,
      punting,
      errors
    }
  };
}

export async function fetchEaAllWeekSchedules(input: {
  token: EaCompanionToken;
  eaLeagueId: number;
  startWeek?: number;
  totalWeeks?: number;
  stageIndex?: number;
  session?: EaBlazeSession;
}) {
  const validToken = input.session ? input.token : await refreshCompanionToken(input.token);
  const validSession = input.session ?? await retrieveBlazeSession(validToken);
  const startWeek = input.startWeek ?? 1;
  const totalWeeks = input.totalWeeks ?? 18;
  const stageIndex = input.stageIndex ?? 1;
  const weekResults: Array<{ weekNumber: number; weekIndex: number; data: unknown }> = [];

  for (let weekNumber = startWeek; weekNumber <= totalWeeks; weekNumber += 1) {
    const weekIndex = weekNumber - 1;
    const data = await fetchEaExportData(validToken, validSession, EXPORT_ENDPOINTS.schedules, {
      leagueId: input.eaLeagueId,
      stageIndex,
      weekIndex
    });
    weekResults.push({ weekNumber, weekIndex, data });
  }

  return { token: validToken, session: validSession, weekResults };
}

export async function fetchEaLeagueTeams(input: {
  token: EaCompanionToken;
  eaLeagueId: number;
  session?: EaBlazeSession;
}) {
  const validToken = input.session ? input.token : await refreshCompanionToken(input.token);
  const validSession = input.session ?? await retrieveBlazeSession(validToken);
  const data = await fetchEaExportData(validToken, validSession, EXPORT_ENDPOINTS.leagueTeams, {
    leagueId: input.eaLeagueId
  });
  return { token: validToken, session: validSession, data };
}

export async function fetchEaStandings(input: {
  token: EaCompanionToken;
  eaLeagueId: number;
  session?: EaBlazeSession;
}) {
  const validToken = input.session ? input.token : await refreshCompanionToken(input.token);
  const validSession = input.session ?? await retrieveBlazeSession(validToken);
  const data = await fetchEaExportData(validToken, validSession, EXPORT_ENDPOINTS.standings, {
    leagueId: input.eaLeagueId
  });
  return { token: validToken, session: validSession, data };
}

export async function fetchEaLeagueFeed(input: {
  token: EaCompanionToken;
  eaLeagueId: number;
  endpointKey: "news" | "transactions" | "injuries";
  session?: EaBlazeSession;
}) {
  const validToken = input.session ? input.token : await refreshCompanionToken(input.token);
  const validSession = input.session ?? await retrieveBlazeSession(validToken);
  const data = await fetchEaExportData(validToken, validSession, EXPORT_ENDPOINTS[input.endpointKey], {
    leagueId: input.eaLeagueId
  });
  return { token: validToken, session: validSession, data };
}

export async function fetchEaLeagueTeamsAndRosters(input: {
  token: EaCompanionToken;
  eaLeagueId: number;
  session?: EaBlazeSession;
}): Promise<{ token: EaCompanionToken; session: EaBlazeSession; payloads: RosterExportPayloads }> {
  const validToken = input.session ? input.token : await refreshCompanionToken(input.token);
  const validSession = input.session ?? await retrieveBlazeSession(validToken);
  const leagueTeams = await fetchEaExportData(validToken, validSession, EXPORT_ENDPOINTS.leagueTeams, {
    leagueId: input.eaLeagueId
  });

  const teamList = extractArray(leagueTeams, ["leagueTeamInfoList", "teamInfoList", "teams"]);
  const teamRosters: Array<{ teamId: number; listIndex: number; data: unknown }> = [];

  for (let index = 0; index < teamList.length; index += 4) {
    const chunk = teamList.slice(index, index + 4);
    const results = await Promise.all(chunk.map(async (team, chunkIndex) => {
      const listIndex = index + chunkIndex;
      const teamId = Number((team as any).teamId ?? (team as any).id ?? listIndex);
      const data = await fetchEaExportData(validToken, validSession, EXPORT_ENDPOINTS.teamRoster, {
        leagueId: input.eaLeagueId,
        listIndex,
        returnFreeAgents: false,
        teamId
      });
      return { teamId, listIndex, data };
    }));

    teamRosters.push(...results);
  }

  const freeAgents = await fetchEaExportData(validToken, validSession, EXPORT_ENDPOINTS.teamRoster, {
    leagueId: input.eaLeagueId,
    listIndex: -1,
    returnFreeAgents: true,
    teamId: 0
  });

  return {
    token: validToken,
    session: validSession,
    payloads: {
      leagueTeams,
      teamRosters,
      freeAgents
    }
  };
}

export function extractArray(payload: unknown, candidateKeys: string[]): any[] {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === "object") {
    const objectPayload = payload as Record<string, unknown>;
    for (const key of candidateKeys) {
      const value = objectPayload[key];
      if (Array.isArray(value)) return value;
    }

    for (const value of Object.values(objectPayload)) {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        const nested = extractArray(value, candidateKeys);
        if (nested.length > 0) return nested;
      }
    }
  }

  return [];
}
