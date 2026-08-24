// EA OAuth + Blaze client: REC's alternative to asking commissioners to run the Madden
// Companion App. Reverse-engineered flow documented in snallabot/snallabot-service
// (docs/madden/ea_api.md); this is an independent implementation of the same 10 steps.
//
// The flow, in order:
//   1  user opens EA_LOGIN_URL, EA redirects to http://127.0.0.1/success?code=...
//   2  code -> temporary access token
//   3  tokeninfo -> pid_id
//   4  entitlements for pid -> which Madden platforms the account owns
//   5  personas per entitlement -> user picks one
//   6  re-auth scoped to that persona -> the token pair we actually persist
//   7  refresh when expired
//   8  Blaze login -> sessionKey + blazeId
//   9  Blaze RPC (league list, league hub)
//  10  Blaze exports (teams/standings/schedule/stats/rosters)

import crypto from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";
import {
  ANDROID_USER_AGENT,
  AUTH_SOURCE,
  BLAZE_BASE_URL,
  BLAZE_COMPONENT_NAME,
  BLAZE_PRODUCT_NAME,
  BLAZE_SERVICE,
  CLIENT_ID,
  EA_ACCOUNTS_BASE,
  EA_EXPORTS,
  EA_GATEWAY_BASE,
  ENTITLEMENT_TO_SYSTEM,
  ENTITLEMENT_TO_VALID_NAMESPACE,
  MACHINE_KEY,
  REDIRECT_URL,
  VALID_ENTITLEMENTS,
  eaClientSecret,
  type AccountToken,
  type BlazeAuthenticatedResponse,
  type BlazeLeagueResponse,
  type EaLeagueResponse,
  type EaLeagueSummary,
  type EaNamespace,
  type Entitlements,
  type GetMyLeaguesResponse,
  type Persona,
  type Personas,
  type SystemConsole,
  type TokenInfo,
} from "./ea-constants.js";
import type { EaStage } from "./ea-weeks.js";
import type { EaSessionCache, EaTokenPair } from "./ea-token-vault.js";

/** EA's Blaze hosts still negotiate legacy SSL; Node's defaults reject them outright. */
const legacySslAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
    secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  },
});

export class EaAuthError extends Error {
  readonly guidance: string;
  constructor(message: string, guidance: string) {
    super(message);
    this.name = "EaAuthError";
    this.guidance = guidance;
  }
}

/**
 * EA rejecting a specific service (observed: League Hub / getLeagueInfo) with
 * errortdf.errorString "Restricted" while login, session creation, and getLeagues() all keep
 * succeeding on the same token. Deliberately NOT a BlazeSessionError/EaAuthError — both of
 * those trigger session-clear-and-retry in the callers below, which is pointless (and just
 * hammers an endpoint EA is already gating) when the session itself is fine and the block is
 * per-service on EA's end.
 */
export class BlazeRestrictedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlazeRestrictedError";
  }
}

/** Pulls EA's nested errortdf.errorString out of a Blaze error envelope, if present. */
function blazeErrorString(errorPayload: unknown): string | undefined {
  if (!errorPayload || typeof errorPayload !== "object") return undefined;
  const errortdf = (errorPayload as Record<string, unknown>).errortdf;
  if (!errortdf || typeof errortdf !== "object") return undefined;
  const errorString = (errortdf as Record<string, unknown>).errorString;
  return typeof errorString === "string" ? errorString : undefined;
}

export class BlazeSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlazeSessionError";
  }
}

const formHeaders = {
  "Accept-Charset": "UTF-8",
  "User-Agent": ANDROID_USER_AGENT,
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Accept-Encoding": "gzip",
};

function blazeHeaders(console: SystemConsole) {
  return {
    "Accept-Charset": "UTF-8",
    Accept: "application/json",
    "X-BLAZE-ID": BLAZE_SERVICE[console],
    "X-BLAZE-VOID-RESP": "XML",
    "X-Application-Key": "MADDEN-MCA",
    "Content-Type": "application/json",
    "User-Agent": ANDROID_USER_AGENT,
  };
}

/**
 * Pulls the `code` out of whatever the user pasted. EA redirects to a localhost URL that
 * never reaches our server, so the commissioner copies the address bar; accept a bare code
 * too, since some browsers show only the fragment.
 */
export function extractAuthCode(pasted: string): string {
  const trimmed = pasted.trim();
  if (!trimmed) throw new EaAuthError("No EA redirect URL was provided.", "Paste the full URL from your browser's address bar.");
  const queryStart = trimmed.indexOf("?");
  if (queryStart >= 0) {
    const code = new URLSearchParams(trimmed.slice(queryStart)).get("code");
    if (code) return code;
  }
  // A bare code: EA codes are opaque but never contain spaces, slashes, or a scheme.
  if (!/[\s/]/.test(trimmed) && !trimmed.includes("://") && trimmed.length > 8) return trimmed;
  throw new EaAuthError(
    `Could not find a login code in the pasted URL.`,
    "Expected something like http://127.0.0.1/success?code=... — copy the whole address bar after signing in to EA.",
  );
}

