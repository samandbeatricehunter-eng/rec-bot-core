# Repository security and quality audit — 2026-07-28

## Scope

Reviewed the API, Discord bot, public site, legacy web redirect, shared packages,
dependency graph, production bundles, and the live Supabase project's RLS/function
exposure. The review focused on authentication/authorization boundaries, IDOR/BOLA,
remote fetches, secrets, error disclosure, database privileges, dependency advisories,
resource limits, caching, and maintainability hotspots.

## Remediated

- Internal API authentication now fails closed when its secret is absent and compares
  secrets in constant time.
- API 5xx responses no longer expose raw Supabase/Postgres details.
- Peer-wager acceptance and every counter-offer lookup are scoped to the active league.
- The destructive `rec_delete_league` RPC is no longer executable by public, anonymous,
  or authenticated Data API roles.
- All application-owned public RPCs (`rec_*` and `add_to_wallet`) are executable only by
  `service_role`, matching the repository's service-role-only database architecture.
- Box-score and highlight remote media ingestion now prevents SSRF and memory exhaustion:
  HTTPS-only trusted hosts, redirect revalidation, MIME checks, timeouts, and byte limits.
- API requests now have a global body limit, rate limiting, a strict production CORS
  allowlist, proxy-aware client IPs, and standard security headers.
- The site and legacy redirect servers now return security headers. Runtime configuration
  serialization escapes HTML-significant characters.
- Dynamic announcement links reject non-HTTP(S) schemes.
- Discord REST calls now time out instead of hanging indefinitely.
- High-severity API dependency advisories were removed by updating Fastify, Undici,
  Supabase, JOSE, PostgreSQL, and WebSocket packages.
- React Router was upgraded to the current compatible SPA release, resolving the prior
  open-redirect/XSS and hydration advisories.
- Expensive league calculations now deduplicate concurrent work, expire stale entries,
  and cap their in-memory cache.

## Verified database posture

- Every public table has RLS enabled.
- The project intentionally has no public RLS policies; the API uses `service_role`.
- No application-owned RPC remains executable by `anon` or `authenticated`.
- Current table volumes are small. Sequential scans on small lookup tables are expected;
  broad speculative indexing would currently cost more on writes than it saves on reads.

## Remaining engineering opportunities

These are architectural investments rather than release-blocking vulnerabilities:

1. Add API integration tests for authorization matrices and concurrent economy operations.
   Current automated coverage is concentrated in the bot.
2. Split the largest hand-maintained modules (`box-score.service.ts`, `hub.service.ts`,
   `user.service.ts`, `wagers.service.ts`, `HubHome.tsx`, and `index-timeout.ts`) by domain.
   Their size increases review cost and regression risk.
3. Move transient OCR jobs and interactive bot sessions to a durable shared store before
   horizontally scaling the API/bot beyond one instance.
4. Add structured error/event telemetry with request IDs and alerting. The current logs
   are adequate for diagnosis but not for proactive operational monitoring.
5. Add browser-level smoke tests for sign-in, league navigation, advance, matchup detail,
   chat bridging, and commissioner workflows.
6. Rotate `REC_INTERNAL_API_KEY` to a randomly generated 32-byte-or-longer value in the
   API and bot deployments at the same time. The current local development value is short;
   enforcing a minimum in code before coordinated rotation would prevent both services
   from starting or communicating.

## Dependency note

The package auditor currently reports an advisory against React Router's **RSC mode**.
This project is a Vite `BrowserRouter` SPA and does not use React Server Components,
server actions, or React Router framework/RSC request handlers, so that path is not
reachable. The advisory's stated patched `8.3.0` package was not available in the
configured registry at audit time. Monitor and upgrade when a compatible published fix
exists.
