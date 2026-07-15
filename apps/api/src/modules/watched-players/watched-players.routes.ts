import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import { sendError } from "../../lib/errors.js";
import { CLASS_YEARS, createWatchedPlayer, listMyWatchedPlayers, listPlayerStatSubmissions, listWatchedPlayers, removeMyPlayerStatLine, removePlayerStatSubmission, removeWatchedPlayer, submitPlayerStatLine, updatePlayerStatSubmission, updateWatchedPlayer } from "./watched-players.service.js";

const ClassYearSchema = z.enum(CLASS_YEARS).optional().nullable();

export async function watchedPlayersRoutes(app: FastifyInstance) {
  app.post("/v1/watched-players/list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), teamId: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await listWatchedPlayers(body.guildId, body.teamId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/watched-players/create", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), teamId: z.string().uuid(), playerName: z.string().trim().min(1).max(80), position: z.string().trim().min(1).max(20), classYear: ClassYearSchema }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await createWatchedPlayer(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/watched-players/update", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), id: z.string().uuid(), playerName: z.string().trim().min(1).max(80), position: z.string().trim().min(1).max(20), classYear: ClassYearSchema }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await updateWatchedPlayer(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/watched-players/remove", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), id: z.string().uuid() }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await removeWatchedPlayer(body));
    } catch (error) { return sendError(reply, error); }
  });

  // Bot-only, self-serve: the Discord "Player Stats" button submits directly on behalf of
  // whichever coach clicked it — eligibility (linked team, scheduled game, existing box
  // score) is resolved server-side from discordId, same trust model as box-score/append-image.
  app.post("/v1/watched-players/submit-stat-line", async (request, reply) => {
    try {
      const body = z.object({
        guildId: z.string().min(1),
        discordId: z.string().min(1).optional(),
        playerName: z.string().trim().min(1).max(80),
        category: z.string().trim().min(1).max(40),
        statLines: z.array(z.object({ statKey: z.string(), label: z.string(), value: z.number() })).min(1).max(10),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const discordId = auth.mode === "user" ? auth.discordId : body.discordId;
      if (!discordId) throw new Error("Missing Discord user.");
      return reply.send(await submitPlayerStatLine({ ...body, discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/watched-players/my-list", async (request, reply) => {
    try {
      const body = z.object({ guildId: z.string().min(1), discordId: z.string().min(1).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId });
      const discordId = auth.mode === "user" ? auth.discordId : body.discordId;
      if (!discordId) throw new Error("Missing Discord user.");
      return reply.send(await listMyWatchedPlayers(body.guildId, discordId));
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/v1/watched-players/remove-stat-line",async(request,reply)=>{try{requireInternalApiKey(request);const b=z.object({guildId:z.string(),discordId:z.string(),playerName:z.string(),category:z.string()}).parse(request.body);return reply.send(await removeMyPlayerStatLine(b));}catch(e){return sendError(reply,e);}});
  app.post("/v1/player-stats/submissions/list", async(request,reply)=>{try{const b=z.object({guildId:z.string()}).parse(request.body);await requireBotOrUserSession(request,{resolveGuildId:()=>b.guildId,permission:"co_commissioner"});return reply.send(await listPlayerStatSubmissions(b.guildId));}catch(e){return sendError(reply,e);}});
  app.post("/v1/player-stats/submissions/update", async(request,reply)=>{try{const b=z.object({guildId:z.string(),id:z.string().uuid(),playerName:z.string().min(2).max(80).optional(),status:z.enum(["submitted","approved","rejected"]).optional(),lines:z.array(z.object({category:z.string(),stats:z.record(z.number().nonnegative())})).optional()}).parse(request.body);const actor=await requireBotOrUserSession(request,{resolveGuildId:()=>b.guildId,permission:"co_commissioner"});return reply.send(await updatePlayerStatSubmission({...b,actorDiscordId:actor.mode==="user"?actor.discordId:"bot"}));}catch(e){return sendError(reply,e);}});
  app.post("/v1/player-stats/submissions/remove", async(request,reply)=>{try{const b=z.object({guildId:z.string(),id:z.string().uuid()}).parse(request.body);const actor=await requireBotOrUserSession(request,{resolveGuildId:()=>b.guildId,permission:"co_commissioner"});return reply.send(await removePlayerStatSubmission({...b,actorDiscordId:actor.mode==="user"?actor.discordId:"bot"}));}catch(e){return sendError(reply,e);}});
}
