# Site + Supabase Auth Migration

Goal (Samuel, 2026-07-21): move the web experience off the Discord-JWT flow entirely.
Plan, in order: (1) stand up Supabase Auth in an isolated app and test it, (2) build the
real marketing main page + its branching pages, (3) tie in the league pages, (4) open
account creation to everyone for public testing, (5) go live as a PWA — at which point
Discord auth is retired.

## Approved account-linking flow (2026-07-21, Samuel — **implemented**)

Onboarding sequence:

1. New user registers with **email + password** (existing `SignUp` flow).
2. **Link-to-Discord-identity screen**: searchable dropdown of every user currently linked
   to a team (`rec_discord_accounts` + active `rec_team_assignments`), shown by their
   **actual Discord username** (not server nickname/display name).
3. User selects themselves → REC sends a 6-digit verification code by Discord DM to that
   account (10-minute expiry, rate-limited, max 5 attempts).
4. After successful code verification, the Supabase auth user is linked to that existing
   `rec_users` row (`supabase_auth_user_id`). Stats, badges, records, wallet stay attached.
5. Immediately after claim, that identity is no longer claimable and disappears from the
   dropdown (`supabase_auth_user_id is null` filter + unique claim audit row).
6. User creates a unique `rec_users.username` (live availability check) to finish setup.
7. Account complete. **Once Discord is fully removed later**, Discord ID/info for that
   user gets deleted — this linking step is a *migration bridge*, not a permanent second
   identity.

Schema decisions locked in:
- Link storage: `rec_users.supabase_auth_user_id` (unique) + `rec_site_identity_claims`
- Username: `rec_users.username` with case-insensitive unique index + format check
- Claim races: unique constraints + transactional claim + Discord DM proof-of-ownership

## Implementation checklist for approved linking flow

Items 1–5 are **done**. Remaining items are cutover / later-phase work.

### 1) Data model: persistent auth-to-user link — done

- `rec_users.supabase_auth_user_id` (unique) + `rec_site_identity_claims`
- Migrations under `supabase/migrations/2026072114*_site_auth_*.sql`

### 2) Identity claim lock (race-safe) — done

- Transactional claim + unique constraints; claimed rows excluded from candidates
- Discord DM challenge table with expiry, rate limit, attempt cap

### 3) Link-to-identity API contract — done

- `/v1/site-auth/link/candidates`, `request-code`, `verify` (Supabase bearer session)

### 4) Dropdown UX at scale — done (v1)

- Server-side Discord-username search + team label disambiguator
- Claim progress via send-code → verify UI states

### 5) Username policy + storage — done

- `rec_users.username` (3–24 `[A-Za-z0-9_.]`, case-insensitive unique, reserved names)
- Live `/username/check` + set endpoint + Account UI

### 6) Migration bridge behavior — not started

- Keep Discord linkage readable only as long as migration requires it.
- Mark linked users with migration state (for example `unlinked`, `linked`, `retired`).
- Define and document the final retirement job that removes Discord identifiers once
  cutover is complete.

Exit criteria:
- There is a documented and testable path from bridge mode to Discord-retired mode.

### 7) Security + RLS readiness — not started (blocked until browser reads `rec_*`)

- Before any browser-side access to `rec_*` data from `apps/site`, implement explicit RLS
  policies for each touched table.
- Validate that service-role-only operations remain API-side and never move into client code.

Exit criteria:
- No direct browser query succeeds unless intentionally allowed by policy.
- Authenticated users can only read/update allowed rows.

### 8) Test plan (must-have) — partial (manual E2E still open)

- Unit tests: validation, username normalization, claim conflict handling.
- Integration tests: full signup -> link -> username set -> account usable.
- Concurrency test: two claim attempts for same identity in parallel.
- Regression tests: legacy Discord-auth app behavior unaffected before cutover.

Exit criteria:
- Tests cover success, conflict, and retry paths.
- No regression in existing `apps/web` Discord flow before retirement.

### 9) Rollout plan

- Feature-flag linking flow in `apps/site`.
- Internal test cohort first, then wider public enablement.
- Instrument key metrics: claim success rate, collision rate, username rejection rate.

Exit criteria:
- We can enable/disable linking safely without schema rollback.
- Failures are observable with actionable telemetry.

## Why a new app instead of touching `apps/web`

`apps/web` is entirely gated behind the Discord flow today: `/hub` in Discord mints a
signed JWT server-side, and `AuthGate` in `App.tsx` treats League Mgmt as the root route —
there is no public page in that app at all. Bolting a public marketing site + a second
auth system onto that root would risk the live flow real users depend on for the season.

So phase 1 lives in a brand new, fully isolated package: **`apps/site`** (`@rec/site`).
Separate Vite dev server (port 5174), separate build/deploy, zero shared code path with
`apps/web`'s routing or auth. It can be built and tested indefinitely without any chance
of affecting the live Discord-authenticated hub. Whether phase 2+ stays a separate app or
gets merged into `apps/web` once Discord auth is actually retired is an open decision —
default lean is to keep building here and only merge/cut over at the end, so the live app
is never in a half-migrated state.

