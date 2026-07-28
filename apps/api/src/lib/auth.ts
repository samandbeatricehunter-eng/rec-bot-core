import type { FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { ApiError } from "./errors.js";

export function hasValidInternalApiKey(request: FastifyRequest): boolean {
  if (!env.REC_INTERNAL_API_KEY) return false;
  const header = request.headers["x-rec-api-key"];
  const provided = Array.isArray(header) ? header[0] : header;
  const expectedBytes = Buffer.from(env.REC_INTERNAL_API_KEY);
  const providedBytes = Buffer.from(provided ?? "");
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

export function requireInternalApiKey(request: FastifyRequest) {
  // Fail CLOSED, not open: every route guarded only by this check (wallet transfers, team
  // ownership resets, wager admin actions) would otherwise be fully unauthenticated the
  // moment REC_INTERNAL_API_KEY is missing from the deployment env, which is an easy
  // operational mistake to make since it's typed optional in config/env.ts.
  if (!env.REC_INTERNAL_API_KEY) throw new ApiError(500, "REC_INTERNAL_API_KEY is not configured.");
  if (!hasValidInternalApiKey(request)) {
    throw new ApiError(401, "Missing or invalid REC internal API key");
  }
}
