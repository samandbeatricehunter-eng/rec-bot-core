import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalApiKey } from "../../lib/auth.js";
import { bestEffort } from "../../lib/best-effort.js";
import { sendError } from "../../lib/errors.js";
import { getServerConfig, setServerConfig, isGuildLinkedToLeague } from "./server-config.service.js";
import { createGuildChannel, listGuildChannels } from "../../lib/discord-guild.js";
import { requireBotOrUserSession } from "../../lib/user-auth.js";
import { getRecRouteChannel } from "@rec/shared";
import { publishRecGuideFromApi } from "./rec-guide-publisher.service.js";

const ViewConfigSchema = z.object({
  guildId: z.string().min(1)
});

const SetConfigSchema = z.object({
  guildId: z.string().min(1),
  pendingEconomyChannelId: z.string().optional().nullable(),
  boxScoresChannelId: z.string().optional().nullable(),
  weeklySubmissionsChannelId: z.string().optional().nullable(),
  recGuideChannelId: z.string().optional().nullable(),
  powerRankingsChannelId: z.string().optional().nullable(),
  gameChannelsCategoryId: z.string().optional().nullable(),
  streamsChannelId: z.string().optional().nullable(),
  highlightsChannelId: z.string().optional().nullable(),
  announcementsChannelId: z.string().optional().nullable(),
  commissionerRoleId: z.string().optional().nullable(),
  compCommitteeRoleId: z.string().optional().nullable(),
  tradeBlockChannelId: z.string().optional().nullable(),
  votingPollsChannelId: z.string().optional().nullable(),
  mainChatChannelId: z.string().optional().nullable(),
  headlinesChannelId: z.string().optional().nullable(),
  schedulingChannelId: z.string().optional().nullable(),
  matchupsChannelId: z.string().optional().nullable(),
  interviewsChannelId: z.string().optional().nullable(),
  tweetsChannelId: z.string().optional().nullable(),
  playerOfTheWeekChannelId: z.string().optional().nullable(),
  rosterMovementChannelId: z.string().optional().nullable(),
  finalizedTradesChannelId: z.string().optional().nullable(),
  leagueLeadersChannelId: z.string().optional().nullable(),
  recordHoldersChannelId: z.string().optional().nullable(),
  ownersChatChannelId: z.string().optional().nullable()
});

export async function serverConfigRoutes(app: FastifyInstance) {
  app.post("/v1/discord-servers/link-status", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      const { guildId } = ViewConfigSchema.parse(request.body);
      return reply.send({ linked: await isGuildLinkedToLeague(guildId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/v1/server-config/rec-guide/refresh", async (request, reply) => {
    try {
      const { guildId } = ViewConfigSchema.parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" });
      const result = await publishRecGuideFromApi(guildId);
      if (!result) throw new Error("Assign a REC Guide channel before refreshing the guide.");
      return reply.send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });
  app.post("/v1/server-config/channels", async (request, reply) => { try { const { guildId } = ViewConfigSchema.parse(request.body); await requireBotOrUserSession(request, { resolveGuildId: () => guildId, permission: "co_commissioner" }); const [channels, config] = await Promise.all([listGuildChannels(guildId), getServerConfig(guildId)]); return reply.send({ channels, routes: config.routes }); } catch (error) { return sendError(reply, error); } });
  app.post("/v1/server-config/channels/create", async (request, reply) => { try {
    const body = z.object({ guildId: z.string().min(1), routeKey: z.string().min(1), name: z.string().min(1).max(100), type: z.enum(["text", "category"]), templateChannelId: z.string().optional().nullable() }).parse(request.body);
    await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
    const route = getRecRouteChannel(body.routeKey); if (!route) throw new Error("Unknown designated channel type.");
    const config = await getServerConfig(body.guildId); const routes = config.routes as Record<string, string | null | undefined>;
    const ownTemplate = routes?.[route.dbField] ?? null;
    const parentRoute = "defaultParentRoute" in route ? getRecRouteChannel(route.defaultParentRoute as string) : null;
    const parentChannelId = parentRoute ? routes?.[parentRoute.dbField] ?? null : null;
    const channel = await createGuildChannel(body.guildId, { ...body, name: route.defaultName, templateChannelId: ownTemplate ?? body.templateChannelId, parentChannelId });
    await setServerConfig({ guildId: body.guildId, [route.inputField]: channel.id });
    const guide = body.routeKey === "rec_guide" ? await publishRecGuideFromApi(body.guildId, channel.id) : null;
    return reply.send({ channel, guide });
  } catch (error) { return sendError(reply, error); } });
  app.post("/v1/economy/config/view", async (request, reply) => {
    try {
      requireInternalApiKey(request);
      return reply.send(await getServerConfig(ViewConfigSchema.parse(request.body).guildId));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/v1/economy/config/set", async (request, reply) => {
    try {
      const body = SetConfigSchema.parse(request.body);
      await requireBotOrUserSession(request, { resolveGuildId: () => body.guildId, permission: "co_commissioner" });
      const before = await bestEffort("server_config.get_before_set", () => getServerConfig(body.guildId), { guildId: body.guildId }) ?? null;
      const previousGuideChannelId = (before?.routes as Record<string, unknown> | null)?.rec_guide_channel_id ?? null;
      const config = await setServerConfig(body);
      // Only republish the guide when its channel actually changed — the settings form
      // resubmits every route field on every save, so comparing against undefined/present
      // would re-purge-and-repost the guide on unrelated channel edits.
      let guide: { posted: number; channelId: string } | null = null;
      if (body.recGuideChannelId !== undefined && body.recGuideChannelId !== previousGuideChannelId) {
        guide = await publishRecGuideFromApi(body.guildId, body.recGuideChannelId ?? undefined).catch((error) => {
          console.error("[ERROR] Failed to refresh REC guide after settings save (non-fatal):", error);
          return null;
        });
      }
      return reply.send({ ...config, guide });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
