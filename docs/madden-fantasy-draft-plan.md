# Madden Roster Pre-Seed + Fantasy Draft Tracker — Implementation Plan

Status: **planned, not started**. Written 2026-08-07 from a live spec session with Samuel.
Any agent picking this up should read this whole doc before touching code — it's the
source of truth for a feature that spans a new data pipeline, league-creation wiring, a
realtime draft-session state machine, and a fairly involved new UI surface.

## 0. Why this exists

Today, creating a Madden league (`game: "madden_26"|"madden_27"`) seeds the 32 fixed
`rec_teams` rows (from `AFC_TEAMS`/`NFC_TEAMS` in `@rec/shared`) but **no players at all**.
`leagueType` (`regular_rosters` | `fantasy_draft` | `custom_rosters`) is already collected
at league creation (`apps/api/src/modules/setup/setup.schemas.ts`) and stored on
`rec_league_configuration.roster_type`, but nothing reads it yet — CFB has a baseline-roster
import path (`applyCfbBaselineToLeague`), Madden has no equivalent.

Goal: give Madden leagues the same "start with a known real roster" experience CFB has,
plus (for `fantasy_draft` leagues) a live, commissioner-run draft tracker that mirrors an
actual in-game Madden fantasy draft, since Madden's own draft UI has no way to export or
sync picks back out to a companion app.

## 1. Source data (already compiled, not yet in the repo)

Scraped from maddenratings.com (a fan ratings site, not EA) into CSVs, delivered to Samuel
directly in chat on 2026-08-07 — **not yet committed anywhere in this repo**. Before
building the seed script, pull these back from Samuel and land them in
`apps/api/scripts/data/madden27/` (gitignored raw CSVs, or check in — TBD, see open
questions):

- `madden27_all_rosters.csv` — 2,370 players across all 32 teams, full attribute
  breakdown (name, position, jersey, archetype, OVR, ~53 individual attributes, age, DOB,
  nationality, college, years pro, draft year/pick/team, X-Factor/Superstar ability text).
- `madden27_free_agents.csv` — 299 free agents, same shape.
- `madden27_player_photos.csv` — photo **URLs** (not downloaded images — these are
  EA/site-owned player renders; hotlink or re-host deliberately, don't bulk-copy the
  binaries) keyed by `id` (site URL slug, e.g. `josh-allen`), joins to the rosters/FA CSVs
  on that same key.
- `madden27_unrated_stub_players.csv` — 410 players the source site lists but never
  rated (name + photo only, no team/position/attributes). **Excluded from the pool.**
  Status on cross-referencing these against real-life current NFL rosters/free agency:
  **not done for all 410** — only spot-checked one (Amare Barno, confirmed via Wikipedia
  as an accurate free agent, now UFL). The Madden 26 ratings spreadsheet Samuel shared
  only matched 2 of the 410 by name (that sheet has ~1,877 rows — starters/notable
  backups only, not deep enough to cover these). A full 410-player real-life cross-check
  has no single bulk source and would mean ~410 individual lookups; not attempted at that
  scale. If Samuel wants this pursued further, scope it down (e.g. only the 285 stubs that
  at least have a draft-class year, since true unknowns are least likely to matter for a
  draft pool) rather than all 410.

Total usable pool: **2,669 players** (2,370 rostered + 299 FA), each with a full attribute
set. This is meaningfully short of a real depth chart (avg. ~74/team vs. real ~90-man
offseason rosters) because the source site's own database is incomplete — flagged to
Samuel already, not a scraping bug.

## 2. Data model

