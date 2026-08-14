// Encrypted storage for EA persona tokens.
//
// EA tokens are effectively account credentials: with a refresh token you can act as the
// user's Madden companion app. They are therefore never stored in plaintext — each token pair
// is sealed with AES-256-GCM under EA_TOKEN_ENC_KEY before it reaches Postgres.

import crypto from "node:crypto";
import { env } from "../../config/env.js";
import type { SystemConsole } from "./ea-constants.js";

export type EaTokenPair = {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
};

export type SealedToken = { ciphertext: string; iv: string; tag: string };

export type EaSessionCache = { blazeId: number; sessionKey: string; requestId: number };

export type EaTokenRecord = EaTokenPair & {
  console: SystemConsole;
  blazePersonaId: string;
};

function masterKey(): Buffer {
  const raw = env.EA_TOKEN_ENC_KEY?.trim();
  if (!raw) throw new Error("EA token storage is not configured (EA_TOKEN_ENC_KEY is unset).");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("EA_TOKEN_ENC_KEY must be a 64-character hex string (32 bytes).");
  }
  return Buffer.from(raw, "hex");
}

export function sealToken(token: EaTokenRecord): SealedToken {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(token), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function openToken(sealed: SealedToken): EaTokenRecord {
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as EaTokenRecord;
}

/** Treats a token as expired slightly early so a refresh happens before EA rejects it. */
export function isTokenExpired(token: { expiresAt: number }, skewMs = 60_000): boolean {
  return token.expiresAt <= Date.now() + skewMs;
}
