// Auth module — OAuth2 flow for Madden Direct Sync.
// Handles authorization code grant, token refresh, and PKCE.

import crypto from "crypto";
import { loadToken, cacheToken, persistToken, StoredToken } from "../token-vault/index.js";

const EA_AUTH_BASE = "https://accounts.ea.com/connect";
const EA_TOKEN_URL = "https://accounts.ea.com/connect/token";
const EA_API_BASE = "https://gateway.ea.com";

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export function generatePkce(): { codeVerifier: string; codeChallenge: string; codeChallengeMethod: "S256" } {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

export function buildAuthUrl(config: AuthConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login", // force re-auth for security
  });
  return `${EA_AUTH_BASE}/auth?${params.toString()}`;
}

export async function exchangeCodeForToken(
  config: AuthConfig,
  code: string,
  codeVerifier: string
): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: codeVerifier,
  });

  const response = await fetch(EA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as TokenResponse;
  const token: StoredToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
  };
  return token;
}

export async function refreshAccessToken(config: AuthConfig, refreshToken: string): Promise<StoredToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(EA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${error}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    token_type: data.token_type,
  };
}

export async function getValidToken(leagueId: string, config: AuthConfig): Promise<string> {
  const cached = await loadToken(leagueId);
  if (cached && cached.expires_at > Date.now() + 60_000) {
    return cached.access_token;
  }

  // Token expired or missing — refresh
  if (cached?.refresh_token) {
    try {
      const newToken = await refreshAccessToken(config, cached.refresh_token);
      await cacheToken(leagueId, newToken);
      await persistToken(leagueId, { ciphertext: "", iv: "", tag: "" }); // placeholder
      return newToken.access_token;
    } catch (err) {
      console.error(`[Auth] Token refresh failed for league ${leagueId}:`, err);
      // Fall through to require re-auth
    }
  }

  throw new Error(`No valid token for league ${leagueId}; re-authorization required`);
}

export async function revokeToken(config: AuthConfig, token: string): Promise<void> {
  // EA doesn't have a standard revocation endpoint; just clear local cache
  // In production, call EA's revocation if available
}