Mirror the CFB baseline pattern (`supabase/migrations/20260731150000_cfb_baseline_roster.sql`,
applied via `apps/api/src/modules/*/cfb-baseline.service.ts` and seeded by
`apps/api/scripts/cfb-baseline-seed.ts`), simplified because Madden's 32 teams are fixed
(no need for a `baseline_teams` table — join straight to team **abbreviation**, matched
against the league's existing `rec_teams` rows) and Madden's attribute set is fixed and
already flat (no need for CFB's EAV `attribute_key`/`attribute_value` table — use real
columns).

New migration, e.g. `supabase/migrations/<ts>_madden_baseline_roster.sql`:

```sql
create table public.rec_madden_roster_datasets (
  id uuid primary key default gen_random_uuid(),
  game_title text not null,              -- 'madden_27'
  provider text not null,                -- 'maddenratings.com'
  published_date date not null,
  source_version text not null,          -- e.g. a scrape-date tag
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.rec_madden_roster_datasets enable row level security;

create table public.rec_madden_baseline_players (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.rec_madden_roster_datasets(id) on delete cascade,
  source_slug text not null,             -- maddenratings.com URL slug, our stable player id
  name text not null,
  team_abbreviation text,                -- null = free agent
  position text not null,
  jersey_number integer,
  archetype text,
  overall_rating integer not null,
  age integer, date_of_birth date, nationality text, college text, years_pro integer,
  draft_year integer, draft_pick_overall integer, drafted_by_team text,
  photo_url text,
  abilities_raw text,
  -- one column per Madden attribute (speed, acceleration, ... kick_return); see the CSV
  -- header for the full ~53-column list. Flat columns, not EAV — the set is fixed and known.
  speed integer, acceleration integer, strength integer, agility integer, awareness integer,
  -- ... (fill out remaining attribute columns from madden27_all_players.csv header)
  total_attributes integer,
  created_at timestamptz not null default now(),
  unique (dataset_id, source_slug)
);
alter table public.rec_madden_baseline_players enable row level security;
create index rec_madden_baseline_players_dataset_idx on public.rec_madden_baseline_players(dataset_id);
create index rec_madden_baseline_players_team_idx on public.rec_madden_baseline_players(dataset_id, team_abbreviation);
create index rec_madden_baseline_players_position_idx on public.rec_madden_baseline_players(dataset_id, position);
```

Per-league mutable copy (created at league setup time, from the active dataset):

```sql
create table public.rec_madden_league_players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  baseline_player_id uuid not null references public.rec_madden_baseline_players(id),
  team_id uuid references public.rec_teams(id),   -- null = free agent / undrafted pool
  is_drafted boolean not null default false,
  drafted_pick_id uuid,   -- set once picked, references rec_fantasy_draft_picks(id) below
  created_at timestamptz not null default now()
);
alter table public.rec_madden_league_players enable row level security;
create index rec_madden_league_players_league_idx on public.rec_madden_league_players(league_id);
create unique index rec_madden_league_players_league_baseline_idx on public.rec_madden_league_players(league_id, baseline_player_id);
```

This is the table both `regular_rosters` and `fantasy_draft` leagues use — the difference
is purely whether `team_id` starts populated (regular) or null league-wide, grouped only
by `position` for pool display (fantasy).

Fantasy draft session state (new tables, careful not to collide with the *existing*
`rec_draft_picks` table — that one tracks future **rookie draft pick assets** for
trading, completely unrelated; name these `rec_fantasy_draft_*`):

```sql
create table public.rec_fantasy_draft_sessions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  status text not null default 'not_scheduled'
    check (status in ('not_scheduled','scheduled','live','wrap_up','concluded')),
  order_mode text check (order_mode in ('standard','snake')),
  scheduled_at timestamptz,
  current_round integer not null default 1,
  current_pick_in_round integer not null default 1,   -- 1-32
  commenced_by_user_id uuid,
  commenced_at timestamptz,
  concluded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_fantasy_draft_sessions enable row level security;
create unique index rec_fantasy_draft_sessions_one_active_idx
  on public.rec_fantasy_draft_sessions(league_id) where status != 'concluded';

create table public.rec_fantasy_draft_pick_order (
  session_id uuid not null references public.rec_fantasy_draft_sessions(id) on delete cascade,
  pick_in_round integer not null check (pick_in_round between 1 and 32),
  team_id uuid not null references public.rec_teams(id),
  primary key (session_id, pick_in_round)
);
alter table public.rec_fantasy_draft_pick_order enable row level security;

create table public.rec_fantasy_draft_picks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rec_fantasy_draft_sessions(id) on delete cascade,
  round integer not null,
  pick_in_round integer not null,
  overall_pick_number integer not null,
  team_id uuid not null references public.rec_teams(id),
  league_player_id uuid not null references public.rec_madden_league_players(id),
  is_wrapup_pick boolean not null default false,
  logged_by_user_id uuid not null,
  logged_at timestamptz not null default now()
);
alter table public.rec_fantasy_draft_picks enable row level security;
create index rec_fantasy_draft_picks_session_idx on public.rec_fantasy_draft_picks(session_id, overall_pick_number);
```

`rec_madden_league_players.drafted_pick_id` FK's to this last table (add after both exist).

All new tables get `alter table ... enable row level security;` per this repo's
CLAUDE.md convention (service-role bypasses it; no anon-key policies needed yet).

## 3. Backend — league creation wiring

In `apps/api/src/modules/setup/setup.service.ts`, alongside the existing
`applyCfbBaselineToLeague` call, add a Madden branch:

- `leagueType === "regular_rosters"`: for each active `rec_madden_baseline_players` row,
  insert a `rec_madden_league_players` row with `team_id` resolved from
  `team_abbreviation` → the league's own `rec_teams.id` (same abbreviation-matching
  pattern `applyCfbBaselineToLeague` already uses). Free agents (`team_abbreviation` null)
  get `team_id: null` too — they just sit in the pool as real-life free agents, still
  visible/pickup-able later via whatever waiver/FA-add flow already exists for rosters.
