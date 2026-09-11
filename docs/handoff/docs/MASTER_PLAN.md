# REC Leagues — Final Master Plan

## Product scope

REC Leagues is a Madden-first league-management ecosystem spanning the public website, authenticated League Hub, Discord bot, Madden EA data connection, economy/progression, media simulation and Rise to Immortality.

Active league-management functionality is Madden-only.

Keep a neutral college/team reference catalog for Madden player creation, hometown/college selectors and RTI workflows. Do not keep college-football league modes, recruiting, transfer portal, CFP/Heisman, college imports, college store paths, college-only setup branches or college-only tests.

## System principles

### One source of truth per domain
- Madden imported roster/game state comes from the EA connection and normalized REC tables.
- Coins and every XP family use append-only, source-aware, idempotent ledgers.
- Matchup facts use one canonical `game_id` read model shared by site, Discord and renderers.
- Public rules use one presentation model shared by site and `/rules`.
- Discord slash-command registration uses one shared manifest.
- Player-card detail uses one aggregate read model.
- Media facts are stored separately from Persona/style interpretation.

### Madden remains authoritative for Madden-only outcomes
REC must not locally calculate or backsolve player OVR.

Use the latest imported `playerBestOvr` as the authoritative Madden OVR for imported roster players. Preserve `playerSchemeOvr` separately as supplemental scheme-context data only.

For Legends, canonical Madden OVR and Head # are captured once from the commissioner after the actual build is created in Madden.

### Manual Madden changes use one lifecycle
Every REC action that requires a human to change Madden uses:

`pending_commissioner`
→ `applied_pending_verification`
→ `verified_fulfilled`

Mismatch path:

`applied_pending_verification`
→ `verification_mismatch`

The next eligible EA sync verifies what was actually changed.

### Complex work stays on the website
Discord is for fast lookup, game-channel interaction, personal status, commissioner quick actions and deep links. It should not become a duplicate management website.

## EA connection and import

Once a Madden connection is valid, franchise-bound and has completed the initial import, REC performs a full background sync every four hours until the connection becomes invalid/disconnected or the REC league becomes inactive.

There is no member-facing Auto Sync toggle.

Canonical scheduled datasets:
- teams
- standings
- schedule/results
- rosters
- free agents
- passing
- rushing
- receiving
- defense
- kicking
- punting
- team stats

Use a DB-backed due-time/claim model rather than relying only on an in-process four-hour timer.

Required observability:
- last auto-sync started
- last auto-sync completed
- next due
- consecutive failures
- latest error code/summary
- last successful dataset manifest
- last successful sync run ID

A partial import must not trigger economy, progression, media or compliance side effects.

## Roster and compliance

Each successful roster sync creates a structured before/after state sufficient to detect:
- possible trades
- releases
- signings/claims
- IR
- Practice Squad
- ability changes
- Dev Trait changes
- contract changes
- age changes
- position changes
- premium/custom/Legend movement
- suspicious roster dumping patterns

Entitlement checks use the user's historical progression/permission state at the time the change occurred.

Compliance statuses:
- Authorized
- Allowed / Untracked
- Review Required
- Likely Violation
- Confirmed Violation
- Resolved Override
- False Positive

Never auto-punish from a heuristic score. Detailed evidence is commissioner-private.

## Economy

### Coins
Coins are global to the REC user, while source attribution remains league/season aware.

Fixed premium prices:
- X-Factor Legend: 10,000
- Superstar Legend: 8,000
- Star Legend: 4,000
- Custom Player: 4,000

Planned high-impact prices:
- Age Reset (-3 years, once per player): 6,000
- Normal → Star Dev: 4,000
- Star → Superstar Dev: 7,000
- Superstar → X-Factor Dev: 12,000
- Contract restructure to $5M combined salary+bonus, same term: 12,000
- +1 contract year: 6,000
- +2 contract years: 12,000
- +3 contract years: 20,000

Savings:
- 3.5% per eligible advance
- maximum 2,500 Coins interest per advance
- idempotent
- no duplicate credits from retry

