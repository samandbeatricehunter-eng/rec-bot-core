import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { sendError, ApiError } from "../../lib/errors.js";
import { isGuildOwner } from "../../lib/discord-guild.js";
import { CreateLeagueSchema, GetLeagueTeamConferencesSchema, RegisterServerSchema, UpdateServerRoutesSchema, UpdateTeamConferenceSchema } from "./setup.schemas.js";

const DeleteLeagueSchema = z.object({
  guildId: z.string().min(1),
  requestedByDiscordId: z.string().min(1).optional(),
  confirmationText: z.string().min(1),
});
import { createLeagueForServer } from "./setup-season.service.js";
import { publishRecGuideFromApi } from "../server-config/rec-guide-publisher.service.js";
import { linkSiteLeagueToServer } from "../subscriptions/bot-invite.service.js";
import { isAllowedLeagueCreator, requireSiteLeagueCreator, resolveSiteLeagueCreator } from "../../lib/site-league-creator.js";
import {
  registerServer,
  updateServerRoutes,
  getLeagueConfigAsDraft,
  updateLeagueConfig,
  deleteLeagueData,
  getLeagueTeamConferences,
  updateTeamConference,
  createUnclaimedLeague,
  updateSiteLeagueConfig,
  checkLeagueLinked,
  completeWizard,
} from "./setup.service.js";

