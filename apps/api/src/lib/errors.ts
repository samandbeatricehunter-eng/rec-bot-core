import type { FastifyReply } from "fastify";
export class ApiError extends Error { constructor(public readonly statusCode:number, message:string, public readonly details?:unknown){ super(message); } }
export function sendError(reply:FastifyReply,error:unknown){ if(error instanceof ApiError) return reply.status(error.statusCode).send({error:error.message,details:error.details??null}); console.error(error); return reply.status(500).send({error:"Internal server error"}); }