## What's built (phase 1 — foundation, done)

- `apps/site` — new workspace package, same conventions as `apps/web` (tsconfig, Vite
  setup, `server/serve.js` static server for prod).
- `src/lib/supabase-client.ts` — the **only** anon/publishable-key Supabase client in the
  repo. Every other client (`apps/api/src/lib/supabase.ts`) uses the service role key and
  bypasses RLS by design; this one is browser-side and can only do what RLS explicitly
  allows. **Never import the service role key here.**
- `src/lib/auth-context.tsx` — `AuthProvider`/`useAuth()`: tracks the Supabase session
  (`getSession` + `onAuthStateChange`), exposes `signUp` / `signIn` / `signOut`.
- Pages: `Landing` (public, minimal placeholder copy), `SignUp`, `LogIn`, `Account`
  (signed-in onboarding: Link identity → Choose username → Complete). `RequireAuth`
  guards `/account`.
- `.env.example` / `.env` — `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` +
  `VITE_REC_CORE_API_URL` (anon key, safe client-side). `.env` is gitignored per repo
  convention.
- `.claude/launch.json` — `site-dev` config (port 5174) alongside `web-dev`/`api-dev`.

**Verified live end-to-end** (2026-07-21, project `kyooxpjsxvsatrariafq`): signed up a
disposable test account (`rec-site-test-20260721@mailinator.com`) through the actual
running UI → confirmed a real row landed in `auth.users` with `confirmation_sent_at`
populated → confirmed the UI correctly shows the "check your email" pending state →
confirmed logging in with the correct password against the *unconfirmed* account returns
Supabase's real `Email not confirmed` error (proving the password was validated against
the real hash, not just rejected outright) and the UI surfaces it. Both typecheck and
production build are clean. Supabase email/password auth requires confirmation by default
in this project — no provider config changes were needed or made.

That leftover test user can be deleted from Supabase Dashboard → Authentication → Users
whenever convenient; it's inert (unconfirmed, no other data references it).

## Built: account linking (phase 1.5 — done)

API (`apps/api`, Supabase bearer session via `requireSiteUserSession`):
- `POST /v1/site-auth/me`
- `POST /v1/site-auth/link/candidates` — Discord **username** search, unclaimed only
- `POST /v1/site-auth/link/request-code` — Discord DM 6-digit challenge
- `POST /v1/site-auth/link/verify` — verify code and claim once
- `POST /v1/site-auth/username/check` — live availability
- `POST /v1/site-auth/username/set`

DB (applied on project `kyooxpjsxvsatrariafq`):
- `rec_users.supabase_auth_user_id` + `rec_users.username`
- `rec_site_identity_claims` (one auth ↔ one rec user)
- `rec_site_identity_claim_challenges` (DM code challenges)

UI (`apps/site` Account page):
- Stepper: Link identity → Choose username → Complete
- Searchable Discord-username dropdown + DM verification
- Username availability check before save

## Not built yet (later phases)

Chrome (bottom nav, league selector, top-right notifications bell, Carbon Fiber + league
themes, hub/league placeholder routes) is in place — see
[site-chrome-and-theme.md](site-chrome-and-theme.md). APIs: `POST /v1/site-leagues/mine` +
`retire`, `POST /v1/site-notifications/list` + `mark-read`. Remaining product work:

2. **Real marketing site content + branching pages.** `Landing` is still a placeholder.
3. **League pages behind site auth.** Linking + chrome/selector exist; real league
   hub/content still mostly lives in Discord-gated `apps/web`. Site placeholders under
   `/l/:leagueId/*` prove nav + theme switching.
4. **Site Inbox / messaging** — Phase A API + `apps/site` UI scaffolded (`/inbox`,
   `/friends`; friends + DM + commissioner threads + 30-day purge). Design:
   `docs/site-inbox-messaging.md`. Reached from Account (not a bottom-nav tab); later
   under Notifications. Mobile screens and unread badge still later.
5. **RLS policies** if/when `apps/site` ever reads `rec_*` tables directly from the
   browser (today all REC data access for linking goes through the API service role).
6. **Open signup to everyone for public testing** once league pages are reachable.
7. **PWA + Discord-auth cutover.**

## Notes for whoever picks this up next

- Local dev: `pnpm --filter @rec/site run dev` (or the `site-dev` launch config), needs
  `apps/site/.env` populated (see `.env.example`; values are the same project's anon key,
  already in `apps/site/.env` locally).
- Supabase project: `kyooxpjsxvsatrariafq` (same project as everything else — one
  Supabase project, two auth systems coexisting during the transition: `auth.users` for
  the new flow, `rec_discord_accounts`/Discord OAuth for the old one).
- Password minimum is 8 chars client-side; Supabase's own default policy applies too.
