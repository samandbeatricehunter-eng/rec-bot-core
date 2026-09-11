# Ordinary Non-RTI Player XP Reward System

## Scope

This system applies to ordinary non-RTI roster players in Madden leagues, including stock roster players, purchased Legends and custom players unless another mode-specific rule explicitly overrides it.

Player XP belongs to:
`league + specific rec_player instance`

It is not Franchise XP and is never pooled across the roster.

The system rewards:
- strong weekly stat lines
- position-relative weekly performance
- rare splash games
- production streaks
- season production
- awards/records
- postseason performance

It uses only canonical stats actually imported into REC.

## Dev Trait earning modifier

Higher Dev Traits earn Player XP faster.

Base multiplier:
- Normal: 1.00x
- Star: 1.10x
- Superstar: 1.20x
- X-Factor: 1.30x

Apply the multiplier after raw XP for the event/week is calculated.

Keep fractional bonus remainder per player so a 10%/20%/30% modifier is not lost to integer rounding.

Example:
- Star player earns 3 raw XP
- modified = 3.3
- award 3 XP
- bank 0.3 remainder
- later awards continue from that bank

Dev multiplier is based on the effective Dev Trait at the event time, not the current trait months later.

## Weekly award structure

Player XP for a completed game is built from three buckets:

1. Weekly Stat-Line Tier
2. Position-Relative Finish
3. Splash Bonus

Raw regular-season game XP is capped at 5 before Dev/rivalry modifiers.

Postseason raw game XP cap is 6.

Awards, records and season-end bonuses are separate from the weekly cap.

A player must have meaningful participation for the relevant stat category. Empty/stat-zero reserve rows do not qualify.

### Weekly Stat-Line Tier

Only the highest tier applies.

#### QB
Use total offensive production so mobile and pocket QBs are both viable.

Good — 1 XP:
- 250+ total yards AND 2+ total TD
- no more than 2 individual giveaways

Great — 2 XP:
- 325+ total yards AND 3+ total TD
- no more than 1 giveaway

Elite — 3 XP:
- 400+ total yards AND 4+ total TD
- no more than 1 giveaway
OR
- 300+ passing yards, 3+ passing TD, 0 INT, 70%+ completion on meaningful volume

Total yards = passing + rushing.
Total TD = passing + rushing.
Giveaways = interceptions thrown + player fumbles where available.

#### HB
Good — 1 XP:
- 100+ scrimmage yards OR 80+ rushing yards + 1 TD

Great — 2 XP:
- 150+ scrimmage yards AND 1+ TD
OR
- 120+ rushing yards + 2 TD

Elite — 3 XP:
- 200+ scrimmage yards
OR
- 150+ rushing yards + 2+ TD

Scrimmage yards = rushing + receiving.

#### FB
FB thresholds are lower because volume is role-limited.

Good — 1 XP:
- 50+ scrimmage yards
OR
- 1 TD + 30+ scrimmage yards

Great — 2 XP:
- 80+ scrimmage yards + 1 TD
OR
- 2 TD

Elite — 3 XP:
- 120+ scrimmage yards
OR
- 80+ scrimmage yards + 2 TD

#### WR
Good — 1 XP:
- 75+ receiving yards
OR
- 6+ receptions + 1 TD

Great — 2 XP:
- 125+ receiving yards
OR
- 100+ receiving yards + 2 TD

Elite — 3 XP:
- 175+ receiving yards
OR
- 150+ receiving yards + 2+ TD

#### TE
Good — 1 XP:
- 60+ receiving yards
OR
- 5+ receptions + 1 TD

Great — 2 XP:
- 100+ receiving yards
OR
- 80+ receiving yards + 2 TD

Elite — 3 XP:
- 140+ receiving yards
OR
- 120+ receiving yards + 2+ TD

#### Offensive Line
REC does not currently have trustworthy individual OL box-score stats.

Do not invent pancakes/sacks-allowed per lineman.

OL uses unit-performance XP only for players who are confirmed starters/participants through an authoritative depth/participation source.

Until that source is available, OL weekly stat-line XP stays disabled rather than paying every rostered lineman automatically.

Once starter participation is reliable:

Good — 1 XP:
- team rushes for 120+ yards AND allows 3 or fewer QB sacks

Great — 2 XP:
- team rushes for 150+ yards AND allows 2 or fewer sacks

Elite — 3 XP:
- team rushes for 180+ yards AND allows 1 or fewer sacks

All qualifying starting OL receive the same tier.

#### EDGE
Good — 1 XP:
- 1+ sack
OR
- 2+ TFL
OR
- 1 forced fumble

Great — 2 XP:
- 2+ sacks
OR
- 3+ impact plays

Elite — 3 XP:
- 3+ sacks
OR
- 4+ impact plays including at least one takeaway/forced fumble

Impact plays = sacks + TFL + forced fumbles + interceptions.

#### Interior DL
Good — 1 XP:
- 1 sack
OR
- 2 TFL

Great — 2 XP:
- 2 sacks
OR
- 3+ TFL
OR
- 2+ impact plays including a forced fumble

