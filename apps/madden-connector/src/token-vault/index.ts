// Token Vault — encrypted credential/token storage for Direct Sync.
// Uses AES-256-GCM with a master key from env. No hardcoded secrets.

import crypto from "crypto";

const MASTER_KEY_HEX = process.env.MADDEN_CONNECTOR_MASTER_KEY;
if (!MASTER_KEY_HEX || MASTER_KEY_HEX.length !== 64) {
  throw new Error("MADDEN_CONNECTOR_MASTER_KEY must be a 64-char hex string (32 bytes)");
}
const MASTER_KEY = Buffer.from(MASTER_KEY_HEX, "hex");

export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
  token_type: string;
}

export interface StoredCredentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

function encrypt(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decrypt({ ciphertext, iv, tag }: { ciphertext: string; iv: string; tag: string }): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", MASTER_KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function encryptToken(token: StoredToken): { ciphertext: string; iv: string; tag: string } {
  return encrypt(JSON.stringify(token));
}

export function decryptToken(encrypted: { ciphertext: string; iv: string; tag: string }): StoredToken {
  return JSON.parse(decrypt(encrypted));
}

export function encryptCredentials(creds: StoredCredentials): { ciphertext: string; iv: string; tag: string } {
  return encrypt(JSON.stringify(creds));
}

export function decryptCredentials(encrypted: { ciphertext: string; iv: string; tag: string }): StoredCredentials {
  return JSON.parse(decrypt(encrypted));
}

/**
 * In-memory cache for active tokens (refreshed from DB on startup).
 * For production, this would be backed by the DB with the encrypted blobs.
 */
const tokenCache = new Map<string, { token: StoredToken; encrypted: ReturnType<typeof encryptToken> }>();

export function cacheToken(leagueId: string, token: StoredToken): void {
  tokenCache.set(leagueId, { token, encrypted: encryptToken(token) });
}

export function getCachedToken(leagueId: string): StoredToken | undefined {
  return tokenCache.get(leagueId)?.token;
}

export function clearTokenCache(leagueId: string): void {
  tokenCache.delete(leagueId);
}

/**
 * Persist encrypted token to DB (to be implemented with actual DB client).
 * This is a placeholder for the actual storage layer.
 */
export async function persistToken(
  leagueId: string,
  encrypted: ReturnType<typeof encryptToken>
): Promise<void> {
  // TODO: Implement with Supabase client
  // await supabase.from("madden_connector_tokens").upsert({ league_id: leagueId, ...encrypted });
  console.log(`[TokenVault] Would persist token for league ${leagueId}`);
}

export async function loadToken(leagueId: string): Promise<StoredToken | null> {
  // TODO: Implement with Supabase client
  // const { data } = await supabase.from("madden_connector_tokens").select("*").eq("league_id", leagueId).single();
  // if (!data) return null;
  // const token = decryptToken({ ciphertext: data.ciphertext, iv: data.iv, tag: data.tag });
  // tokenCache.set(leagueId, { token, encrypted: data });
  // return token;
  const cached = tokenCache.get(leagueId);
  return cached?.token ?? null;
}