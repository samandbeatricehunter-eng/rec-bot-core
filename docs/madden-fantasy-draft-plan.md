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
  rated (name + photo only, no team/position/attributes). **Excluded from the pool** —
  see open question 1 on what (if anything) to do with these.

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
- `leagueType === "custom_rosters"`: no baseline import at all (existing behavior —
  commissioner builds rosters manually, unchanged).

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
- `live` — the main card: header = "Round {r}, Pick {p} — {team} on the clock". Below it,
  a scrollable, sortable/filterable (by position, search-by-name) list of every
  undrafted `rec_madden_league_players` row (name, position, OVR, team origin if regular-
  roster-flavored data still shown for context, archetype). Each row has a "Drafted"
  button, visible/enabled only for commissioner/co-commissioner. Card chrome also has
  **Undo** and **Skip to End** buttons (commissioner/co-commissioner only).
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

Samuel wants each position card on the roster page to show `current/required`, e.g.
"HB 2/3". **Open question 3**: I don't have a confirmed source for what those per-position
minimum counts should be for a 53-man Madden roster — need Samuel to give me the actual
numbers (or confirm using Madden's own in-game "minimum roster requirements" screen,
which I can't access — a screenshot from Samuel's game would be authoritative) before this
part can be built. Don't guess and hardcode invented numbers here.

Once we have real numbers: extend `apps/web/src/routes/roster/RosterHome.tsx`'s existing
`hub-roster-grade-grid` cards (already touched 2026-08-07 for grade-color contrast) to
also render `{count}/{required}` per `positionGroups` entry, sourced from a new constant
(e.g. `MADDEN_POSITION_MINIMUMS` in `@rec/shared`) compared against the league's actual
roster counts.

## 8. Open questions (need Samuel's answer before/while implementing)

1. **The 410 unrated stub players** — fully exclude from the pool (current plan), or
   include as zero-attribute placeholder entries some other way? Leaning exclude since
   they'd be undraftable dead weight, but confirm.
2. Can a commissioner **commence** a draft with no `scheduled_at` set at all, or must
   scheduling happen first?
3. **Position minimums** for the roster-page position cards (§7) — need real numbers.
4. Where should the **raw scraped CSVs** live — committed to the repo (under
   `apps/api/scripts/data/`), or kept out of git and re-supplied by Samuel each time the
   seed script runs? (CFB's baseline seed script pattern pulls from a live provider API at
   seed-time rather than committing a static file — Madden's source has no API, so this
   needs a different answer.)
5. Confirm co-commissioner permission check: this plan assumes the existing
   `assertGuildPermission(..., "co_commissioner")` (in `apps/api/src/lib/user-auth.ts`)
   is the right gate for every "commish or co-commish" action listed above — same check
   used elsewhere in League Mgmt.
6. Discord `@everyone` mention on commence — needs `allowed_mentions: { parse: ["everyone"] }`
   (or equivalent) explicitly set on that Discord API call, since Discord silently no-ops
   `@everyone` text otherwise. Confirm the bot's role actually has "Mention @everyone"
   permission in servers using this — if not, this step needs a fallback (e.g. a normal
   ping to commissioners only, or a loud embed without the literal mention).
7. **Photo re-hosting**: do we want to hotlink `maddenratings.com` image URLs directly in
   the product (fragile — their site, their bandwidth, could break/rate-limit/change URLs
   any time), or download + re-host them in our own storage (Supabase Storage / Cloudflare)
   once, at seed time? Recommend the latter for anything user-facing in production; the
   CSV of URLs handed to Samuel is the input to that re-hosting step, not the final asset
   pipeline.

## 9. Suggested build order

1. Migration for `rec_madden_roster_datasets` / `rec_madden_baseline_players` /
   `rec_madden_league_players` (§2, first two tables only — draft-session tables come
   later since regular-rosters leagues don't need them at all).
2. Seed script (`apps/api/scripts/madden-baseline-seed.ts`) reading the CSVs into
   `rec_madden_baseline_players`, mirroring `cfb-baseline-seed.ts`'s dedupe/checksum
   pattern.
3. Wire `regular_rosters` league creation (§3) — this alone is independently shippable
   and valuable (real rosters on league create) without any draft-tracker work.
4. `custom_rosters`/`fantasy_draft` pool creation (all `team_id: null`, §3) — also
   independently shippable (gives fantasy-draft leagues a position-grouped pool to look
   at) even before the draft-tracker UI exists.
5. Draft-session migration + API module (§4).
6. Draft card UI + realtime channel (§5, §6).
7. Roster position-minimums display (§7) — blocked on open question 3.