### Non-RTI weekly salary
- regular season: 250
- postseason, team no longer alive: 150 through Super Bowl week
- alive playoff team: 400
- lower-seed upset: +500
- conference-championship participant salary: 500, replacing the normal 400
- Super Bowl participant: 2,000
- Super Bowl winner: +3,000
- no offseason salary
- Revenue Sharing doubles salary only

Selected-rivalry multiplier applies only to eligible game/week earnings as defined under Rivalries.

## Progression scopes

Keep these currencies separate:
- non-RTI Franchise XP: user + league
- non-RTI Player XP: league + specific roster player
- RTI offensive Player XP: prospect-specific
- RTI defensive Player XP: prospect-specific
- RTI Owner XP: owner/franchise-specific

6,000 DP converts to 1 non-RTI Franchise XP with carry remainder.

### Non-RTI six-department tree
Departments:
- Trade Desk
- Ability Lab
- Personnel Department
- War Room
- Franchise Operations
- Training Facility

Known approved behavior that must be preserved:
- CPU trade tiers count CPU players per transaction; middle tiers allow 1 CPU player, then 2, then 3 at the top tier.
- Ability Architect permits Madden-valid ability changes subject to actual Madden slot/eligibility rules.
- Personnel premium-player caps at the final tracked tiers include:
  - 2 XF / 1 SS / 1 Star
  - 4 XF / 2 SS / 2 Star
  - 10 XF / 10 SS / 4 Star
- War Room includes the `Crown Jewel` node.
- Franchise Operations includes a 20,000-Coin EOS bonus at its intended top-end effect.
- Training Facility includes player challenge opportunities.
- Age Reset is -3 years and once per player.
- Cross-branch dependencies include Ability Lab into early Training Facility and Franchise Operations into later Training Facility.

Target full-tree cost: 133 Franchise XP.

The exact node-by-node XP-cost table is a release gate. Do not fabricate it.

### RTI trees
Player branches:
- Craft
- Development
- Ability Mastery
- Team Impact

Player branch node costs:
- 2 / 4 / 6 / 9
- 21 XP per branch
- 84 XP for all four branches

Owner branches:
- Front Office
- Player Development
- Contract & Player Relations
- Franchise Culture

Owner node costs:
- 12 / 20 / 30 / 45
- 428 XP for the four branches
- owner capstone: 60 XP and requires Tier 3 in any three branches

Natural Characteristics remain Origins DNA, not career nodes.

## Player XP and attribute upgrades

Attribute +1 cost curve:
- below 70: 2 XP
- 70–79: 3 XP
- 80–84: 5 XP
- 85–89: 8 XP
- 90–94: 12 XP
- 95–97: 18 XP
- 98 → 99: 30 XP
- 99: unavailable

Post-draft XP-cost discounts may stack only to a combined 35% maximum. This preserves effective high-rating floors of roughly:
- 85–89: 5 XP
- 90–94: 8 XP
- 95–97: 12 XP
- 98 → 99: 20 XP

The server/shared pricing function is authoritative. UI never owns the formula.

Ordinary non-RTI Player XP earning rules are fully defined in `PLAYER_XP_REWARDS.md`.

Core earning sources:
- weekly position-appropriate stat-line tiers
- same-position weekly percentile performance
- rare splash performances
- production streaks
- season percentile/milestone production
- awards, records and postseason performance

Dev Trait earning multipliers:
- Normal 1.00x
- Star 1.10x
- Superstar 1.20x
- X-Factor 1.30x

General Franchise DP never silently becomes Player XP.

### Dev ceiling
Use latest verified Madden OVR at batch start.

If current verified OVR is at/above the player's current Dev ceiling, no new attribute batch can begin.

REC never predicts the resulting OVR.

Only one unresolved upgrade batch may exist per player.

To reduce overshoot risk without pretending to calculate OVR, cap the total queued +1 increments in one batch to:

`min(10, max(1, dev_ceiling - verified_ovr))`

If the applied Madden changes later move OVR above the ceiling, do not roll them back. Block later batches until Dev improves.

