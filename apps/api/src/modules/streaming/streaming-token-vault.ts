import crypto from "node:crypto";
import { env } from "../../config/env.js";

export type StreamingTokenPair = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

export type SealedStreamingToken = { ciphertext: string; iv: string; tag: string };

function masterKey(): Buffer | null {
  const raw = env.EA_TOKEN_ENC_KEY?.trim();
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

export function canSealStreamingTokens(): boolean {
  return masterKey() !== null;
}

export function sealStreamingToken(token: StreamingTokenPair): SealedStreamingToken {
  const key = masterKey();
  if (!key) throw new Error("Streaming token storage is not configured (EA_TOKEN_ENC_KEY is unset).");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(token), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function openStreamingToken(sealed: SealedStreamingToken): StreamingTokenPair {
  const key = masterKey();
  if (!key) throw new Error("Streaming token storage is not configured (EA_TOKEN_ENC_KEY is unset).");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as StreamingTokenPair;
}

export function isStreamingTokenExpired(token: { expiresAt: number }, skewMs = 60_000): boolean {
  return token.expiresAt <= Date.now() + skewMs;
}