- `leagueType === "fantasy_draft"`: same insert, but **every** row gets `team_id: null`
  regardless of real-life team — the whole pool starts undrafted, grouped only by
  `position`. Also insert a `rec_fantasy_draft_sessions` row with `status: 'not_scheduled'`.
- `leagueType === "custom_rosters"`: **no preseed by default.** Immediately after the
  commissioner picks "custom rosters" in the creation wizard, show a confirmation step:
  "Pre-seed with in-game default rosters anyway?" — Yes runs the exact same import as
  `regular_rosters` (real team assignments); No leaves rosters empty for fully manual
  building (existing behavior, unchanged). This is a wizard-step decision, not a new
  `leagueType` value — `roster_type` stays `custom_rosters` either way; only whether the
  baseline import ran differs (track via a boolean, e.g.
  `rec_league_configuration.custom_roster_preseeded`).

## 4. Backend — draft session API (new module: `apps/api/src/modules/fantasy-draft/`)

Endpoints (guild/league-scoped, same `requireBotOrUserSession` pattern as everything
else):

- `POST /v1/fantasy-draft/schedule` — commissioner sets `scheduled_at`. Sets session
  `status: 'scheduled'`. Drives the "main page card" showing the scheduled date/time.
- `POST /v1/fantasy-draft/commence` — commissioner/co-commissioner only
  (`assertGuildPermission(..., "co_commissioner")`). Requires the session to be
  `scheduled` (or `not_scheduled`, if Samuel wants "commence with no scheduled time" to be
  allowed — **open question 2**). Sets `status: 'live'`, `commenced_by_user_id`,
  `commenced_at`. Side effects (fire-and-forget, don't block the response):
  - post `@everyone` to the league's announcements channel (reuse
    `postDiscordChannelMessage` from `apps/api/src/lib/discord-guild.ts`, same pattern
    other announcement sends already use — check how `@everyone` mentions are
    allow-listed via `allowed_mentions` in existing Discord message helpers, since Discord
    requires explicit opt-in per message to actually ping everyone, not just include the
    text).
  - push notification via existing `apps/api/src/modules/push/push.service.ts` to all
    league members.
- `POST /v1/fantasy-draft/pick-order` — commissioner sets the 32-slot round-1 order (one
  team per `pick_in_round` 1-32). Writes `rec_fantasy_draft_pick_order`. This is the "set
  each pick # with a dropdown of all 32 teams" step, gating the actual live-picking UI
  until it's fully set.