// ── Step 2: code -> temporary token ──

export async function exchangeCodeForToken(code: string): Promise<AccountToken> {
  const body = new URLSearchParams({
    authentication_source: AUTH_SOURCE,
    client_secret: eaClientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URL,
    release_type: "prod",
    client_id: CLIENT_ID,
  });
  const response = await undiciFetch(`${EA_ACCOUNTS_BASE}/connect/token`, {
    method: "POST",
    headers: formHeaders,
    body: body.toString(),
  });
  const text = await response.text();
  let token: AccountToken;
  try {
    token = JSON.parse(text) as AccountToken;
  } catch {
    throw new EaAuthError(`EA returned an unreadable token response: ${text.slice(0, 300)}`, "Try the login again.");
  }
  if (!response.ok || !token.access_token) {
    throw new EaAuthError(
      `EA rejected the login code: ${text.slice(0, 300)}`,
      "Each login URL works only once. Go back, click Login to EA again, and paste the fresh URL. An incognito window can help if it keeps failing.",
    );
  }
  return token;
}

// ── Steps 3-5: entitlements -> pidId -> personas ──
//
// Mirrors snallabot's retrievePersonas exactly: /connect/tokeninfo (with
// X-Include-Deviceid) yields the pid, then entitlements are fetched with a Bearer header
// and entitlementTag ONLINE_ACCESS + a MADDEN_XX groupName filter gates the account.

export type MaddenPersona = Persona & { maddenEntitlement: string; console: SystemConsole };

/** Step 3: access token -> pidId. */
async function fetchPidId(accessToken: string): Promise<string> {
  const response = await undiciFetch(`${EA_ACCOUNTS_BASE}/connect/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
    headers: {
      "Accept-Charset": "UTF-8",
      "User-Agent": ANDROID_USER_AGENT,
      "X-Include-Deviceid": "true",
      "Accept-Encoding": "gzip",
    },
  });
  const text = await response.text();
  let info: TokenInfo;
  try {
    info = JSON.parse(text) as TokenInfo;
  } catch {
    throw new EaAuthError(`EA returned an unreadable token info response: ${text.slice(0, 300)}`, "Try connecting again.");
  }
  if (!response.ok || !info.pid_id) {
    throw new EaAuthError(`EA would not identify this login: ${text.slice(0, 300)}`, "Try connecting again with a fresh login URL.");
  }
  return info.pid_id;
}

/** Step 4: entitlements for pid -> which Madden platforms the account owns (Bearer header). */
async function fetchEntitlements(accessToken: string, pidId: string): Promise<Entitlements> {
  const response = await undiciFetch(`${EA_GATEWAY_BASE}/proxy/identity/pids/${pidId}/entitlements/?status=ACTIVE`, {
    headers: {
      "Accept-Charset": "UTF-8",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": ANDROID_USER_AGENT,
      "X-Expand-Results": "true",
      "Accept-Encoding": "gzip",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new EaAuthError(`EA would not list this account's games: ${text.slice(0, 300)}`, "Try connecting again.");
  }
  return JSON.parse(text) as Entitlements;
}

/**
 * Combined steps 3-5: given a temporary access token, discover Madden entitlements and
 * return the matching personas.
 */
export async function getMaddenPersonas(accessToken: string): Promise<{ pidId: string; personas: MaddenPersona[] }> {
  const pidId = await fetchPidId(accessToken);
  const allEntitlements = (await fetchEntitlements(accessToken, pidId)).entitlements?.entitlement ?? [];

  const validGroups = new Set(Object.values(VALID_ENTITLEMENTS));
  const maddenEntitlements = allEntitlements.filter(
    (entitlement) => entitlement.entitlementTag === "ONLINE_ACCESS" && validGroups.has(entitlement.groupName),
  );
  if (maddenEntitlements.length === 0) {
    throw new EaAuthError(
      "This EA account has no Madden online access entitlement.",
      "Make sure you signed in with the EA account that owns Madden and plays in your league.",
    );
  }

  const personaLists = await Promise.all(
    maddenEntitlements.map(async (entitlement) => {
      const response = await undiciFetch(
        `${EA_GATEWAY_BASE}/proxy/identity${entitlement.pidUri}/personas?status=ACTIVE&access_token=${encodeURIComponent(accessToken)}`,
        {
          headers: {
            "Accept-Charset": "UTF-8",
            "X-Expand-Results": "true",
            "User-Agent": ANDROID_USER_AGENT,
            "Accept-Encoding": "gzip",
          },
        },
      );
      const text = await response.text();
      if (!response.ok) throw new EaAuthError(`EA would not list your gamertags: ${text.slice(0, 300)}`, "Try connecting again.");
      const personas = JSON.parse(text) as Personas;
      return (personas.personas?.persona ?? []).map((persona) => ({
        ...persona,
        maddenEntitlement: entitlement.groupName,
      }));
    }),
  );

  // A persona only belongs to an entitlement when the namespace matches, otherwise an Xbox
  // gamertag can appear under a PlayStation entitlement and Blaze login fails later.
  const filtered = personaLists
    .flat()
    .filter((persona) => ENTITLEMENT_TO_VALID_NAMESPACE[persona.maddenEntitlement] === persona.namespaceName)
    .map((persona) => ({ ...persona, console: ENTITLEMENT_TO_SYSTEM[persona.maddenEntitlement] }));

  return { pidId, personas: filtered };
}

