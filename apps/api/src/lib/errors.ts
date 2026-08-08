import type { FastifyReply } from "fastify";
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
export function sendError(reply:FastifyReply,error:unknown){
  if(error instanceof ApiError){
    if(error.statusCode>=500){ console.error(error.message,error.details??error); return reply.status(error.statusCode).send({error:error.message}); }
    return reply.status(error.statusCode).send({error:error.message,details:error.details??null});
  }
  if(error instanceof ZodError){ console.error("Validation error",error.issues); return reply.status(400).send({error:firstZodIssue(error),details:error.issues}); }
  console.error(error);
  return reply.status(500).send({error:"Internal server error"});
}
