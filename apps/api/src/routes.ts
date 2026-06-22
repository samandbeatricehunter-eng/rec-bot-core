import type { FastifyInstance } from "fastify";
import { boxScoreRoutes } from "./modules/box-score/box-score.routes.js";
import { gameChannelRoutes } from "./modules/game-channels/game-channels.routes.js";
import { highlightRoutes } from "./modules/highlights/highlights.routes.js";
import { leagueWeekRoutes } from "./modules/league-week/league-week.routes.js";
import { rosterRoutes } from "./modules/rosters/rosters.routes.js";
import { scheduleRoutes } from "./modules/schedule/schedule.routes.js";
import { serverConfigRoutes } from "./modules/server-config/server-config.routes.js";
import { setupRoutes } from "./modules/setup/setup.routes.js";
import { streamRoutes } from "./modules/streams/streams.routes.js";
import { teamOwnershipRoutes } from "./modules/team-ownership/team-ownership.routes.js";
import { teamRequestRoutes } from "./modules/team-requests/team-requests.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, service: "rec-core-api" }));

  await userRoutes(app);
  await setupRoutes(app);
  await teamOwnershipRoutes(app);
  await teamRequestRoutes(app);
  await rosterRoutes(app);
  await scheduleRoutes(app);
  await gameChannelRoutes(app);
  await serverConfigRoutes(app);
  await leagueWeekRoutes(app);
  await streamRoutes(app);
  await boxScoreRoutes(app);
  await highlightRoutes(app);
}