const CreateUnclaimedLeagueSchema = z.object({
  name: z.string().trim().min(1).max(80),
  game: z.enum(["madden_26", "madden_27", "cfb_27"]),
  leaguePassword: z.string().optional().nullable(),
  leagueType: z.string().optional(),
  isOnline: z.boolean().optional(),
  crossPlayEnabled: z.boolean().optional(),
  requiredConsole: z.enum(["ps5", "xbox", "pc"]).optional().nullable(),
  activeRostersEnabled: z.boolean().optional(),
  trackRostersEnabled: z.boolean().optional(),
  dynastyType: z.string().optional(),
  recruitingDifficulty: z.string().optional(),
  transferPortalEnabled: z.boolean().optional(),
  coachCarouselEnabled: z.boolean().optional(),
  homeFieldAdvantageEnabled: z.boolean().optional(),
  stadiumPulseEnabled: z.boolean().optional(),
  conferenceRealignment: z.string().optional(),
  teamBuilderAllowed: z.boolean().optional(),
  playerEditPermission: z.string().optional(),
  manualXpProgressionPenaltyPct: z.number().int().min(0).max(100).optional(),
  verbalCommitInfluencePct: z.number().int().min(0).max(100).optional(),
  userTransferChancePct: z.number().int().min(0).max(100).optional(),
  cpuTransferChancePct: z.number().int().min(0).max(100).optional(),
  transferPortalMaxPerTeam: z.number().int().min(0).max(30).optional(),
  minimumPlayClockSeconds: z.number().int().min(10).max(25).optional(),
  seasonExperience: z.string().optional(),
  conferenceRules: z.array(z.object({
    conferenceName: z.string().trim().min(1).max(80),
    divisionsEnabled: z.boolean(),
    division1Name: z.string().optional().nullable(),
    division2Name: z.string().optional().nullable(),
    conferenceGames: z.number().int().min(6).max(9),
    confChampGameEnabled: z.boolean(),
    champGameLocation: z.string().optional().nullable(),
    champGameSelectionCriteria: z.string().optional().nullable(),
    protectedOpponentsEnabled: z.boolean(),
    protectedOpponentsCount: z.number().int().min(1).max(10),
  })).max(40).optional(),
  seasonNumber: z.number().int().min(1).optional(),
  seasonStage: z.string().optional(),
  currentWeek: z.number().int().min(1).max(30).optional(),
  currentPhase: z.string().optional(),
  streamingRequirement: z.string().optional(),
  regularSeasonStreamingRequirement: z.string().optional(),
  postseasonStreamingRequirement: z.string().optional(),
  gotwStreamingRequirement: z.string().optional(),
  streamingScope: z.string().optional(),
  streamingSide: z.string().optional(),
  regularSeasonStreamingSide: z.string().optional(),
  postseasonStreamingSide: z.string().optional(),
  gotwStreamingSide: z.string().optional(),
  fourthDownRuleType: z.string().optional(),
  fourthDownRuleTypeRegular: z.string().optional(),
  fourthDownRuleTypePlayoff: z.string().optional(),
  customFourthDownRule: z.string().optional().nullable(),
  customFourthDownRuleRegular: z.string().optional().nullable(),
  customFourthDownRulePlayoff: z.string().optional().nullable(),
  customRules: z.array(z.object({
    id: z.string().min(1).max(80),
    category: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(4000),
    sortOrder: z.number().int().min(0).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })).max(200).optional(),
  coinEconomyEnabled: z.boolean().optional(),
  coinEconomyMinimumLinkedUsers: z.number().int().min(0).max(30).optional(),
  customPlayersEnabled: z.boolean().optional(),
  legendsEnabled: z.boolean().optional(),
  devUpgradesEnabled: z.boolean().optional(),
  ageResetsEnabled: z.boolean().optional(),
  attributePurchasesEnabled: z.boolean().optional(),
  playerTraitPurchasesEnabled: z.boolean().optional(),
  contractAdjustmentPurchasesEnabled: z.boolean().optional(),
  mediaFeaturesEnabled: z.boolean().optional(),
  customPlayersSeasonCap: z.number().int().min(0).max(5).optional(),
  legendsSeasonCap: z.number().int().min(0).max(5).optional(),
  devUpgradeCapMode: z.string().optional(),
  devUpgradesSeasonCap: z.number().int().min(0).max(20).optional(),
  devUpgradesPlayerCap: z.number().int().min(0).max(20).optional(),
  ageResetsSeasonCap: z.number().int().min(0).max(5).optional(),
  playerTraitPurchasesSeasonCap: z.number().int().min(0).max(10).optional(),
  contractPurchasesSeasonCap: z.number().int().min(0).max(5).optional(),
  coreAttributePurchasesSeasonCap: z.number().int().min(0).max(99).optional(),
  coreAttributeGroupCap: z.number().int().min(0).max(99).optional(),
  nonCoreAttributePurchasesSeasonCap: z.number().int().min(0).max(99).optional(),
  coreAttributes: z.array(z.string()).optional(),
  coreAttributeCapOverrides: z.record(z.number().int().min(0).max(99)).optional(),
  nonCoreAttributeCapOverrides: z.record(z.number().int().min(0).max(99)).optional(),
  purchaseDeadlines: z.record(z.object({ stage: z.string().trim().min(1).max(80), week: z.number().int().min(1).max(30) })).optional(),
  customCoachesRequired: z.boolean().optional(),
  customPlaybooksAllowed: z.boolean().optional(),
  coachAbilitiesRestricted: z.boolean().optional(),
  coachAbilitiesRestrictionNotes: z.string().optional().nullable(),
  positionChangePolicy: z.string().optional(),
  positionChangePolicyDescription: z.string().optional().nullable(),
  tradeApprovalPolicy: z.string().optional(),
  cpuTradingPolicy: z.string().optional(),
  cpuTradingRestriction: z.string().optional().nullable(),
  injuryPolicy: z.string().optional(),
  difficulty: z.string().optional(),
  cfbDifficulty: z.string().optional(),
  // Madden-only (26 & 27) — CFB has no in-game trade-difficulty slider.
  tradeDifficulty: z.enum(["very_easy", "easy", "normal", "hard", "very_hard"]).optional(),
  // Madden 26 only — this setting does not exist in Madden 27 or CFB.
  freeAgentMotivationImpact: z.enum(["off", "normal", "high", "very_high"]).optional(),
  slidersAdjusted: z.boolean().optional(),
  difficultyCustomSettings: z.string().optional().nullable(),
  coachXpSetting: z.string().optional().nullable(),
  quarterLengthMinutes: z.number().int().min(1).max(15).optional(),
  acceleratedClockEnabled: z.boolean().optional(),
  acceleratedClockMinimumSeconds: z.number().int().min(0).max(40).optional(),
  salaryCapEnabled: z.boolean().optional(),
  tradeDeadlineEnabled: z.boolean().optional(),
  abilitiesEnabled: z.boolean().optional(),
  wearAndTearEnabled: z.boolean().optional(),
  advanceTiming: z.string().optional(),
  advanceTimingOther: z.string().max(120).optional().nullable(),
  coachFiringPolicy: z.string().optional(),
  preorderBonusesEnabled: z.boolean().optional(),
  coachModeEnabled: z.boolean().optional(),
  coachModeAutoPassEnabled: z.boolean().optional(),
  coachModeAutoSnapEnabled: z.boolean().optional(),
  coachModeCoachSuggestionsEnabled: z.boolean().optional(),
  coachModeRecruitFlippingEnabled: z.boolean().optional(),
  coachModeAutoRecruitingEnabled: z.boolean().optional(),
  coachModeAutoProgressPlayersEnabled: z.boolean().optional(),
  coachModeUserAutoProgressionEnabled: z.boolean().optional(),
  coachModeCpuManageBudgetEnabled: z.boolean().optional(),
  coachModeCpuManageStaffEnabled: z.boolean().optional(),
  coachModeCpuManageFacilitiesEnabled: z.boolean().optional(),
  ballHawk: z.string().optional(),
  heatSeeker: z.string().optional(),
  switchAssist: z.string().optional(),
  offensivePlayCallLimitsEnabled: z.boolean().optional(),
  offensivePlayCallLimit: z.number().int().min(1).max(50).optional().nullable(),
  offensivePlayCallCooldownEnabled: z.boolean().optional(),
  offensivePlayCallCooldown: z.number().int().min(1).max(50).optional().nullable(),
  defensivePlayCallLimitsEnabled: z.boolean().optional(),
  defensivePlayCallLimit: z.number().int().min(1).max(50).optional().nullable(),
  defensivePlayCallCooldownEnabled: z.boolean().optional(),
  defensivePlayCallCooldown: z.number().int().min(1).max(50).optional().nullable(),
  fairSimRequirements: z.string().optional().nullable(),
  forceWinRequirements: z.string().optional().nullable(),
});

