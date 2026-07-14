import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { getGuideMessages, getWeeklyPanel, saveGuideMessages, saveWeeklyPanel } from "./submission-state.service.js";

export async function submissionStateRoutes(app: FastifyInstance) {
  app.post("/v1/submission-state/guide/get", async (request, reply) => { try { requireInternalApiKey(request); const b=z.object({guildId:z.string()}).parse(request.body); return reply.send(await getGuideMessages(b.guildId)); } catch(e){ return sendError(reply,e); } });
  app.post("/v1/submission-state/guide/save", async (request, reply) => { try { requireInternalApiKey(request); const b=z.object({guildId:z.string(),channelId:z.string(),messageIds:z.array(z.string())}).parse(request.body); return reply.send(await saveGuideMessages(b.guildId,b.channelId,b.messageIds)); } catch(e){ return sendError(reply,e); } });
  const Panel=z.object({guildId:z.string(),seasonNumber:z.number().int(),seasonStage:z.string(),weekNumber:z.number().int().nullable()});
  app.post("/v1/submission-state/panel/get", async (request, reply) => { try { requireInternalApiKey(request); const b=Panel.parse(request.body); return reply.send(await getWeeklyPanel(b.guildId,b.seasonNumber,b.seasonStage,b.weekNumber)); } catch(e){ return sendError(reply,e); } });
  app.post("/v1/submission-state/panel/save", async (request, reply) => { try { requireInternalApiKey(request); const b=Panel.extend({channelId:z.string(),messageId:z.string()}).parse(request.body); return reply.send(await saveWeeklyPanel(b)); } catch(e){ return sendError(reply,e); } });
}
