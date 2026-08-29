import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { advanceAnnualDraftPick, endAnnualDraft, getAnnualDraftState, setAnnualDraftTimer, skipAnnualDraftTo, startAnnualDraft } from "./annual-draft.service.js";

export async function annualDraftRoutes(app: FastifyInstance) {
  app.post("/v1/annual-draft/state", async (request, reply) => { try {
    const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
    const auth = await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
    if (auth.mode !== "user") throw new Error("Annual draft state requires a website session.");
    let isCommissioner = false;
    try { await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" }); isCommissioner = true; } catch { /* member view */ }
    return reply.send(await getAnnualDraftState(guildId, auth.discordId, isCommissioner));
  } catch (error) { return sendError(reply, error); } });

  app.post("/v1/annual-draft/start", async (request, reply) => { try {
    const body = z.object({ guildId: z.string().min(1), seasonNumber: z.number().int().positive(), pickTimerSeconds: z.number().int().positive().nullable() }).parse(request.body);
    const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
    if (auth.mode !== "user") throw new Error("Starting an annual draft requires a website session.");
    return reply.send(await startAnnualDraft(body.guildId, auth.discordId, body.seasonNumber, body.pickTimerSeconds));
  } catch (error) { return sendError(reply, error); } });

  app.post("/v1/annual-draft/end", async (request, reply) => { try {
    const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
    await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
    return reply.send(await endAnnualDraft(guildId));
  } catch (error) { return sendError(reply, error); } });

  app.post("/v1/annual-draft/set-timer", async (request, reply) => { try {
    const body = z.object({ guildId: z.string().min(1), pickTimerSeconds: z.number().int().positive().nullable() }).parse(request.body);
    await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
    return reply.send(await setAnnualDraftTimer(body.guildId, body.pickTimerSeconds));
  } catch (error) { return sendError(reply, error); } });

  app.post("/v1/annual-draft/advance", async (request, reply) => { try {
    const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
    await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
    return reply.send(await advanceAnnualDraftPick(guildId));
  } catch (error) { return sendError(reply, error); } });

  app.post("/v1/annual-draft/skip-to-specific", async (request, reply) => { try {
    const body = z.object({ guildId: z.string().min(1), round: z.number().int().positive(), pickInRound: z.number().int().positive() }).parse(request.body);
    await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
    return reply.send(await skipAnnualDraftTo(body.guildId, body.round, body.pickInRound));
  } catch (error) { return sendError(reply, error); } });
}
