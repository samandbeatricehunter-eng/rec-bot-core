import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { ApiError, sendError } from "../../lib/errors.js";
import { getPgPool } from "../../db/client.js";
import { getLeagueHeaderSummary } from "./league-context.service.js";

export async function leagueContextRoutes(app: FastifyInstance) {
  // Web dashboard's header bar — league name/password/season/week/team-count, plus whether
  // the caller is the guild owner (gates the floating Delete League button). Browser-only:
  // the bot has no need for this, and isGuildOwner needs a real discordId.
  app.post("/v1/league-context/header", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      if (auth.mode === "bot") throw new ApiError(400, "Header summary is a browser-only endpoint.");
      return reply.send(await getLeagueHeaderSummary(guildId, auth.discordId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Change a member's league role (member / co_commissioner) from the Manage League
  // division-card dropdown. Commissioner-only; the head commissioner role belongs to the
  // league owner and is not assignable here.
  app.post("/v1/league-memberships/role", async (request, reply) => {
    try {
      const body = z
        .object({
          guildId: z.string().min(1),
          leagueId: z.string().uuid(),
          userId: z.string().uuid(),
          role: z.enum(["member", "co_commissioner"]),
        })
        .parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      const result = await getPgPool().query(
        `update rec_league_memberships set role = $3, updated_at = now()
          where league_id = $1 and user_id = $2 and status = 'active'
          returning user_id`,
        [body.leagueId, body.userId, body.role],
      );
      if (!result.rows[0]) throw new ApiError(404, "That member is not part of this league.");
      return reply.send({ ok: true as const });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
