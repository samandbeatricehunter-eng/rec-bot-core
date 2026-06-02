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
  userLoginInfo: {
    sessionKey: string;
    personaDetails: {
      personaId: number;
      displayName?: string;
    };
  };
};

type BlazeRequest = {
  commandName: string;
  componentId: number;
  commandId: number;
  requestPayload: Record<string, unknown>;
  componentName: string;
};

type GetMyLeaguesResponse = {
  responseInfo: {
    value: {
      leagues: Array<Record<string, unknown>>;
    };
  };
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
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
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
      cause: error instanceof Error ? error.message : String(error)
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
    response: text
  });

  try {
    const parsed = JSON.parse(text) as BlazeAuthenticatedResponse;
    return {
      blazeId: parsed.userLoginInfo.personaDetails.personaId,
      sessionKey: parsed.userLoginInfo.sessionKey,
      requestId: 1
    };
  } catch {
    throw new ApiError(502, "Could not create EA Blaze session.", {
      status: response.status,
      response: text,
      console: token.console,
      blazeService: BLAZE_SERVICE[token.console],
      productName: BLAZE_PRODUCT_NAME[token.console]
    });
  }
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

  return {
    token: validToken,
    session: validSession,
    franchises: response.responseInfo.value.leagues.map(normalizeLeague)
  };
}
