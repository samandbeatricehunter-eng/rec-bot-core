import type { FastifyInstance } from "fastify";
import { importRoutes } from "./modules/imports/import.routes.js";
import { setupRoutes } from "./modules/setup/setup.routes.js";
import { teamOwnershipRoutes } from "./modules/team-ownership/team-ownership.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { eaFranchiseRoutes } from "./modules/imports/ea-franchise.routes.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, service: "rec-core-api" }));

  await userRoutes(app);
  await setupRoutes(app);
  await teamOwnershipRoutes(app);
  await importRoutes(app);
  await eaFranchiseRoutes(app);
}