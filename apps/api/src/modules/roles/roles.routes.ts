import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError } from "../../lib/errors.js";
import { listRoleMgmtMembers, setMemberRole, syncDiscordMemberRole, updateMemberRole } from "./roles.service.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { resyncTeamNicknamesForGuild } from "../team-ownership/team-ownership.service.js";

const RoleKeySchema = z.enum(["member", "compCommittee", "commissioner"]);

export async function rolesRoutes(app: FastifyInstance) {
  app.post("/v1/roles/discord-sync", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().min(1), roleKey: RoleKeySchema }).parse(request.body);
      return reply.send(await syncDiscordMemberRole(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });
  // Full commissioner only — matches isFullLeagueAdminInteraction's gate on the Discord-
  // native Roles flow exactly (co-commissioner is explicitly excluded there too).
  app.post("/v1/roles/members", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "commissioner" });
      return reply.send(await listRoleMgmtMembers(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/roles/update", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1),
        roleKey: RoleKeySchema,
        action: z.enum(["add", "remove"]),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await updateMemberRole({ ...body, actingDiscordId: auth.mode === "user" ? auth.discordId : "bot" }));
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/v1/roles/resync-nicknames", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "commissioner" });
      return reply.send(await resyncTeamNicknamesForGuild(guildId));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/roles/set", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().min(1), roleKey: RoleKeySchema }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      return reply.send(await setMemberRole({ ...body, actingDiscordId: auth.mode === "user" ? auth.discordId : "bot" }));
    } catch (error) { return sendError(reply, error); }
  });
}