const UpdateSiteLeagueConfigSchema = z.object({
  leagueId: z.string().uuid(),
}).passthrough();

const CheckLeagueLinkedSchema = z.object({
  leagueId: z.string().uuid(),
});

const CompleteWizardSchema = z.object({
  leagueId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  guildId: z.string().optional(),
  discordId: z.string().optional(),
});

const LinkSiteLeagueServerSchema = z.object({
  leagueId: z.string().uuid(),
  providerToken: z.string().min(1),
  guildId: z.string().trim().min(1),
  serverName: z.string().trim().max(120).optional(),
});

export async function setupRoutes(app: FastifyInstance) {
  app.post("/v1/setup/server/register", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await registerServer(RegisterServerSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/create", async (request, reply) => {
    try {
      const body = CreateLeagueSchema.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode === "user") body.requestedByDiscordId = auth.discordId;
      return reply.send(await createLeagueForServer(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-leagues/create/whoami", async (request, reply) => {
    try {
      const resolved = await resolveSiteLeagueCreator(request);
      return reply.send({ allowed: isAllowedLeagueCreator(resolved?.email) });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/site-leagues/create", async (request, reply) => {
    try {
      const body = CreateUnclaimedLeagueSchema.parse(request.body);
      const { userId } = await requireSiteLeagueCreator(request);
      return reply.send(await createUnclaimedLeague({ ...body, requestedByUserId: userId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.patch("/v1/setup/server/routes", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await updateServerRoutes(UpdateServerRoutesSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/config", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      // Settings is full-commissioner-only in Discord too — co-commissioners are blocked
      // before even reaching this screen there (isRestrictedLeagueMgmtButton).
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "commissioner" });
      return reply.send(await getLeagueConfigAsDraft(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // Same draft as above, but open to any league member — backs the read-only "Rules" page
  // (hub nav), which unlike Settings has no edit affordance, so there's nothing to gate.
  app.post("/v1/setup/league/rules", async (request, reply) => {
    try {
      const { guildId } = z.object({ guildId: z.string().min(1) }).parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "member" });
      return reply.send(await getLeagueConfigAsDraft(guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/config/update", async (request, reply) => {
    try {
      const body = CreateLeagueSchema.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode === "user") body.requestedByDiscordId = auth.discordId;
      const result = await updateLeagueConfig(body);
      const guide = await publishRecGuideFromApi(body.guildId).catch((error) => {
        request.log.error({ error }, "Failed to refresh REC Guide after settings update");
        return null;
      });
      return reply.send({ ...result, guide });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/delete", async (request, reply) => {
    try {
      const body = DeleteLeagueSchema.parse(request.body);
      const auth = await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "commissioner" });
      if (auth.mode === "user") {
        body.requestedByDiscordId = auth.discordId;
        // Web dashboard's delete is scoped tighter than the base commissioner check above —
        // only the guild's actual owner ("head commissioner") can delete from here. The
        // bot-native Discord delete-league flow keeps its existing commissioner-level gate.
        if (!(await isGuildOwner(body.guildId, auth.discordId))) {
          throw new ApiError(403, "Only the head commissioner can delete a league.");
        }
      }
      return reply.send(await deleteLeagueData(body));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/teams/conferences", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const input = GetLeagueTeamConferencesSchema.parse(request.body);
      return reply.send(await getLeagueTeamConferences(input.guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/setup/league/teams/conference", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await updateTeamConference(UpdateTeamConferenceSchema.parse(request.body)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/site-leagues/check-linked", async (request, reply) => {
    try {
      const { leagueId } = CheckLeagueLinkedSchema.parse(request.body);
      await requireSiteLeagueCreator(request);
      return reply.send(await checkLeagueLinked(leagueId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/site-leagues/update-config", async (request, reply) => {
    try {
      const body = UpdateSiteLeagueConfigSchema.parse(request.body);
      const { userId } = await requireSiteLeagueCreator(request);
      return reply.send(await updateSiteLeagueConfig({ ...body, requestedByUserId: userId }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/v1/site-leagues/complete-wizard", async (request, reply) => {
    try {
      const body = CompleteWizardSchema.parse(request.body);
      const { userId } = await requireSiteLeagueCreator(request);
      return reply.send(await completeWizard({ ...body, requestedByUserId: userId }));
    } catch (error) { return sendError(reply, error); }
  });

  // Directly links a created league to a Discord server the creator owns/manages — the
  // replacement for the token + /claim-league round-trip (see linkSiteLeagueToServer).
  app.post("/v1/site-leagues/link-server", async (request, reply) => {
    try {
      const body = LinkSiteLeagueServerSchema.parse(request.body);
      const { userId } = await requireSiteLeagueCreator(request);
      return reply.send(await linkSiteLeagueToServer({ ...body, requestedByUserId: userId }));
    } catch (error) { return sendError(reply, error); }
  });
}
