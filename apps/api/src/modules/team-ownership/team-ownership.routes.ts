import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { CreateDefaultTeamsSchema, CustomTeamReplacementSchema, LinkUserToTeamSchema, UnlinkAllTeamsSchema, UnlinkTeamSchema } from "./team-ownership.schemas.js";
import { createCustomTeamReplacement, createDefaultTeamsForGuild, linkUserToTeam, listLinkedUsersTeams, listOpenTeams, unlinkAllTeamsForGuild, unlinkTeamForGuild } from "./team-ownership.service.js";
export async function teamOwnershipRoutes(app: FastifyInstance) {
 app.post("/v1/team-ownership/default-teams", async (request, reply) => { try { requireInternalApiKey(request); return reply.send(await createDefaultTeamsForGuild(CreateDefaultTeamsSchema.parse(request.body))); } catch (error) { return sendError(reply, error); } });
 app.post("/v1/team-ownership/custom-team-replacement", async (request, reply) => { try { requireInternalApiKey(request); return reply.send(await createCustomTeamReplacement(CustomTeamReplacementSchema.parse(request.body))); } catch (error) { return sendError(reply, error); } });
 app.post("/v1/team-ownership/link-user-team", async (request, reply) => { try { requireInternalApiKey(request); return reply.send(await linkUserToTeam(LinkUserToTeamSchema.parse(request.body))); } catch (error) { return sendError(reply, error); } });
 app.get("/v1/team-ownership/:guildId/linked", async (request, reply) => { try { requireInternalApiKey(request); const { guildId } = request.params as { guildId: string }; return reply.send(await listLinkedUsersTeams(guildId)); } catch (error) { return sendError(reply, error); } });
 app.get("/v1/team-ownership/:guildId/open-teams", async (request, reply) => { try { requireInternalApiKey(request); const { guildId } = request.params as { guildId: string }; return reply.send(await listOpenTeams(guildId)); } catch (error) { return sendError(reply, error); } });
 app.post("/v1/team-ownership/unlink-all", async (request, reply) => { try { requireInternalApiKey(request); return reply.send(await unlinkAllTeamsForGuild(UnlinkAllTeamsSchema.parse(request.body))); } catch (error) { return sendError(reply, error); } });
 app.post("/v1/team-ownership/unlink-team", async (request, reply) => { try { requireInternalApiKey(request); return reply.send(await unlinkTeamForGuild(UnlinkTeamSchema.parse(request.body))); } catch (error) { return sendError(reply, error); } });
}
