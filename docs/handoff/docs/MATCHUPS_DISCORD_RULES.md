# Matchups, Discord and Rules

## Shared command manifest
One JSON-compatible manifest in the shared package owns:
- name
- description
- audience
- options
- registration condition
- feature flag
- handler key
- website deep-link capability

Bot and API both render Discord registration from this manifest.

Tests ensure:
- every command has a handler
- every handler has a manifest record
- generated registration JSON matches
- removed commands cannot reappear from a second registrar

## Member commands

### `/league`
Compact league state:
- league
- season/week/stage
- advance status
- GOTW
- leaders
- EA sync health summary

Deep links:
- Overview
- News
- Matchups
- Standings
- Stats

### `/teams`
Team directory:
- conference grouping
- claimed/open state
- owner
- record/OVR where appropriate

Actions:
- Open Teams
- Request Team
- Waitlist
- View Rosters

### `/matchup`
Portable current-game entry.

Show:
- canonical matchup image
- compact scheduling state
- confirmed time in viewer timezone
- waiting-on-you/opponent status
- result when complete

Outside game channel:
- Open Game Channel
- Open Matchup on REC
- Scheduling
- Rules

Inside game channel:
- do not duplicate the persistent scheduling panel

Scheduling action reuses the existing unified flow.

### `/schedule`
Read-only quick season view.
Defaults to user's team.

Show current/next games, result, scheduled kickoff, rivalry/GOTW markers.

Deep links to full schedule.

### `/standings`
Ephemeral latest official completed-advance image snapshot.

Image includes:
- AFC/NFC
- seeds
- records
- division leaders
- playoff cutoff
- clinch markers
- logos
- week/stage

Dedicated renderer, not browser screenshot.

Store immutable metadata with advance/run ID and renderer version.

### `/powerrankings`
Ephemeral.
Show rank, movement, record, rating/score and brief stored rationale.

### `/wallet`
Ephemeral.
Show:
- available Coins
- Savings
- projected capped interest
- pending debits
- recent ledger activity
- relevant progression summary

Deep links to Wallet / Store / Transactions / Progression.

### `/rules`
Ephemeral.
No public posting button.
No Rules-channel dependency.

### `/highlights`
Ephemeral.
Show week/status and submission count.

Buttons:
- Upload Highlight
- View Highlight Reel

### `/profile`
Ephemeral personal summary:
- team
- record
- current matchup
- Coins/Savings
- progression
- availability completeness
- badges/RTI identities where relevant

## Commissioner commands

### `/commishtools`
First-level:
- Game Tools
- Pending Items
- EA Sync Status
- Game Day Audit
- Open League Mgmt

Game Tools includes:
- Force Win
- Fair Sim
- AutoPilot
- Suspend
- Boot
- Reset Scheduling
- matchup/game lifecycle operations

### `/tweets`
Commissioner media publishing.
Allowed identities come from canonical media-account config, not hardcoded choices.

Support:
- root
- reply
- quote
- image
- controlled custom handle for full commissioner only

## Setup command
`/linkleague` exists only when a guild has no active linked REC league.

After successful link, refresh command registration.

## No command
Do not register:
- twitter
- availability
- draft
- openteams
- viewleague
- menu tree

## Rules presentation

Public rule groups:
1. Game Settings
2. Gameplay Rules
3. Scheduling & Game Completion
4. Streaming & Highlights
5. Rosters & Player Management
6. Trades, Contracts & Transactions
7. Economy, Store & Progression
8. Rivalries & Competition
9. Postseason
10. League-Specific Rules

The website Rules page and `/rules` consume one translated presentation model.

Raw DB enum strings never appear to members.

## Rules-channel cleanup
Remove REC-specific:
- setup field
- API schema field
- DB column
- route/status UI
- public-post handler/button

Do not touch Discord's own Community-server Rules/Guidelines property.

## Matchup breakdown
One analytical breakdown per matchup/week.
Keep it separate from the compact visual card.

Ground in imported facts:
- records
- efficiency
- player/team stats actually available
- matchup history
- playoff context
- rivalry context

Do not invent unavailable stats.

## Matchup Tracker
Commissioner operational surface:
- game lifecycle
- response/scheduling state
- Force Home / Force Away
- Fair Sim
- audit trail
- repair/fallback path

## Gameday
Persistent game-channel panel is authoritative for:
- availability
- propose/counter/accept
- reschedule
- Can't Make Game
- report violation
- game started
- game over

Opponent tagging starts response clock where configured.
