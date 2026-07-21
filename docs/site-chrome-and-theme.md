# Site Chrome + Theme

Locked decisions for `apps/site` navigation and theming (updated 2026-07-21).

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

## Main Hub bottom nav (L → R)

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

## League-context bottom nav (league selected)

| Item | Route / action |
| ---- | -------------- |
| Campus Buzz | `/l/:leagueId/buzz` |
| Matchups | `/l/:leagueId/matchups` |
| My Team | `/l/:leagueId/team` |
| Store | `/l/:leagueId/store` |
| Retire (non-commissioner) | Confirm dialog → `POST /v1/site-leagues/retire` |
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

| Concern | Behavior |
| ------- | -------- |
| Member notifications | `rec_site_notifications` rows → **Updates** section |
| Commissioner items | Pending `rec_commissioners_inbox` for leagues where the user is commissioner → **Commissioner** section |
| Copy style | Human sentences, e.g. `Georgia Dynasty has advanced` or `Alex has submitted a stream in REC OG` |
| Deep links | Advance-style → `/l/:leagueId/matchups`; review-queue (stream, box score, etc.) → `/l/:leagueId/mgmt/inbox` |
| Inbox link | Commissioner section always includes **Open {league} commissioner inbox** |

**Important distinction:** This bell is **not** the Commissioners Office notification
control in `apps/web` League Mgmt. That Office control still opens the review inbox UI
there. On site, the bell only **summarizes** and deep-links into
`/l/:leagueId/mgmt/inbox`. League Mgmt remains a separate destination for tools
(retire as commissioner, demotion request, ownership transfer).

API:

- `POST /v1/site-notifications/list`
- `POST /v1/site-notifications/mark-read` (site notification UUIDs only; synthetic
  commissioner ids are navigation-only)

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
(`co_commissioner`+) via the server↔league link (same as inbox).

**Product direction (locked for later):**

- League **creator** is the **primary commissioner** by default.
- Future: resign as head commissioner and **pass ownership** to another user in the DB.
- **League Mgmt** will contain:
  - Retire for commissioners
  - Request demotion to member
  - Primary-commissioner transfer UI

Until those tools ship, non-commissioners use Retire on the bottom nav; commissioners
use the League Mgmt placeholder.

## Implementation map

| Area | Path |
| ---- | ---- |
| API list / retire | `apps/api/src/modules/site-leagues/` |
| Site notifications | `apps/api/src/modules/site-notifications/` |
| Hub scope + league load | `apps/site/src/lib/hub-context.tsx` |
| Theme | `apps/site/src/lib/site-theme-context.tsx` |
| Shell / selector / nav / bell | `SiteShell.tsx`, `LeagueSelector.tsx`, `BottomNav.tsx`, `NotificationsBell.tsx` |
| Icons (inline SVG) | `apps/site/src/components/icons.tsx` |
| Placeholder routes | `apps/site/src/routes/placeholders.tsx` |

Related docs: [site-auth-migration.md](site-auth-migration.md),
[site-inbox-messaging.md](site-inbox-messaging.md).
