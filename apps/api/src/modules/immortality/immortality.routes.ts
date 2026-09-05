import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, sendError } from "../../lib/errors.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { requireInternalApiKey } from "../../lib/auth.js";
import {
  backfillMissingImmortalityProspectReviews,
  castHallVote,
  chooseImmortalityTeam,
  convertXp,
  evaluateCreationBuild,
  getCreationBaseline,
  getImmortalityHub,
  installImmortalityCustomTeams,
  getImmortalityRivalHistory,
  getImmortalityRivals,
  getWeeklyMatchupInterview,
  submitWeeklyMatchupInterview,
  getOwnerWeeklyInterview,
  submitOwnerWeeklyInterview,
  getStageInterview,
  submitStageInterview,
  markImmortalityIntroVideoWatched,
  publicCharacteristicCatalog,
  selectCharacteristics,
  setImmortalityIntroVideo,
  setImmortalityRival,
  startIqAttempt,
  submitIqAnswer,
  submitBranchingPlaystyle,
  submitOwnerPersona,
  submitPersona,
  submitPersonaDna,
  submitPlayerTraits,
  submitPlaystyle,
  submitImmortalityUpgrades,
  resolveImmortalityUpgradeBatch,
  transitionImmortalityState,
  uploadOwnerHeadshot,
  uploadProspectHeadshot,
  upsertOwnerIdentity,
  upsertProspectIdentity,
  selectImmortalityAbility,
  removeImmortalityAbility,
  reissueImmortalityProspectArtifacts,
  reopenImmortalityOriginsIfPrematurelyAdvanced,
  reviewImmortalityProspect,
  reviewImmortalityXpRequest,
  submitThrowingMotion,
  grantImmortalityCommissionerBonus,
} from "./immortality.service.js";
import { signImmortalityContract } from "./contracts.service.js";
import { postManualImmortalityTweet, listPlayerTwitterPersonas, postPlayerTwitterTweet } from "./tweet-generation.service.js";
import {
  getProgressionState,
  purchaseProgressionPerk,
  resolveProgressionPerk,
  purchaseDevPromotion,
  resolveDevPromotion,
} from "./progression.service.js";
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
          headshotUrl: z.string().url().max(500).optional().nullable(),
        }),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Origins is website-only.");
      return reply.send(await upsertProspectIdentity({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/prospect/headshot/upload", async (request, reply) => {
    try {
      const body = SideBody.extend({ contentType: z.string().min(1), imageBase64: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Headshot upload is website-only.");
      const imageBuffer = Buffer.from(body.imageBase64, "base64");
      return reply.send(await uploadProspectHeadshot({ guildId: body.guildId, discordId: auth.discordId, side: body.side, contentType: body.contentType, imageBuffer }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/throwing-motion/set", async (request, reply) => {
    try {
      const body = SideBody.extend({ motionKey: z.string().trim().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Throwing motion selection is website-only.");
      return reply.send(await submitThrowingMotion({ ...body, discordId: auth.discordId }));
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

  app.post("/v1/immortality/interview/playstyle-branching", async (request, reply) => {
    try {
      const body = SideBody.extend({
        answers: z.object({
          q1ArchetypeIndex: z.number().int().min(0),
          q2ArchetypeIndex: z.number().int().min(0).nullable(),
          q3OptionIndex: z.number().int().min(0),
          q4OptionIndex: z.number().int().min(0),
          q5OptionIndex: z.number().int().min(0),
        }),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Interviews are website-only.");
      return reply.send(await submitBranchingPlaystyle({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/interview/persona-dna", async (request, reply) => {
    try {
      const body = SideBody.extend({
        answers: z.array(z.object({ questionNumber: z.number().int(), optionIndex: z.number().int().min(0).max(5) })).min(1).max(10),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Interviews are website-only.");
      return reply.send(await submitPersonaDna({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/interview/player-traits", async (request, reply) => {
    try {
      const body = SideBody.extend({
        answers: z.array(z.object({ questionNumber: z.number().int(), optionIndex: z.number().int().min(0).max(5) })).min(1).max(8),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Interviews are website-only.");
      return reply.send(await submitPlayerTraits({ ...body, discordId: auth.discordId }));
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

  app.post("/v1/immortality/creation/baseline", async (request, reply) => {
    try {
      const body = SideBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Creation Point preview is website-only.");
      return reply.send(await getCreationBaseline({ ...body, discordId: auth.discordId }));
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

  app.post("/v1/immortality/upgrades/submit", async (request, reply) => {
    try {
      const body = SideBody.extend({ targets: z.record(z.string(), z.number().int()) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Upgrades are website-only.");
      return reply.send(await submitImmortalityUpgrades({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/upgrades/resolve", async (request, reply) => {
    try {
      const body = GuildBody.extend({ requestId: z.string().uuid(), action: z.enum(["applied", "refunded"]), note: z.string().max(1000).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Resolving upgrade batches requires a website session.");
      return reply.send(await resolveImmortalityUpgradeBatch({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/progression", async (request, reply) => {
    try {
      const body = SideBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "The Progression Tree is website-only.");
      return reply.send(await getProgressionState({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/progression/purchase", async (request, reply) => {
    try {
      const body = SideBody.extend({ key: z.string().trim().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Progression Tree purchases are website-only.");
      return reply.send(await purchaseProgressionPerk({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/progression/resolve", async (request, reply) => {
    try {
      const body = GuildBody.extend({ requestId: z.string().uuid(), action: z.enum(["applied", "refunded"]), note: z.string().max(1000).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Resolving Progression Tree purchases requires a website session.");
      return reply.send(await resolveProgressionPerk({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/progression/dev-promotion", async (request, reply) => {
    try {
      const body = SideBody.extend({ teammatePlayerId: z.string().uuid().optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Dev-trait promotions are website-only.");
      return reply.send(await purchaseDevPromotion({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/progression/dev-promotion/resolve", async (request, reply) => {
    try {
      const body = GuildBody.extend({ requestId: z.string().uuid(), action: z.enum(["applied", "refunded"]), note: z.string().max(1000).optional() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Resolving promotions requires a website session.");
      return reply.send(await resolveDevPromotion({ ...body, reviewerDiscordId: auth.discordId }));
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

  app.post("/v1/immortality/prospect/review", async (request, reply) => {
    try {
      const body = GuildBody.extend({
        prospectId: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
        note: z.string().max(1000).optional(),
        firstName: z.string().trim().min(1).max(50).optional(),
        lastName: z.string().trim().min(1).max(50).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "Prospect review requires a website session.");
      return reply.send(await reviewImmortalityProspect({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  // Bot-only emergency repair -- see reopenImmortalityOriginsIfPrematurelyAdvanced's doc comment.
  app.post("/v1/immortality/reopen-origins-if-premature", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = GuildBody.parse(request.body);
      return reply.send(await reopenImmortalityOriginsIfPrematurelyAdvanced(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  // Bot-only maintenance action -- see reissueImmortalityProspectArtifacts's doc comment.
  app.post("/v1/immortality/prospect/cards/reissue", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = GuildBody.extend({
        prospectId: z.string().uuid(),
        repostCard: z.boolean().default(false),
      }).parse(request.body);
      return reply.send(await reissueImmortalityProspectArtifacts(body));
    } catch (error) { return sendError(reply, error); }
  });

  // Bot-only maintenance poll (see backfillMissingImmortalityProspectReviews) -- guarantees a
  // prospect's commissioner review-log row eventually exists even if the real-time write inside
  // evaluateCreationBuild failed. No user session needed; cheap no-op for non-RTI guilds.
  app.post("/v1/immortality/prospect/backfill-reviews", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const body = GuildBody.parse(request.body);
      return reply.send(await backfillMissingImmortalityProspectReviews(body.guildId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/xp/review", async (request, reply) => {
    try {
      const body = GuildBody.extend({
        requestId: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
        note: z.string().max(1000).optional(),
      }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      if (auth.mode !== "user") throw new ApiError(400, "XP purchase review requires a website session.");
      return reply.send(await reviewImmortalityXpRequest({ ...body, reviewerDiscordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  // Bot-only: the /tweets slash command already gates on commissioner/co-commissioner Discord
  // roles before calling this -- see requireBotOrUserSession's "bot" mode, which skips the
  // permission assertion entirely and trusts the caller (same trust model as the Commish Tools
  // actions in scheduling.routes.ts).
  app.post("/v1/immortality/tweets/manual", async (request, reply) => {
    try {
      const body = GuildBody.extend({
        persona: z.string().min(1),
        customHandle: z.string().trim().max(50).optional(),
        customDisplayName: z.string().trim().max(50).optional(),
        tweetText: z.string().trim().min(1).max(1000),
        imageUrl: z.string().trim().url().max(2000).optional(),
        mentionContent: z.string().trim().max(200).optional(),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      await postManualImmortalityTweet(body);
      return reply.send({ posted: true });
    } catch (error) { return sendError(reply, error); }
  });

  // Bot-only: /twitter is a member command. The bot passes the caller's discordId; we re-resolve
  // their own owner/offense/defense personas server-side so a typed value can't post as someone else.
  app.post("/v1/immortality/tweets/personas", async (request, reply) => {
    try {
      const body = GuildBody.extend({ discordId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await listPlayerTwitterPersonas(body));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/tweets/player", async (request, reply) => {
    try {
      const body = GuildBody.extend({
        discordId: z.string().min(1),
        persona: z.enum(["owner", "offense", "defense"]),
        tweetText: z.string().trim().min(1).max(1000),
        imageUrl: z.string().trim().url().max(2000).optional(),
        mentionContent: z.string().trim().max(200).optional(),
      }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      return reply.send(await postPlayerTwitterTweet(body));
    } catch (error) { return sendError(reply, error); }
  });

  // Bot-only: Commish Tools' "Grant Bonus" button already gates on commissioner/co-commissioner
  // Discord roles before calling this -- same trust model as /v1/immortality/tweets/manual above.
  app.post("/v1/immortality/commissioner-bonus/grant", async (request, reply) => {
    try {
      const body = GuildBody.extend({ targetDiscordId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      return reply.send(await grantImmortalityCommissionerBonus(body));
    } catch (error) { return sendError(reply, error); }
  });

  const RivalSlot = z.union([z.literal(1), z.literal(2)]);

  app.post("/v1/immortality/rivals/set", async (request, reply) => {
    try {
      const body = SideBody.extend({ rivalTeamId: z.string().uuid(), slot: RivalSlot }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await setImmortalityRival({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/rivals", async (request, reply) => {
    try {
      const body = GuildBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await getImmortalityRivals({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/rivals/history", async (request, reply) => {
    try {
      const body = SideBody.extend({ slot: RivalSlot }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await getImmortalityRivalHistory({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/interview/weekly", async (request, reply) => {
    try {
      const body = SideBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await getWeeklyMatchupInterview({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/interview/weekly/submit", async (request, reply) => {
    try {
      const body = SideBody.extend({ questionId: z.number().int(), optionIndex: z.number().int().min(0) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await submitWeeklyMatchupInterview({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  // Preseason/training camp and every offseason stage (draft, free agency, transfer portal,
  // etc.) -- Media Day's weekly matchup flow above assumes a real scheduled game and doesn't
  // apply here. See getStageInterview/submitStageInterview's doc comments.
  app.post("/v1/immortality/interview/stage", async (request, reply) => {
    try {
      const body = SideBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await getStageInterview({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/interview/stage/submit", async (request, reply) => {
    try {
      const body = SideBody.extend({ questionId: z.number().int(), optionIndex: z.number().int().min(0) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await submitStageInterview({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  // Owner-side Media Day counterpart -- owners aren't tied to a specific weekly matchup, so one
  // endpoint pair covers every league stage (getOwnerWeeklyInterview picks the stage-appropriate
  // question bucket internally; no separate "stage" vs "weekly" split the way prospects have).
  app.post("/v1/immortality/owner/interview", async (request, reply) => {
    try {
      const body = GuildBody.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await getOwnerWeeklyInterview({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/owner/interview/submit", async (request, reply) => {
    try {
      const body = GuildBody.extend({ questionId: z.number().int(), optionIndex: z.number().int().min(0) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "This is website-only.");
      return reply.send(await submitOwnerWeeklyInterview({ ...body, discordId: auth.discordId }));
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

  app.post("/v1/immortality/owner/headshot/upload", async (request, reply) => {
    try {
      const body = GuildBody.extend({ contentType: z.string().min(1), imageBase64: z.string().min(1) }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Headshot upload is website-only.");
      const imageBuffer = Buffer.from(body.imageBase64, "base64");
      return reply.send(await uploadOwnerHeadshot({ guildId: body.guildId, discordId: auth.discordId, contentType: body.contentType, imageBuffer }));
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

  app.post("/v1/immortality/team-offers/choose", async (request, reply) => {
    try {
      const body = GuildBody.extend({ teamId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Choosing a franchise is website-only.");
      return reply.send(await chooseImmortalityTeam({ ...body, discordId: auth.discordId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/immortality/contracts/sign", async (request, reply) => {
    try {
      const body = GuildBody.extend({ contractId: z.string().uuid() }).parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "member" });
      if (auth.mode !== "user") throw new ApiError(400, "Signing a contract is website-only.");
      return reply.send(await signImmortalityContract({ ...body, discordId: auth.discordId }));
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