Elite — 3 XP:
- 3 sacks
OR
- 4+ impact plays

#### OLB / ILB
Good — 1 XP:
- 7+ tackles
OR
- 1 sack + 1 TFL
OR
- 1 interception/forced fumble

Great — 2 XP:
- 10+ tackles + 1 impact play
OR
- 2+ sacks
OR
- 2 takeaways/forced fumbles

Elite — 3 XP:
- 12+ tackles + 2 impact plays
OR
- 3+ sacks
OR
- 3 turnover-impact plays

#### CB
Do not over-reward tackle volume.

Good — 1 XP:
- 1 interception
OR
- 1 forced fumble
OR
- 5+ tackles + 1 impact play

Great — 2 XP:
- 2 interceptions
OR
- 1 interception + 1 forced fumble
OR
- 2+ turnover-impact plays

Elite — 3 XP:
- 3 interceptions
OR
- 2+ takeaways plus another impact play

If a stable passes-defended stat becomes canonical, add it as a secondary coverage input without changing historical awards.

#### FS / SS
Good — 1 XP:
- 1 interception/forced fumble
OR
- 6+ tackles + 1 impact play

Great — 2 XP:
- 2 takeaways
OR
- 8+ tackles + 2 impact plays

Elite — 3 XP:
- 3 turnover-impact plays
OR
- 10+ tackles + 2 takeaways/impact plays

#### K
Good — 1 XP:
- 2+ made FGs with no miss
OR
- game-winning field goal where result context is verified

Great — 2 XP:
- 3+ made FGs with no miss
OR
- 2+ FGs including a 50+ yard make with no miss

Elite — 3 XP:
- 4+ made FGs with no miss
OR
- 3+ FGs including multiple 50+ yard makes

Use only kicking keys present in the canonical stat registry.

#### P
Good — 1 XP:
- strong weekly punting efficiency relative to league punters

Great — 2 XP:
- top-25% punting efficiency with meaningful volume

Elite — 3 XP:
- top-10% punting efficiency with meaningful volume

Punting should be primarily percentile-based because raw punt count is often a negative team-outcome signal.
Use average/net/inside-20 style fields only if they are canonical and stable.

## Position-Relative Finish

Each week, compare players only against the same REC position group with meaningful participation.

Use a position-specific Impact Score built from percentile ranks of canonical stats rather than raw Madden OVR.

Award only the highest position-relative tier:
- Top 25%: +1 raw XP
- Top 10%: +2 raw XP
- #1 weekly player at the position group: +3 raw XP

This bucket is subject to the weekly raw XP cap.

Minimum cohort:
- at least 4 qualifying players in the position group for Top 25/Top 10 logic
- if cohort is smaller, only #1 may earn +1 instead of +3

### Impact Score weighting

QB:
- 30% total yards percentile
- 25% total TD percentile
- 20% passer rating/completion efficiency
- 15% yards per attempt
- 10% turnover avoidance

HB/FB:
- 35% scrimmage yards
- 20% TD
- 15% yards per carry
- 15% broken tackles / yards after contact
- 15% receiving contribution

WR/TE:
- 40% receiving yards
- 20% receptions
- 20% TD
- 10% yards per reception
- 10% YAC / drop avoidance where stable

EDGE:
- 40% sacks
- 25% TFL
- 20% forced fumbles
- 15% tackles

Interior DL:
- 30% sacks
- 30% TFL
- 20% forced fumbles
- 20% tackles

LB:
- 30% tackles
- 20% TFL
- 20% sacks
- 15% interceptions
- 15% forced fumbles

CB:
- 45% interceptions
- 20% forced fumbles
- 15% tackles
- 20% stable coverage-disruption stat if available; otherwise redistribute across INT/FF/tackles

S:
- 35% interceptions
- 20% forced fumbles
- 25% tackles
- 20% sacks/TFL

K:
- 40% FG makes
- 30% FG percentage
- 20% long-range makes
- 10% clutch/game-winning context where verified

P:
- 40% punt average/net where available
- 35% inside-20 / placement metric
- 25% touchback avoidance / long punt as supported

OL:
- use unit-performance ranking only once starter participation is trustworthy

Every formula is versioned.

If a canonical input is missing for a season/import source, redistribute its weight proportionally across remaining supported inputs rather than treating missing as zero.

## Splash Bonuses

Rare single-game achievements.

Maximum +2 raw XP from splash bonuses per player/game.

Examples:
- QB: 5+ total TD; 450+ total yards; perfect/near-perfect efficiency on meaningful volume
- HB/FB: 200+ scrimmage yards; 3+ TD
- WR/TE: 200+ receiving yards; 3+ receiving TD
- EDGE/DL: 3+ sacks; 2 forced fumbles
- LB: 15+ tackles; 2+ takeaways; 3+ sacks
- CB/S: 2+ interceptions; 2+ forced turnovers
- K: 55+ yard make plus perfect multi-attempt game
- P: exceptional top-of-league placement/average game on meaningful volume

A splash event should be rare enough that it feels like a true headline performance.

