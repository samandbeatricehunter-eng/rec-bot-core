# Player XP Engine

## Pipeline

`finalized import → canonical stat line → eligibility → stat tier → position finish → splash → base cap → streak/season/award events → modifiers → season ceiling → ledger`

## Meaningful participation

Initial versioned floors:

| Group | Minimum |
|---|---|
| QB | 10+ pass attempts or material rushing contribution |
| HB | 5+ carries/receptions combined |
| FB | 2+ carries/receptions combined |
| WR/TE | 2+ catches or 25+ receiving yards |
| EDGE/DL/LB/CB/S | at least one canonical defensive participation/impact stat |
| K | 1+ FG attempt |
| P | 2+ punts |
| OL | disabled until reliable starter/participation data exists |

## Weekly stat-line tier

Only highest tier pays.

### QB
- Good 1,200 PPP: 250+ total yards, 2+ total TD, ≤2 giveaways
- Great 2,400: 325+ total yards, 3+ TD, ≤1 giveaway
- Elite 3,600: 400+ total yards, 4+ TD, ≤1 giveaway
- Alternative Elite: 300+ pass yards, 3+ pass TD, 0 INT, 70%+ completion, meaningful volume

### HB
- Good 1,200: 100+ scrimmage OR 80+ rush + TD
- Great 2,400: 150+ scrimmage + TD OR 120+ rush + 2 TD
- Elite 3,600: 200+ scrimmage OR 150+ rush + 2 TD

### FB
- Good 1,200: 50+ scrimmage OR TD + 30+
- Great 2,400: 80+ + TD OR 2 TD
- Elite 3,600: 120+ OR 80+ + 2 TD

### WR
- Good 1,200: 75+ receiving OR 6+ catches + TD
- Great 2,400: 125+ OR 100+ + 2 TD
- Elite 3,600: 175+ OR 150+ + 2 TD

### TE
- Good 1,200: 60+ receiving OR 5+ catches + TD
- Great 2,400: 100+ OR 80+ + 2 TD
- Elite 3,600: 140+ OR 120+ + 2 TD

### EDGE
- Good 1,200: 1 sack OR FF OR verified equivalent
- Great 2,400: 2 sacks OR 3+ canonical impact plays
- Elite 3,600: 3 sacks OR 4+ verified impacts including takeaway/FF component

### Interior DL
- Good 1,200: 1 sack OR verified equivalent
- Great 2,400: 2 sacks OR 2+ verified impacts including FF
- Elite 3,600: 3 sacks OR 4+ verified impacts

### LB
- Good 1,200: 7+ tackles OR takeaway/FF OR verified sack-impact alternative
- Great 2,400: 10+ tackles + impact OR 2+ sacks OR 2 turnover/FF impacts
- Elite 3,600: 12+ tackles + 2 impacts OR 3+ sacks OR 3 turnover-impact plays

### CB
- Good 1,200: INT OR FF OR 5 tackles + impact
- Great 2,400: 2 INT OR INT+FF OR 2+ turnover impacts
- Elite 3,600: 3 INT OR 2+ takeaways + another verified impact

### Safety
- Good 1,200: INT/FF OR 6 tackles + impact
- Great 2,400: 2 takeaways OR 8 tackles + 2 impacts
- Elite 3,600: 3 turnover impacts OR 10 tackles + 2 impacts

### K
- Good 1,200: 2+ FG made, no miss
- Great 2,400: 3+ made no miss OR 2+ including 50+ make no miss
- Elite 3,600: 4+ made no miss OR 3+ including multiple 50+ makes

### P
Percentile-based until a better absolute standard is validated.

Any TFL-dependent branch exists only when TFL is actually available.

## Position-relative Impact Score

Highest weekly peer reward only:
- Top 25%: +600 PPP
- Top 10%: +1,200
- #1: +1,800

If cohort <4, only #1 can receive +600.

Impact Score is position-specific, versioned, canonical-stat only, and proportionally redistributes unavailable input weights.

## Splash

Each qualifying splash = +600 PPP, max +1,200/game.

Examples: 450+ QB yards, 5+ QB TD, 200+ scrimmage, 200+ receiving, 3+ TD, 3+ sacks, 2+ INT, 15+ tackles, multiple FF.

## Base-game cap

- regular season: 5,400 PPP
- postseason: 6,600 PPP

Cap covers stat tier + position finish + splash. Ledger preserves pre-cap components and credited amount.

## Streaks

A qualifying week means at least one stat-tier reward before modifiers.
- 3-game threshold: +600
- 5-game: +1,200
- 8-game: +1,800

Each pays once; byes do not break streak.

## Season position finish

- Top 25%: +1,200
- Top 10%: +2,400
- #1: +3,600

Highest only; meaningful season participation required.

## Awards / records

| Event | PPP |
|---|---:|
| POTW | 600 |
| separate weekly positional honor | 300 |
| Pro Bowl / All-REC | 1,800 |
| season position award | 2,400 |
| OPOY / DPOY | 3,600 |
| MVP | 4,800 |
| verified league record broken | 1,800 |
| major all-time REC record broken | 3,000 |
| qualifying conference title performance | 600 |
| qualifying Super Bowl performance | 1,200 |
| Super Bowl MVP | 2,400 |

A current holder row is not proof that a record-breaking event occurred.

## Dev multiplier

Recommended:
- Normal 1.00x
- Star 1.05x
- Superstar 1.10x
- X-Factor 1.15x

Apply to base game performance, player challenge PPP, and configured streak PPP. Do not multiply MVP/OPOY/DPOY/Pro Bowl/season awards/records. Use Dev Trait effective at event time.

## Rivalry multiplier

Selected rivalry: +25% to eligible game-linked PPP only.

Order:
1. raw components
2. base-game cap
3. Dev multiplier
4. approved progression modifier
5. rivalry multiplier
6. season ceiling
7. ledger credit

Do not apply rivalry multiplier to ordinary challenge PPP by default; the rivalry already influenced targeting.

## PLAYER challenge PPP

Highest tier only:
- Bronze 600
- Silver 1,200
- Gold 1,800

Outside base game cap, but counts toward annual cap. Dev promotion challenge uses same PPP; the promotion itself is the premium reward.

## Season ceilings

- regular season: 120,000 PPP = 20 XP
- full season incl postseason: 150,000 PPP = 25 XP

Store uncapped points, credited points, and suppressed-by-cap points. Spending cannot reset the season-earned counter.

## Ownership

PPP key: `league + persistent REC player instance`.

Trade within same league: PPP follows player. Broken identity mapping: hold event pending rather than guessing by name.