## Universal roster/player experience

Roster overview:
- compact cards grouped by position
- headshot
- name / position
- OVR
- Dev Trait
- Legend / Custom / RTI badge where relevant
- Player XP icon/counter
- progress/state toward next legal upgrade
- top three meaningful attributes

Opening a player uses one universal card style and ordered pages:
1. Overview
2. Attributes
3. Player Profile
4. Persona & Traits
5. Abilities
6. Contract
7. Season Stats
8. Career in REC

Career in REC begins at REC tracking start, not the player's real-world career.

At the first successful league import, store cumulative stat baselines where needed so later career totals can subtract any pre-REC Madden totals. Trades within the same REC league remain part of the same REC career.

The Attributes page has `Spend Player XP`.
The modal supports a legal queued batch, shows sequential XP costs, submits atomically, debits XP once and creates one Pending Item.

## Legends

The Legend catalog is evidence-first.

Evidence hierarchy:
- A: verified combine/pro-day/high-authority measurable/fact
- B: documented workout/team timing/strong report
- C: credible historical estimate plus film/scouting
- D: self-reported or weakly sourced claim
- P: fictional/crossover projection

Do not inflate physical ratings because of Dev Trait, archetype or reputation.

Real-player Persona DNA is a REC football-facing simulation profile based only on public football behavior, interviews, teammate/coach reporting and documented career tendencies. It is not a private psychological claim.

Every production Legend requires:
- identity / biography
- peak-version definition
- body profile
- archetype
- throwing motion where applicable
- 54 attributes
- Dev Trait
- X-Factor / Superstar abilities
- Persona DNA
- Mindset Focus
- Player Traits
- headshot/head mapping policy
- source/evidence metadata
- canonical Madden OVR capture state
- canonical Madden Head # capture state

The catalog baseline currently contains 486 tiered players. A smaller owner-reviewed subset has received direct player-specific evidence approval; the remaining rows still need player-by-player source verification before being labeled fully production-ready.

### One-time OVR and Head # capture
For new Legend Pending Items after launch:

If canonical OVR is unknown:
- required `In-game OVR`

If canonical Head # is unknown:
- required `In-game Head #`

Once a field is captured for that Legend build, it becomes read-only and disappears from later creation forms.

Do not treat an imported workbook value as "captured" unless its source is explicitly marked as verified from an actual Madden build.

Build-version changes can intentionally reset OVR and/or Head # capture.

### Replacement player
The outgoing roster player is purchase-instance data only.

Every purchase requires a fresh commissioner selection from the eligible active roster.

Exclude:
- IR
- Practice Squad
- free agents/released/transferred-out players
- hidden/protected players
- incoming player
- protected RTI Immortals

Never store the replacement target permanently on the Legend catalog.

## Persona DNA compatibility

Compatibility states:
- Known Compatible
- Known Incompatible
- Unknown

Only observed/repeatable Madden behavior or authoritative EA data may create a hard incompatibility.

Semantic opposites can generate a soft warning, never a hard lock by themselves.

Commissioner Pending Items record exactly which requested DNA traits were successfully applied.

Unexpected Madden locks create compatibility observations so the shared catalog improves over time.

Temporary Madden Persona DNA is not imported unless a stable EA field is discovered and verified. REC may have its own storyline mood/confidence layer, but it must never label that as Madden temporary DNA.

## Rivalries

Permanent franchise rivalry history is separate from seasonal selections.

Default maximum:
- 2 selected rivals per team per season

Mutual selection creates one pair and never double-stacks rewards.

Non-RTI selected rivalry:
- +25% on explicitly eligible game/week salary, DP and engagement earnings

RTI selected rivalry:
- +10% on explicitly eligible Player XP, Owner XP and game-linked engagement
- no salary bonus

RTI fractional rivalry XP uses a remainder bank so small bonuses accumulate rather than disappear to rounding.

Rivalry Heat:
- 0–100
- media/presentation/GOTW input only
- never changes economic multiplier size

Player beef is separate from franchise rivalry.