- `POST /v1/fantasy-draft/add-custom-player` — commissioner/co-commissioner only,
  available right after pick order is set (and really any time before `concluded`).
  Routes through the **existing Custom Player Wizard**
  (`apps/web/src/components/hub/CustomPlayerWizard.tsx`) in a stripped-down mode: no coin
  cost / purchase-points flow (this isn't a store purchase, it's commissioner roster
  construction) — just position, name, jersey, archetype, and the attribute/OVR fields.
  New players get a generic silhouette placeholder image (reuse whatever default/fallback
  avatar the roster UI already shows for photo-less players — check
  `apps/web/src/components/hub/PlayerStatsModal.tsx` or roster list rendering for an
  existing pattern before inventing a new one) instead of a real photo; updatable to a
  real headshot later via the same photo-upload path custom players presumably already
  have. Inserts directly into `rec_madden_league_players` (no `baseline_player_id` — that
  FK needs to become nullable, or custom players need their own lightweight row shape;
  decide at migration time) with `team_id: null`. Supports adding multiple players in one
  sitting (wizard shouldn't force a full page reload/close between each).
- `DELETE /v1/fantasy-draft/pool/:leaguePlayerId` — "Remove Player from Draft Pool",
  commissioner/co-commissioner only. Pulls a player out of the pool entirely (not drafted,
  just gone — e.g. commissioner decides a player shouldn't be in this league's draft for
  any reason). Available throughout the live/wrap-up phases, not just pre-draft.
- `POST /v1/fantasy-draft/pick` — commissioner/co-commissioner only, live-phase: body
  `{ leaguePlayerId }`. Resolves current `(round, pick_in_round)` → team from
  `rec_fantasy_draft_pick_order` (accounting for snake reversal on even rounds if
  `order_mode: 'snake'`), inserts `rec_fantasy_draft_picks`, marks the
  `rec_madden_league_players` row drafted + `team_id`, advances
  `current_pick_in_round`/`current_round` (wrapping pick 32→1 and incrementing round).
  Broadcasts a draft-update event (see §6).
- `POST /v1/fantasy-draft/pick-wrapup` — any league member, wrap-up phase only: body
  `{ leaguePlayerId, teamId? }`. If the caller is a plain team owner, `teamId` is ignored
  and forced to their own team. If the caller is commissioner/co-commissioner, `teamId` is
  required (this is the "Add to MY team" / "Add to ANOTHER team" modal — "my team" just
  means the commissioner's own `teamId` if they own one, same endpoint either way, UI
  decides which value to send). Same effects as `/pick` but `is_wrapup_pick: true` and no
  clock-advance logic.
- `POST /v1/fantasy-draft/undo` — commissioner/co-commissioner only. Deletes the most
  recent `rec_fantasy_draft_picks` row (by `overall_pick_number desc`), un-marks the
  corresponding `rec_madden_league_players` row (`is_drafted: false, team_id: null,
  drafted_pick_id: null`), decrements the session's `current_round`/`current_pick_in_round`
  back to that pick. Callable repeatedly — "up to the last 32" in the spec just means
  repeated undo naturally covers a full round back; no special multi-undo batching needed,
  each call undoes exactly one pick.
- `POST /v1/fantasy-draft/skip-to-end` — commissioner/co-commissioner only. Sets
  `status: 'wrap_up'`. Triggers the "review your rosters in-game" pop-up for all members
  (via the same broadcast channel — client shows a dismissible modal on receipt) and makes
  every remaining undrafted `rec_madden_league_players` row's "Drafted" button visible to
  all members (not just commissioners) in the UI.
- `POST /v1/fantasy-draft/conclude` — commissioner/co-commissioner only, only valid from
  `wrap_up`. Sets `status: 'concluded'`. Every still-undrafted `rec_madden_league_players`
  row stays `team_id: null` — i.e. genuinely becomes the league's free-agent pool (no
  further action needed, "undrafted → free agency" is just "we stop touching them").
  Computes each team's roster size; if any team is under the minimum (see §7), returns a
  list of under-strength teams in the response so the frontend can show the "your team
  might not be fully assigned" modal to affected owners specifically (not everyone).
- `GET /v1/fantasy-draft/state` — full current state: session status/round/pick/team-on-
  the-clock, full player pool (with `is_drafted`/`team_id`), pick history (for undo-target
  display / a running pick log if wanted). This is what the draft card polls/refetches on
  every broadcast event.

## 5. Frontend — draft card + player pool

New component, e.g. `apps/web/src/routes/hub/FantasyDraftCard.tsx` (exported through
`packages/hub-ui` and used from `apps/site/src/routes/LeagueHub.tsx`'s buzz/home view,
same pattern as `RulesHome.tsx` added 2026-08-07).

States to render (driven by `session.status`):

- `not_scheduled` — "No fantasy draft scheduled yet." + (commissioner only) a
  date/time picker to schedule.
- `scheduled` — shows the scheduled date/time + a "Commence Draft" button
  (commissioner/co-commissioner only, others see the date/time only).
- Immediately after commence, before `pick-order` is set — a modal (commissioner only)
  walking through: pick order mode (standard/snake), then 32 dropdowns (team per pick
  slot 1-32). Nobody else sees the draft board yet.
- Right after pick order is confirmed (still commissioner-only, before the board goes
  fully live) — an optional "Add custom players to the pool?" step using the Custom
  Player Wizard flow described in §4's `add-custom-player` endpoint. Skippable; can also
  be revisited later from the live board itself (not a one-time gate).
- `live` — the main card: header = "Round {r}, Pick {p} — {team} on the clock". Below it,
  a scrollable player pool list with a **position-group sorter** (tabs or a dropdown —
  QB/HB/WR/.../K, plus "All") as the primary filter, secondary search-by-name, each row
  showing name, position, OVR, real-life team origin (context only, not functional in
  fantasy-draft leagues), archetype. Each row has a "Drafted" button and a "Remove from
  Pool" action, both visible/enabled only for commissioner/co-commissioner. Card chrome
  also has **Undo** and **Skip to End** buttons (commissioner/co-commissioner only), plus
  an entry point back into "Add custom player" from §4.
- `wrap_up` — same list, but now every member sees "Drafted" buttons (self-assign to own
  team; commissioner/co-commissioner get the "MY team / ANOTHER team" modal instead). A
  one-time dismissible pop-up ("go review your in-game roster...") fires for every member
  on transition into this state. **Conclude Draft** button appears (commissioner/
  co-commissioner only).
