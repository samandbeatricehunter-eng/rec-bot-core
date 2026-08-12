import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
export class ApiError extends Error { constructor(public readonly statusCode:number, message:string, public readonly details?:unknown){ super(message); } }
function firstZodIssue(error:ZodError): string {
  const first = error.issues[0];
  const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
  return `${path}${first?.message ?? "Invalid request payload."}`;
}
// 5xx `details` is almost always a raw Supabase/Postgres error object (constraint names,
// column names, occasionally query fragments) — hundreds of call sites do
// `throw new ApiError(500, "...", someDbError)` expecting it to end up in server logs, not
// in the HTTP response. Log it server-side and keep only the message on the wire for 5xx;
// 4xx details (validation/permission/business-logic errors) are intentionally client-facing
// and unchanged.
//
// The optional `request` parameter (3rd arg) lets sendError extract guildId/leagueId from
// the request body so the incident is attributed to the right league. Existing call sites
// that pass only (reply, error) are unaffected — the incident just has no league context.
export function sendError(reply:FastifyReply,error:unknown,request?:FastifyRequest){
  if(error instanceof ApiError){
    if(error.statusCode>=500){
      console.error(error.message,error.details??error);
      captureIncident(error, request);
      return reply.status(error.statusCode).send({error:error.message});
    }
    return reply.status(error.statusCode).send({error:error.message,details:error.details??null});
  }
  if(error instanceof ZodError){ console.error("Validation error",error.issues); return reply.status(400).send({error:firstZodIssue(error),details:error.issues}); }
  console.error(error);
  captureIncident(error, request);
  return reply.status(500).send({error:"Something went wrong on our end. Please try again, and if it keeps happening, let your league commissioner know."});
}

// Dynamic import to avoid a circular dependency: errors.ts is imported by incident.service.ts.
async function captureIncident(error: unknown, request?: FastifyRequest) {
  try {
    const { recordIncident } = await import("../modules/admin/incident.service.js");
    const body = (request?.body ?? {}) as Record<string, unknown>;
    const guildId = typeof body.guildId === "string" ? body.guildId : null;
    const leagueId = typeof body.leagueId === "string" ? body.leagueId : null;
    const route = request?.routeOptions?.url ?? request?.url ?? "unknown";
    const errorName = error instanceof Error ? error.name : "NonErrorThrown";
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack ?? null : null;
    const title = error instanceof ApiError ? error.message : errorMessage;
    await recordIncident({
      leagueId,
      guildId,
      process: `api:${route}`,
      severity: "high",
      title: title.slice(0, 200),
      detail: `${errorName}: ${errorMessage}${errorStack ? `\n${errorStack}` : ""}`,
      errorName,
      errorMessage,
      errorStack,
      context: { route, method: request?.method ?? "POST" },
    });
  } catch (captureError) {
    // Never let incident capture break the error response.
    console.error("[ERROR] Failed to capture admin incident:", captureError);
  }
}
