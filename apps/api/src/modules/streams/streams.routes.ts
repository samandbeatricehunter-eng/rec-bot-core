import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { recordStreamPost, reviewStreamPayout } from "./streams.service.js";

const RecordStreamPostSchema = z.object({
  guildId: z.string().min(1),
  discordId: z.string().min(1),
  discordChannelId: z.string().min(1),
  discordMessageId: z.string().min(1),
  messageUrl: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  service: z.string().optional().nullable(),
  submissionType: z.enum(["link", "discord_live"]).optional().nullable()
});

const ReviewStreamPayoutSchema = z.object({
  // Optional because the bot's existing calls don't send it (bot-mode auth never checks
  // it — see resolveGuildId below); the web dashboard always sends it.
  guildId: z.string().min(1).optional(),
  reviewId: z.string().uuid(),
  action: z.enum(["approve", "deny"]),
  reviewedByDiscordId: z.string().min(1),
  deniedReason: z.string().optional().nullable()
});

export async function streamRoutes(app: FastifyInstance) {
  app.post("/v1/streams/post", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await recordStreamPost(RecordStreamPostSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/streams/review", async (request, reply) => {
    try {
      const body = ReviewStreamPayoutSchema.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId ?? "", permission: "co_commissioner" });
      if (auth.mode === "user") body.reviewedByDiscordId = auth.discordId;
      return reply.send(await reviewStreamPayout(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
