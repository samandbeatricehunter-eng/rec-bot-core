import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { ApiError } from "./errors.js";
export function requireInternalApiKey(request: FastifyRequest) {
  if (!env.REC_INTERNAL_API_KEY) return;
  const header = request.headers["x-rec-api-key"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (provided !== env.REC_INTERNAL_API_KEY) throw new ApiError(401, "Missing or invalid REC internal API key");
}
