import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { createActiveCheckEvent, getActiveCheckReview, keepActiveCheckUsers, listOpenActiveCheckEvents, markActiveCheckBooted, settleActiveCheckEvent } from "./active-checks.service.js";

export async function activeCheckRoutes(app: FastifyInstance) {
  app.post("/v1/active-checks/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        guildId: z.string().min(1),
        discordChannelId: z.string().min(1),
        discordMessageId: z.string().min(1),
        createdByDiscordId: z.string().min(1),
        closesAt: z.string().min(1),
      }).parse(request.body);
      return reply.send(await createActiveCheckEvent(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/open", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await listOpenActiveCheckEvents());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/settle", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        eventId: z.string().uuid(),
        activeDiscordIds: z.array(z.string()).default([]),
        kickMeDiscordIds: z.array(z.string()).default([]),
      }).parse(request.body);
      return reply.send(await settleActiveCheckEvent(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/review", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { eventId } = z.object({ eventId: z.string().uuid() }).parse(request.body);
      return reply.send(await getActiveCheckReview(eventId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/keep", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        eventId: z.string().uuid(),
        discordIds: z.array(z.string()).default([]),
      }).parse(request.body);
      return reply.send(await keepActiveCheckUsers(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/active-checks/booted", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({
        eventId: z.string().uuid(),
        discordIds: z.array(z.string()).default([]),
      }).parse(request.body);
      return reply.send(await markActiveCheckBooted(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
