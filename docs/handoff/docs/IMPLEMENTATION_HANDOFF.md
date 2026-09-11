# Implementation Handoff

## Working baseline
Repository:
`samandbeatricehunter-eng/rec-bot-core`

Branch:
`main`

Baseline reviewed:
`bc8ac6e90888c22df5ef10513dcc6cb28211ba77`

Before each phase:
- pull current main
- inspect current commit/history because implementation may continue independently
- inspect `git status`
- do not assume this baseline is still HEAD

## Build/check workflow
Build shared first:

`pnpm --filter @rec/shared build`

Typecheck:
- `pnpm --filter @rec/api exec tsc --noEmit -p .`
- `pnpm --filter @rec/bot exec tsc --noEmit -p .`
- `pnpm --filter @rec/web exec tsc --noEmit -p .`
- `pnpm --filter @rec/site exec tsc --noEmit -p .`

Stage explicit files only.

Never use `git add -A` in a dirty working tree.

Structural UI changes require mockup/owner signoff before implementation.

Public DB tables require an explicit RLS decision.

Every migration gets a matching SQL migration under `supabase/migrations/`.

Update typed DB schema whenever new query columns are added.

## Implementation phases

### Phase 1 — Foundation cleanup
- final CFB dependency scan
- remove REC Rules-channel setup/API/DB/public-post path
- single shared Discord command manifest
- remove deprecated command registrations/handlers
- remove stale Coin attribute purchase path
- verify route-channel source of truth
- resolve unused snapshot/raw-data tables
- asset/dependency cleanup

Acceptance:
- clean build/typecheck
- linked/unlinked Discord command-set tests
- no CFB route/import/store path reachable
- `/rules` ephemeral without channel dependency

### Phase 2 — EA scheduler and canonical snapshots
- always-on four-hour sync
- DB due-time claiming
- per-league lock
- sync run observability
- complete dataset validation
- first-import REC stat baseline
- before/after roster state
- Persona raw-key diagnostics
- preserve `playerSchemeOvr`

Acceptance:
- retry/restart test
- partial import produces no downstream rewards
- same sync cannot double-trigger events
- current roster OVR uses `playerBestOvr`

### Phase 3 — Ledgers, Weekly Transactions and Ways to Get Paid
- global Coin wallet/source ledger
- Savings interest idempotency
- salary/reward rules
- Franchise XP ledger + DP remainder
- separate Player XP ledger
- Weekly Transactions embed
- Ways to Get Paid persistent content
- economy telemetry/replay tooling

Implement ordinary-player XP earning from `PLAYER_XP_REWARDS.md`; no separate earning-table release gate remains.

### Phase 4 — Matchup / scheduling / Discord experience
- canonical matchup read model
- visual matchup card renderer
- Matchup Breakdown
- Matchup Tracker / Force Home-Away
- persistent scheduling/gameday panel
- `/matchup` integration
- `/schedule`
- standings advance renderer + `/standings`
- `/league`, `/teams`, `/wallet`, `/profile`, `/rules`, `/highlights`
- `/commishtools`
- unlinked `/linkleague`

Acceptance:
- one `game_id` across surfaces
- no duplicated scheduler
- timezone tests
- response-clock tests
- standings snapshot retry
- image rendering QA

### Phase 5 — Pending Items and manual Madden lifecycle
- shared status lifecycle
- commissioner apply screens
- Persona DNA toggles
- Legend replacement selector
- one-time OVR capture
- one-time Head # capture
- attribute-upgrade Pending Item
- EA verification/mismatch

Acceptance:
- current in-flight items grandfather safely
- no duplicate debit
- replacement server-revalidated
- concurrent Legend first-capture conflict test

### Phase 6 — Progression and roster/player UI
- config-driven six-department non-RTI tree
- RTI tree integration
- Dev opportunities
- Ability Lab slot truth
- compact roster read model
- universal player detail aggregate
- Player XP mini-card display
- Spend Player XP modal
- REC career stat baseline/delta views

Before enabling non-RTI tree:
- fill exact node XP cost map

### Phase 7 — Compliance and rivalries
- universal roster/progression compliance
- historical entitlement
- roster-dumping score
- permanent rivalry/history + seasonal selections
- rivalry reward multipliers
- fractional RTI remainder
- Rivalry Heat
- player beef integration
- correction/replay reward reversal tests

### Phase 8 — Media, Tweets and highlights
- social event graph
- semantic repetition/fatigue
- Persona-driven player behavior
- pregame beef escalation
- Tweets-channel capture
- commissioner `/tweets`
- dedicated Highlight Reel viewer
- fixed 10-second trim/preview UI
- weekly multipart reel worker
- scoreboard overlay
- Highlights-channel delivery
- 10 MB derivative target

Acceptance:
- no unsupported factual claims
- root-before-reply
- reel job idempotency/retry
- Part 1-only mass ping
- score overlay from final canonical game
- web master preserved

### Phase 9 — Legend catalog production pass
- player-by-player evidence completion
- abilities/Persona/Mindset/Traits review
- peak-version consistency
- catalog readiness flags
- storefront ingestion
- one-time capture fields linked to catalog build version

### Phase 10 — Surface system, copy and performance
- centered content shell
- no-blur broadcast surface
- texture derivatives
- compact information density
- roster/player-card visual system
- asset overscale diagnostics
- plain-language audit
- League Hub lazy/bootstrap/cache work
- error-code diagnostics

### Phase 11 — Final sweep
- migrations/rehearsal
- RLS audit
- source-ledger idempotency
- regression suite
- breakpoint screenshots
- dead-code/dependency scan
- all TypeScript checks
- production feature flags/config values verified

Stop after each owner-defined phase boundary for review before continuing.
