import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { requireSiteUserSession, type SiteUserSession } from "./site-auth.js";

// Hardcoded allowlist rather than a DB flag: only Samuel's account should ever see this
// surface, and a DB-driven role would be one more table an attacker could try to write to.
const SITE_ADMIN_EMAILS = new Set(["samuelpatrickhunter@icloud.com"]);

export function isSiteAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SITE_ADMIN_EMAILS.has(email.trim().toLowerCase());
}

export async function requireSiteAdmin(request: FastifyRequest): Promise<SiteUserSession> {
  const session = await requireSiteUserSession(request);
  if (!isSiteAdminEmail(session.email)) {
    throw new ApiError(403, "Admin access required.");
  }
  return session;
}
