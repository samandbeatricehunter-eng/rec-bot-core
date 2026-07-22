# Site Chrome + Theme

Locked decisions for `apps/site` navigation and theming (updated 2026-07-22).

## Product surface

**`apps/site` (rec-leagues.com) is the full league product** — the same capabilities as mobile, not a marketing site. Desktop browser and mobile browser/PWA use the **same app and features**, with **different layouts** (responsive / adaptive chrome). PWA "Download App" is install-to-homescreen for that same product, optionally preferring the mobile layout when `display-mode: standalone`.

## Chrome layout (responsive)

Breakpoint: `min-width: 960px` (same in `apps/site` and `apps/web`).

| Viewport | Layout |
| -------- | ------ |
| **Desktop (960px+)** | Persistent **left sidebar** with league selector + **global** nav (Home, Leagues, Headlines, Comp, My Account). When `scope.kind === 'league'`, also show the **bottom nav** with league-only items. Main Hub: sidebar only (no bottom nav). Main content gets left margin for the sidebar (~232px). |
| **Mobile (<960px)** | Unified bottom stack: league selector + nav that switches between global vs league items based on scope. No persistent sidebar. |

Notifications panel uses `position: fixed` with `z-index: 300` under the top bar so it is not covered by page cards / hub stacking contexts.

## League selector

Attached **above** the bottom nav, centered on a dark carbon-fiber bar that shares
the nav stack.

| Behavior | Detail |
| -------- | ------ |
| Default | **Main Hub** |
| Active leagues | Options show `"{league name} ({game label})"` e.g. `REC OG (CFB 27)` |
| Visual | White label text + small caret (hub-style dropdown) |
| Select league | Switches chrome to league nav + game theme; navigates to Campus Buzz |
| Select Main Hub | Restores app theme + global nav; navigates to `/home` |

Game labels:

| `game` key   | Label      |
| ------------ | ---------- |
| `cfb_27`     | CFB 27     |
| `madden_26`  | Madden 26  |
| `madden_27`  | Madden 27  |

Scope is persisted in `sessionStorage` (`rec-site-hub-scope`). League list comes from
`POST /v1/site-leagues/mine` (active team assignments for the linked site user). Each
league includes `isCommissioner` (same Discord guild `co_commissioner+` check as
`isLeagueCommissioner` in site-inbox).

## Main Hub nav (global) - mobile bottom / desktop sidebar

Icon-only unless the tab is active — then the selected tab expands to **icon + label**.

| Item | Route |
| ---- | ----- |
| Home | `/home` |
| Leagues | `/leagues` (search / manage leagues) |
| Headlines | `/headlines` (global media; formerly Media) |
| Comp | `/comp` |
| My Account | `/account` |

No bottom nav on public landing, login, or signup. Signed-in visits to `/` redirect to
`/home`.

## League-context nav (league selected) - mobile bottom / desktop bottom bar

| Item | Route / action |
| ---- | -------------- |
| Campus Buzz | `/l/:leagueId/buzz` |
| Matchups | `/l/:leagueId/matchups` |
| My Team | `/l/:leagueId/team` |
| Store | `/l/:leagueId/store` |
| Retire (non-commissioner) | Confirm dialog -> `POST /v1/site-leagues/retire` |
| League Mgmt (commissioner) | `/l/:leagueId/mgmt` |

### Retire

Confirm copy: *"Are you sure you want to retire from this league? Your team will become open."*

On confirm:

1. End the user's active team assignment (`assignment_status = unlinked`,
   `ended_at = now()`, `user_id` cleared) — team row stays; team becomes open.
2. Switch selector to Main Hub, navigate `/home`, refresh league list.

Commissioners **cannot** retire via this control — API returns 403 and tells them to use
League Mgmt.

### Matchups (future)

Rankings + Open Teams will be **tabs on the Matchups page** (not separate bottom-nav
items). Placeholder copy on the route notes this.

## Persistent notifications bell (top-right)

Always visible in the authenticated `SiteShell` top bar for every signed-in user.
Dropdown sections: **Updates** (member/regular) and **Commissioner** (only when the
user is commissioner of at least one active league).

| Concern | Behavior |
| ------- | -------- |
| Member / Updates | Rows in `rec_site_notifications` for the linked user (`kind` returned as `regular`) |
| Commissioner | Pending `rec_commissioners_inbox` for commissioner leagues (navigation summaries, not stored in `rec_site_notifications`) |
| Example copy -> deep link | `X League has advanced` -> `/l/:leagueId/matchups`; `Y submitted a stream in X` -> `/l/:leagueId/mgmt/inbox` |
| Inbox link | Each commissioner league gets a synthetic row: `Open {leagueName} commissioner inbox` (`id` `inbox-link:{leagueId}`, `isInboxLink: true`, always read) |
| Unread badge | Count of unread regular rows + pending commissioner queue items (inbox links excluded) |
| Polling | Bell refreshes on open and about every 45s while signed in |

**Site bell vs League Mgmt Office bell:** The site top-right bell is member + delineated
commissioner summaries with deep links. The `apps/web` League Mgmt `NotificationBell`
remains a **separate** control and still opens the Commissioners Office inbox UI. Do not
merge their behavior.

