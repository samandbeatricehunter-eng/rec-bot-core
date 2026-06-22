import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import {
  approveTeamLinkRequest,
  attachTeamLinkRequestMessage,
  completeTeamLinkRequest,
  createTeamLinkRequest,
  getTeamLinkRequest,
  rejectTeamLinkRequest,
} from "./team-requests.service.js";

const CreateRequestSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  teamId: z.string().uuid(),
});

const RequestIdSchema = z.object({
  requestId: z.string().uuid(),
  reviewerDiscordId: z.string().min(1),
});

const CompleteRequestSchema = RequestIdSchema.extend({
  authority: z.enum(["member", "co_commissioner", "commissioner"]),
});

const AttachMessageSchema = z.object({
  requestId: z.string().uuid(),
  channelId: z.string().min(1),
  messageId: z.string().min(1),
});

export async function teamRequestRoutes(app: FastifyInstance) {
  app.post("/v1/team-requests/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await createTeamLinkRequest(CreateRequestSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/v1/team-requests/:requestId", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { requestId } = request.params as { requestId: string };
      return reply.send(await getTeamLinkRequest(requestId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/team-requests/approve", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await approveTeamLinkRequest(RequestIdSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/team-requests/reject", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await rejectTeamLinkRequest(RequestIdSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/team-requests/complete", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await completeTeamLinkRequest(CompleteRequestSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/team-requests/attach-message", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await attachTeamLinkRequestMessage(AttachMessageSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
