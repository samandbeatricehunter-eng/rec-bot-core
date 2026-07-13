import type { FastifyInstance } from "fastify";
import { webSessionRoutes } from "./modules/web-session/web-session.routes.js";
import { adminEconomyRoutes } from "./modules/admin-economy/admin-economy.routes.js";
import { activeCheckRoutes } from "./modules/active-checks/active-checks.routes.js";
import { boxScoreRoutes } from "./modules/box-score/box-score.routes.js";
import { gameChannelRoutes } from "./modules/game-channels/game-channels.routes.js";
import { highlightRoutes } from "./modules/highlights/highlights.routes.js";
import { gotwRoutes } from "./modules/gotw/gotw.routes.js";
import { legendRoutes } from "./modules/legends/legends.routes.js";
import { notificationsRoutes } from "./modules/notifications/notifications.routes.js";
import { purchaseRoutes } from "./modules/purchases/purchases.routes.js";
import { leagueWeekRoutes } from "./modules/league-week/league-week.routes.js";
import { rolesRoutes } from "./modules/roles/roles.routes.js";
import { rosterRoutes } from "./modules/rosters/rosters.routes.js";
import { scheduleRoutes } from "./modules/schedule/schedule.routes.js";
import { serverConfigRoutes } from "./modules/server-config/server-config.routes.js";
import { setupRoutes } from "./modules/setup/setup.routes.js";
import { streamRoutes } from "./modules/streams/streams.routes.js";
import { teamOwnershipRoutes } from "./modules/team-ownership/team-ownership.routes.js";
import { teamRequestRoutes } from "./modules/team-requests/team-requests.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { wagerRoutes } from "./modules/wagers/wagers.routes.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, service: "rec-core-api" }));

  await webSessionRoutes(app);
  await userRoutes(app);
  await adminEconomyRoutes(app);
  await activeCheckRoutes(app);
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
  await gotwRoutes(app);
  await legendRoutes(app);
  await notificationsRoutes(app);
  await purchaseRoutes(app);
  await rolesRoutes(app);
  await wagerRoutes(app);
}
