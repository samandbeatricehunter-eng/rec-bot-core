import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { createPurchaseRequest, getUserPurchaseCounts, listPendingPurchases, reviewPurchase } from "./purchases.service.js";

const PurchaseTypeSchema = z.enum([
  "age_reset",
  "dev_upgrade",
  "contract",
  "player_trait",
  "attribute",
  "legend",
  "custom_player",
]);

const CreatePurchaseSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  purchaseType: PurchaseTypeSchema,
  details: z.record(z.any()).default({}),
});

const ReviewPurchaseSchema = z.object({
  // Optional because the bot's existing calls don't send it (bot-mode auth never checks
  // it — see resolveGuildId below); the web dashboard always sends it.
  guildId: z.string().min(1).optional(),
  purchaseId: z.string().uuid(),
  action: z.enum(["approve", "deny"]),
  reviewedByDiscordId: z.string().min(1),
  deniedReason: z.string().optional().nullable(),
});

export async function purchaseRoutes(app: FastifyInstance) {
  app.post("/v1/purchases/create", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await createPurchaseRequest(CreatePurchaseSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/purchases/review", async (request, reply) => {
    try {
      const body = ReviewPurchaseSchema.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") body.reviewedByDiscordId = auth.discordId;
      return reply.send(await reviewPurchase(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/purchases/pending", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await listPendingPurchases(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/purchases/counts", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { discordId, guildId } = z.object({ discordId: z.string().min(1), guildId: z.string().min(1) }).parse(request.body);
      return reply.send(await getUserPurchaseCounts(discordId, guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