Highly competitive/outspoken player pairs may sustain multi-week beef, with probability and intensity increasing in the one-to-three weeks before a scheduled matchup.

## Media and Tweets

Use an event-driven social graph rather than a template queue.

Events include:
- game result
- upset
- rivalry
- major performance
- poor performance
- trade/release/signing/IR
- contract
- ability/Dev/role change
- milestone/record
- playoff clinch/elimination
- Media Day statement
- user-authored tweet

Account behavior depends on:
- account role/interests
- relevance/controversy
- Persona DNA
- rivalry/storyline memory
- novelty/fatigue
- realistic timing

300 posts per league week/stage is a hard maximum, not a target.

Templates are best for official/wire/stat posts. Personalities, players and fans use verified facts + voice + thread history + Persona.

No fabricated private conflict, injury intent, trade demand, criminal/off-field conduct or unsupported defender-specific attribution.

### User Tweets channel
Human message in configured Tweets channel:
- capture raw message
- remove original from public channel
- 90-second public Yes/No confirmation gated to source user
- non-RTI Yes publishes as team/org
- RTI Yes opens ephemeral Offensive Prospect / Owner / Defensive Prospect selection
- timeout/No purges candidate
- confirmed tweet becomes a canonical root eligible for replies, quotes, receipts and future callbacks

No user `/twitter` command.

Commissioner `/tweets` remains for controlled media publishing.

## Weekly Highlight Reel

`/highlights` is website-first.

Buttons:
- Upload Highlight
- View Highlight Reel

The dedicated league Highlight Reel page stores the full approved source clips and weekly reel archive.

### Weekly Discord reels
Expected healthy week:
- 6–10 uploads
- source clips often 30–45 seconds

Discord uses a fixed 10-second reel cut per approved clip.

Default trim:
- last 10 seconds of the source

Commissioner approval UI:
- video player
- play/pause
- scrubber
- current time
- fixed 10-second draggable timeline window
- live start/end values
- `Preview Selection`
- playback automatically stops at selected end
- `Use Last 10 Seconds`
- save/approve controls

If source is under 10 seconds, use the full source and flag the short duration.

Maximum 10 clips per reel part:
- 1–10: one reel
- 11–20: Part 1 / Part 2
- continue in 10-clip chunks

Only Part 1 sends the weekly `@everyone` ping. Later parts post immediately after without repeated mass pings.

Each part targets about 9.5 MB and must finish at or under 10 MB when quality remains acceptable.

Preferred encode:
- H.264 MP4
- AAC 64–96 kbps
- 30 fps
- 720p first
- adaptive fallback to lower bitrate, 540p, then 480p if needed
- fast-start enabled

Keep a higher-quality Cloudflare/web master separately.

### Per-clip score header
Every 10-second segment gets a compact top broadcast strip:
- away team name over away final score
- home team name over home final score

Use the canonical final game result, not user-entered score metadata.

Header:
- top 8–12% safe area
- dark navy/charcoal
- restrained metallic separator
- white team/score type
- limited REC red accent
- no blur
- legible without obstructing play

Reel rendering occurs asynchronously after Advance and never blocks the Advance itself.

Destination:
- configured Highlights channel

If the bot lacks `@everyone` permission, post without the mass mention and log a commissioner-visible delivery warning.

## Matchups and scheduling

The canonical matchup ecosystem has distinct surfaces:

- Matchup Card: compact visual facts/projections
- Matchup Breakdown: weekly analytical/pregame editorial content
- Scheduling Panel: availability/time/lifecycle controls
- Matchup Tracker: commissioner operational state and Force Home/Away
- `/matchup`: portable shortcut into the same game

One `game_id` and one matchup read model power all of them.

The visual card may show:
- week
- teams/logos
- records
- predicted favorite/spread
- playoff odds
- rivalry/GOTW treatment
- scheduling status where appropriate

Do not put article-length analysis into the visual card.

### Availability
Recurring weekly availability and this-week overrides use one wizard.

Availability is surfaced through `/matchup` and the persistent game-channel scheduling panel. There is no standalone `/availability` command.