Writers (advance digests, friend events, etc.) insert into `rec_site_notifications`.
Regular list may be empty until those producers land — that is expected for Phase 1.

API:

- `POST /v1/site-notifications/list` -> `{ regular, commissioner, unreadCount }`
- `POST /v1/site-notifications/mark-read` `{ ids: string[] }` — **UUID ids from
  `rec_site_notifications` only**. Synthetic commissioner ids (`commish:…`,
  `inbox-link:…`) are ignored.

## Account area (not bottom-nav tabs)

**Inbox is not its own bottom-nav tab.** Account links to `/inbox` and `/friends`. Private
messaging stays under Account / future Notifications page composition; the top-right
bell is for league/app event notifications (and commissioner review summaries).

## Theme

| Scope | `data-site-theme` |
| ----- | ----------------- |
| Main Hub | `app` (carbon fiber red) |
| League | league `game` (`cfb_27` / `madden_26` / `madden_27`) |

Hooks:

- `SiteThemeProvider` / `useSiteTheme` — `apps/site/src/lib/site-theme-context.tsx`
- `useLeagueSiteTheme(game)` — set theme while a league surface is mounted
- `HubProvider` — syncs theme from selected league / Main Hub

Palette details: [theme-palettes.md](theme-palettes.md). Site tokens live in
`apps/site/src/styles/site.css`.

## Commissioner model (current + future)

**Today:** Commissioner detection reuses Discord guild permission
(`co_commissioner`+) via the server–league link (same as inbox).

**Product direction (locked for later):**

- League **creator** is the **primary commissioner** by default.
- Future: resign as head commissioner and **pass ownership** to another user in the DB.
- **League Mgmt** will contain:
  - Retire for commissioners
  - Request demotion to member
  - Primary-commissioner transfer UI

Until those tools ship, non-commissioners use Retire on the bottom nav; commissioners
use the League Mgmt placeholder.

## apps/web Discord hub (mobile)

Same chrome IA as `apps/site`, adapted for the Discord Activity / hub web app.

| Concern | Detail |
| ------- | ------ |
| Auth | Discord JWT from `/hub` link only — **no Supabase login** in `apps/web` |
| Scope storage | `sessionStorage` key `rec-web-hub-scope` (`{ kind: "main" }` \| `{ kind: "league" }`) |
| Selector options (Phase 1) | **Main Hub** + **current guild league** (`{name} ({gameLabel})` via header/hub). Session is one guild at a time (`auth.guildId`). |
| Multi-league expansion | Add `POST /v1/hub/my-leagues` listing active team-assignment leagues for this Discord user across servers; include current guild's league. Not shipped in Phase 1. |
| Main Hub nav | Home `/home`, Leagues `/leagues`, Headlines `/headlines`, Comp `/comp`, My Account `/account` (Discord session stub) |
| League nav | Campus Buzz / Matchups / My Team / Store -> `/?section=…&subTab=…` on `HubHome`; League Mgmt -> `/league-mgmt` when `canManageLeague`; else Retire |
| Retire | Confirm -> `POST /v1/hub/retire` (member session; ends active assignment, clears `user_id`; commissioners get 403) |
| Notifications | Hub routes: `HubNotificationsBell` (Updates empty for now; Commissioner section from `listCommissionerNotifications` with deep links to `/league-mgmt/notifications`). On `/league-mgmt/*` only the existing Office `NotificationBell` (no double bell). |
| Theme | Main Hub -> `data-site-theme=app` (carbon fiber); league -> existing `data-game-theme` from league game |
| Desktop chrome | Left sidebar (global + selector); league bottom bar when league scope; mobile keeps bottom stack |
| Legacy FAB | `hub-nav-toggle` / `hub-sidebar` removed when bottom chrome is present |

Implementation: `apps/web/src/lib/hub-chrome-context.tsx`, `apps/web/src/components/chrome/*`, wired in `AppShell`.

## Implementation map

| Area | Path |
| ---- | ---- |
| API list / retire (site) | `apps/api/src/modules/site-leagues/` |
| Site notifications | `apps/api/src/modules/site-notifications/` |
| Hub retire (web) | `POST /v1/hub/retire` in `apps/api/src/modules/hub/` |
| Site hub scope + league load | `apps/site/src/lib/hub-context.tsx` |
| Web hub chrome scope | `apps/web/src/lib/hub-chrome-context.tsx` |
| Theme (site) | `apps/site/src/lib/site-theme-context.tsx` |
| Shell / selector / nav / bell (site) | `SiteShell.tsx`, `LeagueSelector.tsx`, `BottomNav.tsx`, `NotificationsBell.tsx` |
| Shell / selector / nav / bell (web) | `AppShell.tsx`, `components/chrome/*` |
| Icons (site) | `apps/site/src/components/icons.tsx` |
| Placeholder routes (site) | `apps/site/src/routes/placeholders.tsx` |
| Placeholder routes (web) | `apps/web/src/routes/placeholders.tsx` |

Related docs: [site-auth-migration.md](site-auth-migration.md),
[site-inbox-messaging.md](site-inbox-messaging.md).