## Production Streaks

Streaks reward repeated quality, not raw stat accumulation.

A qualifying week = player earned at least 1 Weekly Stat-Line XP before modifiers.

One-time threshold awards per season:
- 3 straight qualifying games: +1 raw XP
- 5 straight: +2 raw XP
- 8 straight: +3 raw XP

A streak can continue through bye weeks without breaking.

A game in which the player did not meaningfully participate does not automatically break the streak if inactive/bye status is verified; otherwise it does.

Do not re-award the same threshold repeatedly during one streak.

## Season Milestones

At end of regular season, calculate position-relative season results with minimum workload.

Only highest percentile tier applies:
- Top 25% at position: +2 raw XP
- Top 10%: +4 raw XP
- #1 at position group: +6 raw XP

Season Impact Score uses the same stat families as weekly scoring but on season aggregates.

Additional production milestone:
- if player reaches a historically strong volume threshold for that position but misses the percentile bonus because of unusually strong league competition: +1 to +3 raw XP from a versioned milestone table

Do not double-pay an equivalent milestone and percentile award for the same achievement unless explicitly defined.

## Awards and Records

Separate from weekly cap:
- Player of the Week: +2 raw XP
- Position/league weekly award if distinct from POTW: +1
- Pro Bowl / All-REC equivalent: +3
- position season award: +4
- OPOY / DPOY: +6
- MVP: +8
- league record set/broken: +3
- major all-time REC record: +5

One source event = one ledger event.

## Postseason

Postseason games use the same position rules.

Add:
- playoff game raw cap = 6
- conference championship qualifying stat-line performance: +1 extra raw XP
- Super Bowl qualifying stat-line performance: +2 extra raw XP
- Super Bowl MVP: +4 extra raw XP

Do not stack a generic championship participation bonus onto every player. XP remains performance-driven.

## Rivalry Interaction

Selected non-RTI rivalry games already use a +25% eligible rivalry reward modifier.

Player XP from weekly game performance is eligible.

Order:
1. calculate weekly raw Player XP
2. apply Dev Trait multiplier
3. apply other approved progression modifiers
4. apply rivalry +25% when eligible
5. add fractional remainder
6. floor to integer awarded XP
7. bank remainder
8. write one or more idempotent ledger events with source breakdown

Do not multiply season awards/records with rivalry bonuses.

## Anti-Farming / Fairness

### One verified game
XP is awarded only from a finalized canonical game/import.

### No team-stat leakage
Except explicitly defined OL unit XP, every player award uses that player's imported stat row.

### No double-counting categories
Weekly Stat-Line tier is mutually exclusive.
Position-relative tier is mutually exclusive.
Splash is capped.
Streak thresholds are one-time.
Season percentile is mutually exclusive.

### Minimum workload
Efficiency-only metrics require meaningful volume.

Examples:
- QB efficiency requires a minimum pass-attempt threshold
- WR/TE YPR requires minimum receptions
- K accuracy requires multiple attempts or defined clutch context
- P efficiency requires multiple punts

The exact workload values live in versioned config.

### Stat corrections
If a game result/stat import is corrected:
- reverse affected XP ledger events
- recompute deterministically
- preserve audit trail

### Trades
Player XP follows the player within the same REC league.

A traded player does not lose earned XP.

### Release / re-sign
XP remains attached to the league-player identity while the player remains the same canonical imported player.

## Expected Progression Pace

Target ordinary productive starter:
- roughly 8–14 awarded Player XP in a normal regular season before season awards

Strong/upper-tier starter:
- roughly 14–22

Elite award-level season:
- roughly 22–32

X-Factor players can reach the upper end faster because of the 1.30x modifier, but expensive high-rating upgrades keep elite players from snowballing uncontrollably.

This pace means:
- low-rated players can buy several cheap +1s
- mid-80s players generally buy 1–3 meaningful upgrades per strong season
- 90+ players progress slowly
- 98 → 99 remains a major investment

## Data model

`rec_player_xp_ledger`
- id
- league_id
- player_id
- credited_to_user_id
- season_id
- week_number
- event_type
- source_id
- raw_xp
- dev_trait_at_event
- dev_multiplier
- rivalry_multiplier
- other_multiplier
- awarded_xp
- remainder_before
- remainder_after
- formula_version
- idempotency_key
- metadata
- created_at

`rec_player_xp_state`
- league_id
- player_id
- balance_xp
- lifetime_earned_xp
- lifetime_spent_xp
- fractional_remainder
- last_award_at
- updated_at

The ledger is authoritative.
State may be rebuilt from the ledger.

## UI

Roster mini card:
- Player XP icon
- current available XP
- progress/state to next legal upgrade
- recent gain indicator after Advance

Expanded player card:
- XP available
- this season earned XP
- latest XP events
- `Spend Player XP` from Attributes page

Optional XP detail drawer:
- Week 6: Great Stat Line +2
- Week 6: Top 10% LB +2
- Star Dev Bonus +0.4 remainder
- Rivalry Bonus +1
- Total awarded: 5 XP

Keep member-facing wording simple.
