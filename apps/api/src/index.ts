import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { registerRoutes } from "./routes.js";
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
// global: false — only routes that opt in via `config: { rateLimit: {...} }` (currently
// just the unauthenticated Activity auth-exchange endpoint) are limited.
await app.register(rateLimit, { global: false });
await registerRoutes(app);
try { await app.listen({ host: env.API_HOST, port: env.API_PORT }); }
catch (error) { app.log.error(error); process.exit(1); }
