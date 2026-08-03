import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { evaluateCustomPlayer, generateCustomPlayerName, getCustomPlayerConfig, listCustomPlayerBuilds, reviewCustomPlayer, submitCustomPlayer } from "./custom-players.service.js";

const GameSchema = z.enum(["CFB", "MADDEN"]);
const BuildSchema = z.object({
  guildId: z.string().min(1), packageTier: z.number().int().min(1).max(5), position: z.string().min(1),
  archetypeKey: z.string().min(1), developmentTrait: z.string().min(1),
  attributes: z.record(z.number().int().min(0).max(99)),
});
const IdentitySchema = z.object({
  firstName: z.string().trim().min(1).max(40), lastName: z.string().trim().min(1).max(40),
  jerseyNumber: z.number().int().min(0).max(99), handedness: z.enum(["left", "right"]),
  heightInches: z.number().int().min(60).max(84), weightLbs: z.number().int().min(140).max(400),
  hometownCity: z.string().trim().max(80).optional(), hometownState: z.string().trim().max(40).optional(),
  college: z.string().trim().max(100).optional(),
});

export async function customPlayerRoutes(app: FastifyInstance) {
  app.post("/v1/custom-players/config", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Custom-player purchases are website-only.");
      return reply.send(await getCustomPlayerConfig(guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/custom-players/name", async (request, reply) => {
    try {
      const { guildId, seed } = z.object({ guildId: z.string().min(1), seed: z.string().min(1).max(200) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Name generation is website-only.");
      return reply.send(generateCustomPlayerName(`${auth.discordId}:${seed}`));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/custom-players/evaluate", async (request, reply) => {
    try {
      const body = BuildSchema.extend({ game: GameSchema }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Custom-player evaluation is website-only.");
      return reply.send(evaluateCustomPlayer({ ...body, packageTier: body.packageTier as 1|2|3|4|5, mode: "preview" }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/custom-players/submit", async (request, reply) => {
    try {
      const body = BuildSchema.extend({ idempotencyKey: z.string().uuid(), identity: IdentitySchema, replacementPlayerId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Custom-player purchases are website-only.");
      return reply.send(await submitCustomPlayer({ ...body, discordId: auth.discordId, packageTier: body.packageTier as 1|2|3|4|5 }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/custom-players/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), manage: z.boolean().default(false) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: body.manage ? "co_commissioner" : "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Custom-player records require a website session.");
      return reply.send(await listCustomPlayerBuilds(body.guildId, auth.discordId, body.manage));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/custom-players/review", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), buildId: z.string().uuid(), action: z.enum(["approve", "reject"]), note: z.string().max(1000).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Custom-player review requires a website session.");
      return reply.send(await reviewCustomPlayer({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });
}
