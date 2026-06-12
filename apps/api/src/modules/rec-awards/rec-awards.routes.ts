import type { FastifyInstance } from "fastify";
import { approveAwardWinner, castAwardVote, closeAwardVoting, generateAwardNominees, getAwardStatus, getAwardVotingSummary, getPendingAwardApprovals } from "./rec-awards.service.js";

export async function recAwardsRoutes(app: FastifyInstance) {
  app.post("/v1/awards/generate", async (request) => generateAwardNominees((request.body as any).guildId));
  app.post("/v1/awards/vote", async (request) => castAwardVote(request.body as any));
  app.post("/v1/awards/vote-summary", async (request) => getAwardVotingSummary(request.body as any));
  app.post("/v1/awards/close-voting", async (request) => closeAwardVoting((request.body as any).guildId));
  app.post("/v1/awards/approve", async (request) => approveAwardWinner(request.body as any));
  app.post("/v1/awards/status", async (request) => getAwardStatus((request.body as any).guildId));
  app.post("/v1/awards/pending-approvals", async (request) => getPendingAwardApprovals((request.body as any).guildId));
}