// ── Step 6: persona-scoped token ──

export async function getPersonaScopedToken(
  temporaryAccessToken: string,
  personaId: number,
  namespaceName: EaNamespace,
): Promise<EaTokenPair> {
  const authUrl =
    `${EA_ACCOUNTS_BASE}/connect/auth?hide_create=true&release_type=prod&response_type=code` +
    `&redirect_uri=${REDIRECT_URL}&client_id=${CLIENT_ID}&machineProfileKey=${MACHINE_KEY}` +
    `&authentication_source=${AUTH_SOURCE}&access_token=${encodeURIComponent(temporaryAccessToken)}` +
    `&persona_id=${personaId}&persona_namespace=${namespaceName}`;

  // EA answers with a redirect to the localhost URL; we only want its `code`, so we must not
  // let the client follow it. Snallabot sends this step from an Android WebView (browser UA +
  // X-Requested-With), not the Dalvik app UA — the accounts server renders its interstitial
  // page for browser clients and only then 302s to the redirect URI.
  const authResponse = await undiciFetch(authUrl, {
    method: "GET",
    redirect: "manual",
    headers: {
      "Upgrade-Insecure-Requests": "1",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.71 Mobile Safari/537.36",
      "X-Requested-With": "com.ea.gp.madden19companionapp",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    },
  });
  const location = authResponse.headers.get("location");
  if (!location) {
    throw new EaAuthError(
      `EA did not return a persona login redirect (status ${authResponse.status}).`,
      "Try connecting again; if it persists, EA may have changed the companion app flow.",
    );
  }
  const code = extractAuthCode(location);

  const body = new URLSearchParams({
    authentication_source: AUTH_SOURCE,
    code,
    grant_type: "authorization_code",
    token_format: "JWS",
    release_type: "prod",
    client_secret: eaClientSecret(),
    redirect_uri: REDIRECT_URL,
    client_id: CLIENT_ID,
  });
  const tokenResponse = await undiciFetch(`${EA_ACCOUNTS_BASE}/connect/token`, {
    method: "POST",
    headers: formHeaders,
    body: body.toString(),
  });
  const text = await tokenResponse.text();
  let token: AccountToken;
  try {
    token = JSON.parse(text) as AccountToken;
  } catch {
    throw new EaAuthError(`EA returned an unreadable persona token: ${text.slice(0, 300)}`, "Try connecting again.");
  }
  if (!tokenResponse.ok || !token.access_token) {
    throw new EaAuthError(`EA would not issue a token for that gamertag: ${text.slice(0, 300)}`, "Try connecting again.");
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

// ── Step 7: refresh ──

export async function refreshEaToken(refreshToken: string): Promise<EaTokenPair> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: eaClientSecret(),
    release_type: "prod",
    refresh_token: refreshToken,
    authentication_source: AUTH_SOURCE,
    token_format: "JWS",
  });
  const response = await undiciFetch(`${EA_ACCOUNTS_BASE}/connect/token`, {
    method: "POST",
    headers: formHeaders,
    body: body.toString(),
  });
  const text = await response.text();
  let token: AccountToken;
  try {
    token = JSON.parse(text) as AccountToken;
  } catch {
    throw new EaAuthError(`EA returned an unreadable refresh response: ${text.slice(0, 300)}`, "Reconnect this league to EA.");
  }
  if (!response.ok || !token.access_token) {
    throw new EaAuthError(
      `EA would not refresh the connection: ${text.slice(0, 300)}`,
      "EA connections expire after about ten days of inactivity. Reconnect this league to EA from the Import Data window.",
    );
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

// ── Step 8: Blaze session ──

export async function createBlazeSession(accessToken: string, console: SystemConsole): Promise<EaSessionCache> {
  const response = await undiciFetch(`${BLAZE_BASE_URL}/wal/authentication/login`, {
    dispatcher: legacySslAgent,
    method: "POST",
    headers: blazeHeaders(console),
    body: JSON.stringify({ accessToken, productName: BLAZE_PRODUCT_NAME[console] }),
  });
  const text = await response.text();
  try {
    const session = JSON.parse(text) as BlazeAuthenticatedResponse;
    return {
      blazeId: session.userLoginInfo.personaDetails.personaId,
      sessionKey: session.userLoginInfo.sessionKey,
      requestId: 1,
    };
  } catch {
    throw new EaAuthError(
      `Could not start a Madden session with EA: ${text.slice(0, 300)}`,
      "This is often temporary (EA servers down or in maintenance). If it keeps happening, unlink and reconnect the league.",
    );
  }
}

// ── Step 9: signed Blaze RPC ──

type MessageAuth = { authData: string; authCode: string; authType: number };

const AUTH_STATIC_DATA = "05e6a7ead5584ab4";
const AUTH_XOR_STATIC_BYTES = Buffer.from("634203362017bf72f70ba900c0aa4e6b", "hex");
const AUTH_CODE_STATIC_BYTES = Buffer.from("3a53413521464c3b6531326530705b70203a2900", "hex");
const AUTH_TYPE = 17039361;

/**
 * Every Blaze RPC carries a signed blob. The bytes must match the companion app exactly:
 * 4 random bytes, then the request JSON XOR'd with md5(random + static), prefixed by those
 * random bytes; authCode is md5(staticAuthCode + authData).
 */
export function calculateMessageAuthData(blazeId: number, requestId: number): MessageAuth {
  const random4 = crypto.randomBytes(4);
  const requestData = JSON.stringify({ staticData: AUTH_STATIC_DATA, requestId, blazeId });
  const xorHash = crypto.createHash("md5").update(random4).update(AUTH_XOR_STATIC_BYTES).digest();
  const scrambled = Buffer.from(requestData, "utf-8").map((byte, index) => byte ^ xorHash[index % 16]);
  const authDataBytes = Buffer.concat([random4, scrambled]);
  const authCode = crypto.createHash("md5").update(AUTH_CODE_STATIC_BYTES).update(authDataBytes).digest("base64");
  return { authData: authDataBytes.toString("base64"), authCode, authType: AUTH_TYPE };
}

/** EA embeds control characters in export payloads that are illegal in strict JSON. */
export function stripControlCharacters(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

type BlazeRpc = {
  commandName: string;
  commandId?: number;
  requestPayload: Record<string, unknown>;
  componentId?: number;
};

// EA renamed the Blaze component from "careermode" to "franchisemode" for Madden 27, but
// Madden 26 leagues are still addressed as "careermode" (even though M26 responses were
// already labelled Blaze::FranchiseMode:: internally). Rather than guess the league's year,
// remember whichever name EA last accepted and fall back to the other one on error — keyed
// per Blaze session (effectively per league's import), not a single process-wide variable.
// A shared global here let two leagues on different Madden years importing concurrently
// stomp on each other's working component name mid-request.
const COMPONENT_NAME_FALLBACK = BLAZE_COMPONENT_NAME === "careermode" ? "franchisemode" : "careermode";
const workingComponentNameByBlazeId = new Map<number, string>();


/** Hung EA sockets used to freeze a whole import; snallabot only retries JSON ERR_TIMEOUT. */
export const EA_BLAZE_FETCH_TIMEOUT_MS = 45_000;

function isAbortTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isTransientEaExportError(errorName: string | undefined): boolean {
  return errorName === "ERR_TIMEOUT" || errorName === "MCA_ERR_SERVER_ERROR";
}

async function sendBlazeRpc<T>(
  token: { accessToken: string; console: SystemConsole },
  session: EaSessionCache,
  rpc: BlazeRpc,
): Promise<T> {
  const componentName = workingComponentNameByBlazeId.get(session.blazeId) ?? BLAZE_COMPONENT_NAME;
  const attempt = async (name: string): Promise<T> => {
    const auth = calculateMessageAuthData(session.blazeId, session.requestId);
    const body = {
      apiVersion: 2,
      clientDevice: 3,
      requestInfo: JSON.stringify({
        commandName: rpc.commandName,
        // Numeric componentId/commandId are optional -- a reference implementation resolves the
        // command purely from commandName + componentName and omits them entirely.
        ...(rpc.componentId != null ? { componentId: rpc.componentId } : {}),
        ...(rpc.commandId != null ? { commandId: rpc.commandId } : {}),
        componentName: name,
        messageAuthData: auth,
        messageExpirationTime: Math.floor(Date.now() / 1000),
        deviceId: MACHINE_KEY,
        ipAddress: "127.0.0.1",
        requestPayload: JSON.stringify(rpc.requestPayload),
      }),
    };
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(`${BLAZE_BASE_URL}/wal/mca/Process/${session.sessionKey}`, {
        dispatcher: legacySslAgent,
        method: "POST",
        headers: blazeHeaders(token.console),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EA_BLAZE_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      if (isAbortTimeout(error)) throw new BlazeSessionError(`Process: hung EA socket (${rpc.commandName})`);
      throw error;
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripControlCharacters(text));
    } catch {
      throw new EaAuthError(`EA returned an unreadable response: ${text.slice(0, 300)}`, "Try again in a moment.");
    }
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const errorPayload = (parsed as Record<string, unknown>).error;
      if (blazeErrorString(errorPayload)?.trim().toLowerCase() === "restricted") {
        throw new BlazeRestrictedError(
          "EA is currently restricting access to this franchise's League Hub data. This isn't a session or authentication problem — reconnecting won't fix it. It typically clears on its own; try again later.",
        );
      }
      // A stale sessionKey surfaces as a Blaze error; callers re-authenticate and retry.
      throw new BlazeSessionError(JSON.stringify(errorPayload).slice(0, 400));
    }
    return parsed as T;
  };

  try {
    const result = await attempt(componentName);
    workingComponentNameByBlazeId.set(session.blazeId, componentName);
    return result;
  } catch (error) {
    if (!(error instanceof BlazeSessionError)) throw error;
    // Wrong component name for this league's Madden year also surfaces as a Blaze error —
    // try the other name before giving the session-retry machinery a chance to run.
    const fallback = componentName === "careermode" ? "franchisemode" : "careermode";
    const result = await attempt(fallback);
    workingComponentNameByBlazeId.set(session.blazeId, fallback);
    return result;
  }
}

// Direct-path dispatch, same wire format as sendExport below: raw payload as the body (no
// Process envelope, no messageAuthData/componentId/commandId/componentName at all), POSTed to a
// command-specific URL path. Every export (teams/standings/schedule/stats/rosters -- proven
// reliable, used for every import) goes through this exact shape; sendBlazeRpc's generic
// "Process" envelope is only proven for two read RPCs (GetMyLeagues/GetLeagueHub). Trying this
// shape for the write-side admin commands is untested but structurally the most different lever
// available: every previous attempt only varied fields *inside* the Process envelope, never
// whether the envelope itself was the right mechanism.
async function sendBlazeDirectAction<T>(
  token: { accessToken: string; console: SystemConsole },
  session: EaSessionCache,
  commandName: string,
  payload: Record<string, unknown>,
): Promise<T> {
  // First live test of the bare export shape (no auth data at all) got back a genuine HTTP-style
  // "401 Request not authorized" (XML, distinct from every prior generic Process-envelope error)
  // -- real evidence the direct URL path is a real, distinct, auth-checked endpoint, just missing
  // credentials exports apparently don't need to supply. Flattened (not envelope-wrapped, unlike
  // sendBlazeRpc) auth fields onto the payload as the next hypothesis.
  const auth = calculateMessageAuthData(session.blazeId, session.requestId);
  const body = {
    ...payload,
    messageAuthData: auth,
    messageExpirationTime: Math.floor(Date.now() / 1000),
    deviceId: MACHINE_KEY,
    ipAddress: "127.0.0.1",
  };
  // The 401 persisted through a full session recreation (a fresh sessionKey, not just a retried
  // request), so it isn't staleness -- something about this specific endpoint's authorization is
  // missing regardless of session freshness. None of our other Blaze calls (reads or exports)
  // ever send the OAuth access token as a header; they're identified purely by sessionKey in the
  // URL. Testing whether this write endpoint specifically expects it as a Bearer header, the same
  // way EA's own accounts/entitlements endpoints do (fetchEntitlements above).
  let response: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    response = await undiciFetch(`${BLAZE_BASE_URL}/wal/mca/${commandName}/${session.sessionKey}`, {
      dispatcher: legacySslAgent,
      method: "POST",
      headers: { ...blazeHeaders(token.console), Authorization: `Bearer ${token.accessToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EA_BLAZE_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortTimeout(error)) throw new BlazeSessionError(`${commandName}: hung EA socket`);
    throw error;
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripControlCharacters(text));
  } catch {
    // EA's gateway itself (as opposed to the Blaze app-level JSON error envelope) rejects with
    // plain XML, e.g. <error><errorcode>401</errorcode><errormessage>...</errormessage></error>.
    const xmlMessage = /<errormessage>([^<]*)<\/errormessage>/i.exec(text)?.[1]?.trim();
    const xmlCode = /<errorcode>([^<]*)<\/errorcode>/i.exec(text)?.[1]?.trim();
    if (xmlMessage) throw new BlazeSessionError(`${commandName}: ${xmlCode ? `${xmlCode} ` : ""}${xmlMessage}`);
    throw new EaAuthError(`EA returned an unreadable response: ${text.slice(0, 300)}`, "Try again in a moment.");
  }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const errorPayload = (parsed as Record<string, unknown>).error;
    if (blazeErrorString(errorPayload)?.trim().toLowerCase() === "restricted") {
      throw new BlazeRestrictedError(
        `EA is currently restricting access to ${commandName}. This isn't a session or authentication problem — reconnecting won't fix it. It typically clears on its own; try again later.`,
      );
    }
    throw new BlazeSessionError(JSON.stringify(errorPayload).slice(0, 400));
  }
  return parsed as T;
}

// ── Step 10: exports ──

// sendBlazeRpc (above) already tries both "careermode" and "franchisemode" for the RPC
// component name — EA renamed it for M27 but a league on a different Madden year still
// answers to the old one. The export commands (EA_EXPORTS.*) went through the same rename
// once already (docs/... PR #150 notes upstream still uses CareerMode_* as of that PR, but
// it's explicitly called out as unsettled) and had no equivalent fallback at all: a fixed
// "CareerMode_" prefix with zero retry on anything but ERR_TIMEOUT, so if EA ever renames
// these the same way, every export call for that league fails immediately with no self-heal.
const workingExportPrefixByBlazeId = new Map<number, string>();
function swapExportPrefix(name: string): string | null {
  if (name.startsWith("CareerMode_")) return name.replace(/^CareerMode_/, "FranchiseMode_");
  if (name.startsWith("FranchiseMode_")) return name.replace(/^FranchiseMode_/, "CareerMode_");
  return null;
}

async function sendExport<T>(
  token: { accessToken: string; console: SystemConsole },
  session: EaSessionCache,
  exportName: string,
  payload: Record<string, unknown>,
  retries = 8,
  baseDelayMs = 2000,
): Promise<T> {
  const remembered = workingExportPrefixByBlazeId.get(session.blazeId);
  const effectiveName = remembered ? exportName.replace(/^(CareerMode_|FranchiseMode_)/, remembered) : exportName;

  const attempt = async (name: string): Promise<T> => {
    for (let i = 0; i < retries; i += 1) {
      let response: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        response = await undiciFetch(`${BLAZE_BASE_URL}/wal/mca/${name}/${session.sessionKey}`, {
          dispatcher: legacySslAgent,
          method: "POST",
          headers: blazeHeaders(token.console),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(EA_BLAZE_FETCH_TIMEOUT_MS),
        });
      } catch (error) {
        if (!isAbortTimeout(error)) throw error;
        if (i >= 4) throw new BlazeSessionError(`${name}: persistent ERR_TIMEOUT — session may be stale`);
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
          continue;
        }
        throw new EaAuthError(
          `EA timed out after ${retries} attempts fetching ${name}.`,
          "EA's servers are busy. Wait a few minutes and import again.",
        );
      }
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripControlCharacters(text));
      } catch {
        throw new EaAuthError(`EA returned unreadable export data: ${text.slice(0, 300)}`, "Try the import again.");
      }
      const errorPayload =
        parsed && typeof parsed === "object" && "error" in parsed
          ? (parsed as { error?: unknown }).error
          : undefined;
      const errorName =
        errorPayload && typeof errorPayload === "object" ? (errorPayload as { errorname?: string }).errorname : undefined;
      if (blazeErrorString(errorPayload)?.trim().toLowerCase() === "restricted") {
        throw new BlazeRestrictedError(
          `EA is currently restricting access to ${name}. This isn't a session or authentication problem — reconnecting won't fix it. It typically clears on its own; try again later.`,
        );
      }
      // EA times out / 500s under concurrent load far more often than it fails outright.
      // After 4 transients the session may be stale — throw BlazeSessionError so the caller
      // re-creates the session and retries.
      if (isTransientEaExportError(errorName)) {
        if (i >= 4) throw new BlazeSessionError(`${name}: persistent ERR_TIMEOUT — session may be stale`);
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
          continue;
        }
        throw new EaAuthError(
          `EA timed out after ${retries} attempts fetching ${name}.`,
          "EA's servers are busy. Wait a few minutes and import again.",
        );
      }
      if (errorName) throw new BlazeSessionError(`${name}: ${errorName}`);
      return parsed as T;
    }
    throw new EaAuthError(`EA request for ${name} failed.`, "Try the import again.");
  };

  try {
    const result = await attempt(effectiveName);
    workingExportPrefixByBlazeId.set(session.blazeId, effectiveName.match(/^(CareerMode_|FranchiseMode_)/)?.[0] ?? "CareerMode_");
    return result;
  } catch (error) {
    // Only worth trying the other prefix on a real Blaze error, not a timeout (that already
    // exhausted its own retries/backoff above, and the prefix isn't the problem there).
    const fallbackName = error instanceof BlazeSessionError ? swapExportPrefix(effectiveName) : null;
    if (!fallbackName) throw error;
    const result = await attempt(fallbackName);
    workingExportPrefixByBlazeId.set(session.blazeId, fallbackName.match(/^(CareerMode_|FranchiseMode_)/)?.[0] ?? "CareerMode_");
    return result;
  }
}

export type EaClient = {
  console: SystemConsole;
  session: EaSessionCache;
  /** Keepalive: sends a lightweight request to prevent EA from killing the session. */
  keepAlive(): Promise<void>;
  getLeagues(): Promise<EaLeagueSummary[]>;
  getLeagueInfo(leagueId: number): Promise<EaLeagueResponse>;
  getTeams(leagueId: number): Promise<unknown>;
  getStandings(leagueId: number): Promise<unknown>;
  getSchedules(leagueId: number, stage: EaStage, weekIndex: number): Promise<unknown>;
  getPassingStats(leagueId: number, stage: EaStage, weekIndex: number): Promise<unknown>;
  getRushingStats(leagueId: number, stage: EaStage, weekIndex: number): Promise<unknown>;
  getReceivingStats(leagueId: number, stage: EaStage, weekIndex: number): Promise<unknown>;
  getDefensiveStats(leagueId: number, stage: EaStage, weekIndex: number): Promise<unknown>;
  getKickingStats(leagueId: number, stage: EaStage, weekIndex: number): Promise<unknown>;
  getPuntingStats(leagueId: number, stage: EaStage, weekIndex: number): Promise<unknown>;
  getTeamStats(leagueId: number, stage: EaStage, weekIndex: number): Promise<unknown>;
  getTeamRoster(leagueId: number, teamId: number, teamIndex: number): Promise<unknown>;
  getFreeAgents(leagueId: number): Promise<unknown>;
  // ── In-game admin actions (write-side; commandId is always 0 for these) ──
  submitCareerResponse(leagueId: number): Promise<unknown>;
  clearCapPenalties(leagueId: number, teamId: number): Promise<unknown>;
  bootUser(leagueId: number, userId: string): Promise<unknown>;
  addAdmin(leagueId: number, userId: string): Promise<unknown>;
  removeAdmin(leagueId: number, userId: string): Promise<unknown>;
  forceHomeWin(leagueId: number, scheduleId: number, stageIndex: EaStage, weekIndex: number): Promise<unknown>;
  forceAwayWin(leagueId: number, scheduleId: number, stageIndex: EaStage, weekIndex: number): Promise<unknown>;
  forceNoWin(leagueId: number, scheduleId: number, stageIndex: EaStage, weekIndex: number): Promise<unknown>;
  toggleAutoPilot(leagueId: number, userId: string, weeks: number): Promise<unknown>;
};

export function createEaClient(
  token: { accessToken: string; console: SystemConsole },
  session: EaSessionCache,
): EaClient {
  const weekPayload = (leagueId: number, stage: EaStage, weekIndex: number) => ({
    leagueId,
    stageIndex: stage,
    weekIndex,
  });
  return {
    console: token.console,
    session,
    async keepAlive() {
      // Lightweight request to keep the Blaze session alive — snallabot uses
      // Mobile_GetMyLeagues for this purpose. If it fails, callers should
      // recreate the session before continuing.
      await sendBlazeRpc<GetMyLeaguesResponse>(token, session, {
        commandName: "Mobile_GetMyLeagues",
        commandId: 801,
        requestPayload: {},
      });
    },
    async getLeagues() {
      const response = await sendBlazeRpc<GetMyLeaguesResponse>(token, session, {
        commandName: "Mobile_GetMyLeagues",
        commandId: 801,
        requestPayload: {},
      });
      return response.responseInfo.value.leagues ?? [];
    },
    async getLeagueInfo(leagueId) {
      const response = await sendBlazeRpc<BlazeLeagueResponse>(token, session, {
        commandName: "Mobile_Career_GetLeagueHub",
        commandId: 811,
        requestPayload: { leagueId },
      });
      return response.responseInfo.value;
    },
    getTeams: (leagueId) => sendExport(token, session, EA_EXPORTS.TEAMS, { leagueId }),
    getStandings: (leagueId) => sendExport(token, session, EA_EXPORTS.STANDINGS, { leagueId }),
    getSchedules: (leagueId, stage, weekIndex) =>
      sendExport(token, session, EA_EXPORTS.WEEKLY_SCHEDULE, weekPayload(leagueId, stage, weekIndex)),
    getPassingStats: (leagueId, stage, weekIndex) =>
      sendExport(token, session, EA_EXPORTS.PASSING_STATS, weekPayload(leagueId, stage, weekIndex)),
    getRushingStats: (leagueId, stage, weekIndex) =>
      sendExport(token, session, EA_EXPORTS.RUSHING_STATS, weekPayload(leagueId, stage, weekIndex)),
    getReceivingStats: (leagueId, stage, weekIndex) =>
      sendExport(token, session, EA_EXPORTS.RECEIVING_STATS, weekPayload(leagueId, stage, weekIndex)),
    getDefensiveStats: (leagueId, stage, weekIndex) =>
      sendExport(token, session, EA_EXPORTS.DEFENSIVE_STATS, weekPayload(leagueId, stage, weekIndex)),
    getKickingStats: (leagueId, stage, weekIndex) =>
      sendExport(token, session, EA_EXPORTS.KICKING_STATS, weekPayload(leagueId, stage, weekIndex)),
    getPuntingStats: (leagueId, stage, weekIndex) =>
      sendExport(token, session, EA_EXPORTS.PUNTING_STATS, weekPayload(leagueId, stage, weekIndex)),
    getTeamStats: (leagueId, stage, weekIndex) =>
      sendExport(token, session, EA_EXPORTS.TEAM_STATS, weekPayload(leagueId, stage, weekIndex)),
    getTeamRoster: (leagueId, teamId, teamIndex) =>
      sendExport(token, session, EA_EXPORTS.TEAM_ROSTER, {
        leagueId,
        listIndex: teamIndex,
        returnFreeAgents: false,
        teamId,
      }),
    getFreeAgents: (leagueId) =>
      sendExport(token, session, EA_EXPORTS.TEAM_ROSTER, {
        leagueId,
        listIndex: -1,
        returnFreeAgents: true,
        teamId: 0,
      }),
    // These 8 write-side admin commands now use sendBlazeDirectAction -- the same wire shape as
    // every export below (raw payload, no Process envelope/messageAuthData/componentId/
    // commandId/componentName), dispatched to a command-specific URL path instead of the generic
    // Process endpoint. Every prior attempt only varied fields *inside* the Process envelope
    // (componentId, commandId, componentName) and got an identical error regardless -- a strong
    // sign the envelope mechanism itself, not its contents, was the mismatch. Every payload still
    // carries `requestorUserId: session.blazeId` (the connected persona's own id) -- unverified
    // guess, along with every other field name here.
    submitCareerResponse: (leagueId) =>
      sendBlazeDirectAction(token, session, "Mobile_Career_SubmitResponse", { leagueId, requestorUserId: session.blazeId }),
    clearCapPenalties: (leagueId, teamId) =>
      sendBlazeDirectAction(token, session, "Mobile_UserAdmin_ClearCapPenalties", { leagueId, teamId, requestorUserId: session.blazeId }),
    bootUser: (leagueId, userId) =>
      sendBlazeDirectAction(token, session, "Mobile_UserAdmin_BootUser", { leagueId, userId, requestorUserId: session.blazeId }),
    addAdmin: (leagueId, userId) =>
      sendBlazeDirectAction(token, session, "Mobile_UserAdmin_AddAdmin", { leagueId, userId, requestorUserId: session.blazeId }),
    removeAdmin: (leagueId, userId) =>
      sendBlazeDirectAction(token, session, "Mobile_UserAdmin_RemoveAdmin", { leagueId, userId, requestorUserId: session.blazeId }),
    forceHomeWin: (leagueId, scheduleId, stageIndex, weekIndex) =>
      sendBlazeDirectAction(token, session, "Mobile_GameSchedule_ForceHomeWin", { leagueId, scheduleId, stageIndex, weekIndex, requestorUserId: session.blazeId }),
    forceAwayWin: (leagueId, scheduleId, stageIndex, weekIndex) =>
      sendBlazeDirectAction(token, session, "Mobile_GameSchedule_ForceAwayWin", { leagueId, scheduleId, stageIndex, weekIndex, requestorUserId: session.blazeId }),
    forceNoWin: (leagueId, scheduleId, stageIndex, weekIndex) =>
      sendBlazeDirectAction(token, session, "Mobile_GameSchedule_ForceNoWin", { leagueId, scheduleId, stageIndex, weekIndex, requestorUserId: session.blazeId }),
    toggleAutoPilot: (leagueId, userId, weeks) =>
      sendBlazeDirectAction(token, session, "Mobile_UserAdmin_ToggleAutoPilot", { leagueId, userId, weeks, requestorUserId: session.blazeId }),
  };
}
