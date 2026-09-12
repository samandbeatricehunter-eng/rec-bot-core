# Balance, Gap + Bug Audit

## Verdict

The design is structurally sound if the safeguards below are implemented. Remaining work is historical calibration, not architecture invention.

## Major risks and controls

### Player XP runaway
Risk: stat tier + percentile + splash + streak + challenge + awards + records + postseason + rivalry + Dev.

Controls:
- 5,400 regular base-game cap
- 6,600 postseason base-game cap
- 1,800 max challenge PPP
- 1,200 splash cap
- max Dev 1.15x
- 120,000 regular-season earned cap
- 150,000 full-season cap

Result: hard maximum 25 XP. PASS.

### Spending bypasses season cap
Cap uses `season_points_earned`, not balance. PASS.

### Roster-size franchise exploit
Top-five 15% Player Performance Dividend, max 2,400 FPP/game. PASS.

### Same game paid multiple ways
Intentional across separate systems, but protected by player base cap, challenge max, team game-derived FPP cap, and annual player cap. PASS.

### Dev rich-get-richer
Reduced to 1.00/1.05/1.10/1.15 and excludes major awards/records. PASS.

### Missing stats
Unavailable field never becomes zero. Redistribute Impact Score weights; disable absolute branch requiring unavailable field. PASS.

### Twitter beef fabrication
Beef requires stored social thread/story object; football claims require canonical game/stat evidence. PASS.

### False direct matchup attribution
Without direct coverage/assignment data, describe team/opponent result rather than claiming a named defender personally shut someone down. PASS.

### Player-target fatigue
Avoid consecutive ordinary weeks and >2 ordinary targets in rolling 6 weeks; strong storyline overrides only. PASS.

### Impossible Dev challenge
Thresholds opponent/player-relative; explicit Dev rule frozen. PASS, calibration required.

### Target traded/released
Pre-lock regenerate; post-lock unavailable VOID; post-start never regenerate. PASS.

### Duplicate import payout
Unique idempotency keys + evaluation source hash. PASS.

### Corrected import
Immutable reversal + corrected evaluation. PASS.

### Media Day farming
One payout-bearing gradeable commitment per advance. PASS.

### Franchise tree inflation
6,000 FPP regular game-derived cap plus conservative result rewards. Target champion 22–28 XP. PASS FOR DESIGN; historical calibration required.

### Player progression too slow by position
Need Season 1 backtest of median/P75/P90/P95/max by position. CALIBRATION REQUIRED.

### Position imbalance
Use position-specific thresholds/cohorts; no cross-position raw-stat comparison. CALIBRATION REQUIRED.

### K/P volatility
Meaningful attempt floor + small-cohort rule. PASS WITH MONITORING.

### OL gap
No individual OL performance PPP until trustworthy data exists. PASS.

### Franchise XP ownership ambiguity
Must choose whether progression follows user-owner identity or team franchise. OPEN PRODUCT DECISION.

### Trade + PPP
PPP and season cap follow league+player identity. Team dividend credits team represented in that game. PASS.

### Dev challenge overpayment
Same 600/1200/1800 challenge PPP; promotion itself is special prize. PASS.

### Rivalry stacking
Default recommendation: rivalry multiplier applies to eligible base game PPP, not normal challenge PPP. Rivalry does not multiply FPP. PASS if locked.

### Award duplication
Require one canonical award event ID. PASS if enforced.

### Historical Dev replay
Store `dev_trait_at_event`; never use current trait for old game. PASS.

## Required backtest acceptance targets

Before production lock, replay M27 Season 1 and report:
- player PPP by position
- starter median
- P75/P90/P95
- max
- count reaching 20 XP
- count reaching 25 XP cap
- franchise FPP totals
- challenge completion by tier
- PLAYER challenge share
- same-player target frequency
- Media commitment defended rate

Acceptance:
- historic player never exceeds 25 XP
- elite season usually 14–19
- average starter usually 4–8
- champion franchise generally 22–28
- typical franchise generally 10–15
- PLAYER challenge share usually 15–25% absent unusual story-heavy season
- no position group structurally starved or inflated

## Recommended locks

- 6,000 points = 1 XP
- no whole XP grants
- 5,400/6,600 player base caps
- 120k/150k player season caps
- Dev 1.00/1.05/1.10/1.15
- top-five 15% team dividend
- 2,400 dividend cap
- 6,000 regular game-derived FPP cap
- one payout Media commitment
- target fatigue
- attribution evidence rule
- immutable ledger/reversals
- no OL performance XP yet
- no rivalry multiplier on ordinary challenge rewards


## Competitive Balance Development
- [LOCK] Bottom-25% assistance max = 18,000 FPP / 3 XP per season.
- [LOCK] Bonus only applies to challenge / Media commitment developmental FPP.
- [LOCK] Does not multiply wins, awards, playoffs, upsets, Player XP or conversions.
- [BUG GUARD] Freeze strength band every four advances.
- [BUG GUARD] Assistance follows user progression identity.

## Universal Record Book
- [LOCK] Every Top-5 entry generates Media.
- [LOCK] #1 generates dedicated record-break announcement.
- [LOCK] remove combined tackles from all three scopes.
- [LOCK] no legacy box-score source dependencies.
- [OPEN VERIFY] confirm semantics of imported `tackles` before assigning a historical tackle baseline.
- [BUG GUARD] strict > #5 entry and strict > #1 break rules.
- [BUG GUARD] cache invalidated only after authoritative DB transaction succeeds.
