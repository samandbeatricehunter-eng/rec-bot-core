import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import {
  castHallVote,
  convertXp,
  evaluateCreationBuild,
  getImmortalityHub,
  publicCharacteristicCatalog,
  selectCharacteristics,
  solveRookieDraft,
  startIqAttempt,
  submitIqAnswer,
  submitPersona,
  submitPlaystyle,
  transitionImmortalityState,
  upsertProspectIdentity,
} from "./immortality.service.js";
import { IMMORTALITY_STATES } from "@rec/shared";

const GuildBody = z.object({ guildId: z.string().min(1) });
const SideBody = GuildBody.extend({ side: z.enum(["offense", "defense"]) });

export async function immortalityRoutes(app: FastifyInstance) {
  app.post("/v1/immortality/hub", async (request, reply) => {
    try {
      const body = GuildBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Rise to Immortality is website-only.");
      return reply.send(await getImmortalityHub(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/catalog", async (_request, reply) => {
    return reply.send({ characteristics: publicCharacteristicCatalog() });
  });

  app.post("/v1/immortality/prospect/identity", async (request, reply) => {
    try {
      const body = SideBody.extend({
        identity: z.object({
          firstName: z.string().trim().min(1).max(40),
          lastName: z.string().trim().min(1).max(40),
          age: z.number().int().min(18).max(22),
          hometown: z.string().trim().max(80).optional(),
          hometownState: z.string().trim().max(40).optional(),
          college: z.string().trim().max(80).optional().nullable(),
          jerseyNumber: z.number().int().min(0).max(99),
          heightInches: z.number().int().min(60).max(84),
          weightLbs: z.number().int().min(140).max(400),
          bodyType: z.string().trim().max(40).optional(),
        }),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Origins is website-only.");
      return reply.send(await upsertProspectIdentity({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/iq/start", async (request, reply) => {
    try {
      const body = SideBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "IQ tests are website-only.");
      return reply.send(await startIqAttempt({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/iq/answer", async (request, reply) => {
    try {
      const body = SideBody.extend({
        questionNumber: z.number().int().min(1).max(12),
        selectedPresentedIndex: z.number().int().min(0).max(3).nullable(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "IQ tests are website-only.");
      return reply.send(await submitIqAnswer({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/interview/persona", async (request, reply) => {
    try {
      const body = SideBody.extend({
        answers: z.array(z.object({ questionNumber: z.number().int(), optionIndex: z.number().int().min(0).max(3) })).min(1).max(5),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Interviews are website-only.");
      return reply.send(await submitPersona({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/interview/playstyle", async (request, reply) => {
    try {
      const body = SideBody.extend({
        answers: z.array(z.object({ questionNumber: z.number().int(), optionIndex: z.number().int().min(0).max(3) })).min(1).max(5),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Interviews are website-only.");
      return reply.send(await submitPlaystyle({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/characteristics", async (request, reply) => {
    try {
      const body = SideBody.extend({ keys: z.array(z.string().min(1)).max(6) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Characteristic selection is website-only.");
      return reply.send(await selectCharacteristics({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/creation/evaluate", async (request, reply) => {
    try {
      const body = SideBody.extend({ spent: z.record(z.number().int().min(0).max(99)) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Creation Point evaluation is website-only.");
      return reply.send(await evaluateCreationBuild({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/xp/convert", async (request, reply) => {
    try {
      const body = SideBody.extend({ playerXp: z.number().int().min(4) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Team XP conversion is website-only.");
      return reply.send(await convertXp({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/draft/solve", async (request, reply) => {
    try {
      const body = GuildBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Draft solving requires a website session.");
      return reply.send(await solveRookieDraft(body.guildId, auth.discordId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/hall/vote", async (request, reply) => {
    try {
      const body = SideBody.extend({ nomineeProspectId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Hall voting is website-only.");
      return reply.send(await castHallVote({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/state", async (request, reply) => {
    try {
      const body = GuildBody.extend({ toState: z.enum(IMMORTALITY_STATES) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "State changes require a website session.");
      return reply.send(await transitionImmortalityState({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });
}
