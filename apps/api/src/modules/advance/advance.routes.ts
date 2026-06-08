import type { FastifyInstance } from "fastify";
import { buildAdvanceDmPayloads, calculateRecPotw, clearPendingEosBatch, generateWeeklyChallenges, getActiveGameChannels, getChallengeAudit, getGameChannelPlans, getReminderState, markGameChannelDeleted, recordGameChannel, recordGameChannelCheckin, recordReminder, runPostAdvanceAutomation, setEconomyConfig, setLeagueWeek, viewEconomyConfig, viewLeagueWeek } from "./advance.service.js";

export async function advanceRoutes(app: FastifyInstance) {
  app.post("/v1/advance/post-advance", async (request) => runPostAdvanceAutomation((request.body as any).guildId));
  app.post("/v1/advance/dm-payloads", async (request) => buildAdvanceDmPayloads((request.body as any).guildId));
  app.post("/v1/league-week/view", async (request) => viewLeagueWeek((request.body as any).guildId));
  app.post("/v1/league-week/set", async (request) => setLeagueWeek(request.body as any));
  app.post("/v1/economy/config/view", async (request) => viewEconomyConfig((request.body as any).guildId));
  app.post("/v1/economy/config/set", async (request) => setEconomyConfig(request.body as any));
  app.post("/v1/eos/clear-pending", async (request) => clearPendingEosBatch(request.body as any));
  app.post("/v1/challenges/generate", async (request) => generateWeeklyChallenges(request.body as any));
  app.post("/v1/challenges/regenerate", async (request) => generateWeeklyChallenges({ ...(request.body as any), regenerate: true }));
  app.post("/v1/challenges/audit", async (request) => getChallengeAudit((request.body as any).guildId));
  app.post("/v1/awards/potw/calculate", async (request) => calculateRecPotw((request.body as any).guildId));
  app.post("/v1/game-channels/plans", async (request) => getGameChannelPlans((request.body as any).guildId));
  app.post("/v1/game-channels/active", async (request) => getActiveGameChannels((request.body as any).guildId));
  app.post("/v1/game-channels/record", async (request) => recordGameChannel(request.body as any));
  app.post("/v1/game-channels/deleted", async (request) => markGameChannelDeleted(request.body as any));
  app.post("/v1/game-channels/checkin", async (request) => recordGameChannelCheckin(request.body as any));
  app.post("/v1/game-channels/reminder-state", async (request) => getReminderState((request.body as any).guildId));
  app.post("/v1/game-channels/reminder", async (request) => recordReminder(request.body as any));
}
