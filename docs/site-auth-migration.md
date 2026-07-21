# Site + Supabase Auth Migration

Goal (Samuel, 2026-07-21): move the web experience off the Discord-JWT flow entirely.
Plan, in order: (1) stand up Supabase Auth in an isolated app and test it, (2) build the
real marketing main page + its branching pages, (3) tie in the league pages, (4) open
account creation to everyone for public testing, (5) go live as a PWA — at which point
Discord auth is retired.

## Approved account-linking flow (2026-07-21, Samuel — plan only, NOT implemented)

This is the answer to the open question in "Tie in league pages" below. Onboarding
sequence once built:

1. New user registers with **email + password** (existing `SignUp` flow).
2. **Link-to-Discord-identity screen** (new, not built): a dropdown listing every user
   currently linked to a team across the leagues/database (i.e. everyone with a
   `rec_discord_accounts` row / active `rec_team_assignments`), shown by their **Discord
   display name**. The new user selects themselves from the list.
3. Once selected, the new Supabase auth user (email) is linked to that existing user's
   full history going forward — stats, badges, records, wallet, etc. all stay attached to
   the same underlying `rec_users` row; only the identity/login method changes.
4. User then **creates a unique username** (new field, doesn't exist yet — need to decide
   where this lives, likely a new column on `rec_users` or a dedicated identity table)
   and optionally sets other profile details.
5. Account is created / onboarding complete.
6. **Once Discord is fully removed later**, the Discord ID and any Discord-specific info
   tied to that user gets deleted — this linking step is explicitly a *migration bridge*,
   not a permanent second identity kept around forever.

Not decided yet (don't need answers now, just flagging): exact matching/search UX for the
dropdown at scale (many users across many leagues), what happens if two Supabase accounts
try to claim the same Discord identity, uniqueness rules for the new username field, and
where in the schema the Supabase `auth.users.id` ↔ `rec_users.id` link actually gets
stored.

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
  (signed-in placeholder proving the session round-trips — this is where the real
  dashboard/league-linking lands in a later phase). `RequireAuth` guards `/account`.
- `.env.example` / `.env` — `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (anon
  key, safe client-side). `.env` is gitignored per repo convention.
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

## Not built yet (later phases — need direction, not started blind)

2. **Real marketing site content + branching pages.** `Landing` today is a one-screen
   placeholder. Needs actual copy/design direction, plus whatever "branching pages" means
   concretely (About? Pricing? Features? Per-league public pages?).
3. **Tie in league pages.** Flow is now approved (see "Approved account-linking flow"
   above) — pick-your-Discord-identity dropdown → link → set unique username + optional
   profile details → done. Not yet implemented: the link-to-identity screen, the username
   field/uniqueness constraint, and the actual `auth.users` ↔ `rec_users` link storage.
4. **RLS policies.** The moment `apps/site` needs to read/write any `rec_*` table directly
   from the browser (not just Supabase Auth's own `auth.users`), every table it touches
   needs real RLS policies — today RLS is enabled repo-wide but has zero policies (service
   role bypasses it). This is a deliberate, table-by-table security design task, not a
   toggle.
5. **Open signup to everyone for testing.** Trivial once (3)+(4) exist — signup itself is
   already open in phase 1, there's just nothing behind it yet.
6. **PWA + cutover.** Manifest, service worker, install prompts, and — the big one —
   actually retiring the Discord-JWT flow in `apps/web` once this app fully replaces it.

## Notes for whoever picks this up next

- Local dev: `pnpm --filter @rec/site run dev` (or the `site-dev` launch config), needs
  `apps/site/.env` populated (see `.env.example`; values are the same project's anon key,
  already in `apps/site/.env` locally).
- Supabase project: `kyooxpjsxvsatrariafq` (same project as everything else — one
  Supabase project, two auth systems coexisting during the transition: `auth.users` for
  the new flow, `rec_discord_accounts`/Discord OAuth for the old one).
- Password minimum is 8 chars client-side; Supabase's own default policy applies too.