- `concluded` — read-only summary (maybe just collapse the card into "Fantasy draft
  complete" with a link to full results/pick history).

## 6. "Refresh only on draft actions" (Samuel's answer to the realtime question)

Don't build continuous polling. Reuse the existing chat websocket infrastructure
(`apps/web/src/lib/chat-realtime-client.ts`, already does per-tab `WebSocket` +
auto-reconnect + polling fallback) — add a new channel type (e.g. `fantasy_draft:{leagueId}`)
that the backend publishes one lightweight `{ type: "draft_updated" }` event to on every
`pick` / `pick-wrapup` / `undo` / `skip-to-end` / `conclude` call. Client-side: on receiving
that event, refetch `GET /v1/fantasy-draft/state` once (not a stream of diffs — full state
refetch is simplest and this data is small). This satisfies "refresh when an action is
taken" without building a diff-sync protocol, and falls back to the existing poll timer if
the socket is down.

## 7. Roster page — position minimums

**Dropped from scope** (Samuel: "forget about this"). Not building the `{count}/{required}`
position-card display. If revisited later, treat as a fresh ask, not a continuation of
this doc.

## 8. Photo storage — download + re-host via Cloudflare

Resolved: don't hotlink `maddenratings.com` image URLs. Download each player's photo once
at seed time and re-host in our own storage. Samuel confirmed Cloudflare is available and
should be linked — this repo already has a working Cloudflare integration to model off of
(`docs/cloudflare-highlights.md`, Cloudflare Stream for highlight clips). For static player
photos, Cloudflare Images (or an R2 bucket) is the better fit than Stream (that's
video-specific) — check what's actually provisioned on the account before assuming Images
vs. R2. Seed script downloads from the CSV's `image` URL, uploads to Cloudflare, and stores
the resulting Cloudflare-hosted URL in `rec_madden_baseline_players.photo_url` — the
original fan-site URL never gets stored or served to end users.

## 9. Open questions — resolved

Answered by Samuel 2026-08-07, recorded here so a future agent doesn't re-ask:

1. **410 unrated stub players** — excluded from the pool. Real-life cross-referencing not
   completed for all 410 (see §1) — flag to Samuel again if he wants that pursued further.
2. Commencing with no `scheduled_at` set: **allowed, but not recommended** — the UI should
   let it happen (no hard block) while nudging toward scheduling first (e.g. a confirm-step
   warning, not a disabled button).
3. ~~Position minimums~~ — dropped, see §7.
4. **Raw CSVs**: commit to the repo. **All compiled data lives in Supabase** (the
   `rec_madden_baseline_players` table from §2 *is* that storage — the CSVs are just the
   seed script's input file, not a parallel source of truth) for display on the site.
5. **Co-commissioner permission gate confirmed** — `assertGuildPermission(...,
   "co_commissioner")` is correct for every commissioner-only action in this doc.
6. **Discord `@everyone`**: fine — the bot has admin permissions globally on every linked
   server, so the `allowed_mentions` opt-in will work without a per-server permission
   check.
7. **Photo hosting**: resolved, see §8 (download + re-host via Cloudflare).

## 10. Suggested build order

1. Migration for `rec_madden_roster_datasets` / `rec_madden_baseline_players` /
   `rec_madden_league_players` (§2, first two tables only — draft-session tables come
   later since regular-rosters leagues don't need them at all).
2. Seed script (`apps/api/scripts/madden-baseline-seed.ts`) reading the committed CSVs,
   downloading + re-hosting photos to Cloudflare (§8), writing into
   `rec_madden_baseline_players`, mirroring `cfb-baseline-seed.ts`'s dedupe/checksum
   pattern.
3. Wire `regular_rosters` league creation (§3) — this alone is independently shippable
   and valuable (real rosters on league create) without any draft-tracker work. Wire the
   `custom_rosters` "pre-seed anyway?" confirmation step at the same time (same import
   path, just gated behind an extra wizard confirmation).
4. `fantasy_draft` pool creation (all `team_id: null`, §3) — also independently shippable
   (gives fantasy-draft leagues a position-grouped pool to look at) even before the
   draft-tracker UI exists.
5. Draft-session migration + API module (§4), including `add-custom-player` and the
   remove-from-pool endpoint.
6. Custom Player Wizard integration (stripped-down, no-cost mode) for the post-pick-order
   "add custom players" step.
7. Draft card UI + realtime channel (§5, §6), including the position-group sorter.
