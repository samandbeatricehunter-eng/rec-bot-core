import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import {
  castHallVote,
  chooseImmortalityTeam,
  convertXp,
  evaluateCreationBuild,
  getImmortalityHub,
  getOrGenerateTeamOffers,
  installImmortalityCustomTeams,
  markImmortalityIntroVideoWatched,
  publicCharacteristicCatalog,
  selectCharacteristics,
  setImmortalityIntroVideo,
  startIqAttempt,
  submitIqAnswer,
  submitOwnerPersona,
  submitPersona,
  submitPlaystyle,
  spendPlayerXp,
  transitionImmortalityState,
  upsertOwnerIdentity,
  upsertProspectIdentity,
  selectImmortalityAbility,
  removeImmortalityAbility,
} from "./immortality.service.js";
import { IMMORTALITY_STATES, IQ_QUESTION_COUNT } from "@rec/shared";

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
          hometown: z.string().trim().max(80).optional(),
          hometownState: z.string().trim().max(40).optional(),
          college: z.string().trim().max(80).optional().nullable(),
          jerseyNumber: z.number().int().min(0).max(99),
          heightInches: z.number().int().min(60).max(90),
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
        questionNumber: z.number().int().min(1).max(IQ_QUESTION_COUNT),
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

  app.post("/v1/immortality/xp/spend", async (request, reply) => {
    try {
      const body = SideBody.extend({ attributeCode: z.string().trim().min(3).max(3) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Player XP upgrades are website-only.");
      return reply.send(await spendPlayerXp({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/abilities/select", async (request, reply) => {
    try {
      const body = SideBody.extend({ abilityId: z.string().trim().min(1).max(20) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Ability selection is website-only.");
      return reply.send(await selectImmortalityAbility({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/abilities/remove", async (request, reply) => {
    try {
      const body = SideBody.extend({ abilityId: z.string().trim().min(1).max(20) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Ability selection is website-only.");
      return reply.send(await removeImmortalityAbility({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/intro-video/set", async (request, reply) => {
    try {
      const body = GuildBody.extend({ url: z.string().trim().url().nullable() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Setting the intro video requires a website session.");
      return reply.send(await setImmortalityIntroVideo({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/intro-video/watched", async (request, reply) => {
    try {
      const body = GuildBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await markImmortalityIntroVideoWatched({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/owner/identity", async (request, reply) => {
    try {
      const body = GuildBody.extend({
        identity: z.object({
          firstName: z.string().trim().min(1).max(40),
          lastName: z.string().trim().min(1).max(40),
          headshotUrl: z.string().trim().url().optional().nullable(),
        }),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Origins is website-only.");
      return reply.send(await upsertOwnerIdentity({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/owner/persona", async (request, reply) => {
    try {
      const body = GuildBody.extend({
        answers: z.array(z.object({ questionNumber: z.number().int(), optionIndex: z.number().int().min(0).max(3) })).min(1).max(5),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Interviews are website-only.");
      return reply.send(await submitOwnerPersona({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/team-offers", async (request, reply) => {
    try {
      const body = GuildBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Franchise offers are website-only.");
      return reply.send(await getOrGenerateTeamOffers({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/team-offers/choose", async (request, reply) => {
    try {
      const body = GuildBody.extend({ teamId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Choosing a franchise is website-only.");
      return reply.send(await chooseImmortalityTeam({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/teams/custom", async (request, reply) => {
    try {
      const body = GuildBody.extend({
        slots: z.array(z.object({
          replacesAbbreviation: z.string().trim().min(2).max(5),
          city: z.string().trim().min(1).max(40),
          nick: z.string().trim().min(1).max(40),
          abbreviation: z.string().trim().min(2).max(5),
          primaryLogoUrl: z.string().trim().url().optional().nullable(),
          secondaryLogoUrl: z.string().trim().url().optional().nullable(),
          wordmarkUrl: z.string().trim().url().optional().nullable(),
          primaryColor: z.string().trim().regex(/^#[0-9a-f]{6}$/i).optional().nullable(),
          secondaryColor: z.string().trim().regex(/^#[0-9a-f]{6}$/i).optional().nullable(),
          tertiaryColor: z.string().trim().regex(/^#[0-9a-f]{6}$/i).optional().nullable(),
        })).min(1).max(32),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Custom team install requires a website session.");
      return reply.send(await installImmortalityCustomTeams({ guildId: body.guildId, discordId: auth.discordId, slots: body.slots }));
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