Scheduling:
- timezone aware
- shared-window suggestions
- propose
- accept
- counter
- custom time
- reschedule
- Can't Make Game
- violation reporting
- game-start/game-over lifecycle
- opponent tagging starts the response clock where configured

## Discord commands

One shared command manifest generates both bot and API registration JSON.

Linked-league member commands:
- `/league`
- `/teams`
- `/matchup`
- `/schedule`
- `/standings`
- `/powerrankings`
- `/wallet`
- `/rules`
- `/highlights`
- `/profile`

Commissioner:
- `/commishtools`
- `/tweets`

Unlinked/setup guild:
- `/linkleague`

Do not register:
- `/twitter`
- `/availability`
- `/draft`
- `/openteams`
- `/viewleague`

Do not revive a nested `/menu` shadow website.

### `/standings`
After each successful Advance, render and store an immutable official standings image snapshot.

`/standings` returns the latest completed-advance image ephemerally so the user can open it full-size.

Use the same standings read model as the website.

### `/rules`
Ephemeral only.

Public groups:
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

There is no dedicated REC Rules channel and no `Post Publicly` action.

Remove REC `rules_channel_id` / `rulesChannelId` setup/database wiring after dependency scan.

Discord's native Community-server `guild.rulesChannelId` is unrelated and must not be removed.

## Weekly Transactions and Ways to Get Paid

Weekly Transactions:
- one team-oriented embed per Advance
- summarizes prior-week Coin/XP transaction activity
- includes relevant pending-purchase line
- does not publish wallet balances
- source-aware and idempotent

Ways to Get Paid:
- persistent instructional embeds for enabled earning/purchase systems
- publish when the route/channel becomes available
- edit in place when settings change
- RTI/non-RTI wording must be accurate
- do not duplicate unrelated content into the channel

## UI design

Canonical visual direction:

**cinematic football background + dark navy/charcoal textured cards + restrained metallic borders + REC red interaction/status accent + white typography + no blur**

No glassmorphism on primary content.

Ordinary cards live inside a centered content shell:
- desktop max width around 1380–1440 px
- visible margins
- laptop gutters around 16–32 px
- mobile gutters around 12 px

Cards must not stretch edge-to-edge simply because the viewport is wide.

Large screens should gain:
- columns
- larger appropriate visuals
- secondary information
- tighter empty-space ratios

Do not leave mobile-sized content floating inside giant desktop cards.

### Texture
The supplied texture is a material reference, not a full-panel bitmap.

Never stretch a small raster texture to `100% 100%` over a large card.

Use:
- seamless or high-resolution derivatives
- bounded/native-scale tiling
- dark overlay
- responsive AVIF/WebP where appropriate

Warn in dev tooling when a raster asset is rendered above roughly 1.5× its effective source resolution.

## Performance and assets

Headshots already stored on Cloudflare are not a current re-sourcing project.

Move/keep heavy backgrounds, reel videos and large binaries on Cloudflare/R2/CDN.

Use responsive derivatives for:
- page backgrounds
- card textures
- large promotional imagery

League Hub:
- lazy-load destination surfaces
- use aggregate bootstrap DTO for shell data
- cache by league/season/week
- cancel stale requests
- avoid heavyweight `select("*")` player lists
- fetch compact roster mini-card data first
- fetch full player aggregate only when card opens

## User-facing language and errors

Copy must be:
- plain English
- concise
- football-aware
- neutral
- specific about next steps
- free of raw enums/API/database jargon

Every error should tell the user:
1. what failed
2. whether data/Coins/XP changed
3. what to do next

Use reportable REC error codes while keeping stack traces/internal diagnostics commissioner-side.

## Release requirements

Before enabling a feature family:
- migrations rehearsed
- RLS decision explicit
- idempotency/retry tests pass
- shared package builds
- API/bot/web/site TypeScript checks pass
- user-facing copy reviewed
- mobile/tablet/laptop/desktop visual checks pass where relevant
- no stale CFB/deprecated-command/rules-channel dependency remains
