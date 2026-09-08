# HOF Progress — Design Proposal

Status: **proposal, not implemented**. No code changes are included; this is for review/sign-off before anyone builds it.

## 0. What's actually there today (read this first)

Before proposing anything new, it's worth being precise about the current state, because it's more broken than "simplistic":

- `apps/web/src/routes/hub/HubHome.tsx` (~line 1838) renders a per-prospect "HOF Progress" meter on the main hub, right under the Player XP bar:
  ```tsx
  <div className="hub-rti-progress-row"><span>{side} HOF Progress</span><strong>{player.hofProgress.toFixed(1)}%</strong></div>
  <div className="hub-rti-hof-meter" role="progressbar" ... aria-valuenow={player.hofProgress}><i style={{ width: `${player.hofProgress}%` }} /></div>
  ```
- `hofProgress` is populated in `apps/api/src/modules/immortality/xp-awards.service.ts` (`loadRtiMemberGates`), which reads `rec_immortality_career_scores.career_score` and clamps it 0–100.
- `packages/shared/src/immortality/career-score.ts` already defines a full weighted formula: `production*0.30 + peakDominance*0.20 + awards*0.20 + winning*0.20 + recordsLegacy*0.10 = careerScore`, plus `immortalityScore = careerScore*0.7 + normalizedVote*0.3` (vote share from `rec_immortality_hof_votes`).
- The migration `supabase/migrations/20260828210000_rise_to_immortality.sql` already created `rec_immortality_career_scores` with exactly the columns that formula needs (`production`, `peak_dominance`, `awards`, `winning`, `records_legacy`, `career_score`, `normalized_vote`, `immortality_score`, `formula_version`).
- **Nothing in the codebase ever writes to `rec_immortality_career_scores`.** I grepped the whole repo — the only write-shaped reference is the table definition itself. `career_score` is never `INSERT`ed or `UPDATE`d anywhere, so every row is either absent or stuck at its `default 0`. That means **every player's HOF Progress bar on the hub is showing 0% today, for every league, permanently** — not a placeholder number, an always-empty one.
- The vote side is half-wired the same way: `castHallVote` (in `immortality.service.ts`, exposed at `POST /v1/immortality/hall/vote`) writes to `rec_immortality_hof_votes` and is real, gated on the league being in the `IMMORTALITY_VOTING` state — but there is no frontend anywhere in `apps/web` that calls it. There's no voting UI.
- `hof-milestones.service.ts` is a *different*, already-working feature: it posts a per-prospect "career milestones" embed to a Discord channel (career stat line + the *current team owner's* franchise W-L/playoff/Super Bowl record from `rec_league_user_records`). It doesn't touch `career_score` at all. It's a good source of real signals to reuse, not a competing scoring system.

So this isn't "improve a naive metric" — it's "finish an already-designed-but-orphaned metric, or replace it." Given the schema, the weights, and the vote-share blend were already deliberately authored to match how the rest of the game scores things (see §2), my recommendation is to **finish wiring what's there** rather than invent a parallel system, with a few corrections. Details below.

## 1. What "HOF Progress" should mean

For a custom RTI player, HOF Progress should be a rollup of **career achievement signals this app already tracks**, not new tracking machinery. Grounding pass across the codebase surfaced five buckets, all backed by real, queryable data:

### 1.1 Career production (vs. position-calibrated statistical bars)
`packages/shared/src/immortality/config/milestones_v2.json` already encodes exactly what "great career production" looks like per position, as the **career** challenge tier ladder (`minor` / `major` / `historic`), e.g. for QB:
- minor: 20,000 pass yds / 150 TD (or 15,000/120/2,000 rush)
- major: 30,000 pass yds / 250 TD
- (historic tier continues further up)

These thresholds were hand-tuned per position/side and are already the game's authoritative definition of "career milestone." Reusing them as the production scoring anchor means HOF Progress agrees with the challenge system by construction — a player who's cleared their Historic career challenge should not simultaneously show a low HOF score.

### 1.2 Peak dominance (single best season vs. season challenge tiers)
Same file's **season** tier ladder (`tier1`/`tier2`/`tier3`) defines what an elite *single season* looks like per position. Taking the player's single best season's stats against this ladder captures "how good was their peak," distinct from career accumulation — a short, brilliant career and a long, compiling one should score differently on this axis, matching how real HOF debates actually run.

### 1.3 Awards (real, already-issued hardware)
`apps/api/src/modules/league-week/eos-awards.service.ts` issues real end-of-season awards: `mvp`, `best_passing_game`, `best_rushing_game`, `best_defense` (auto, stat-driven) and `best_user_skills`, `most_heart` (poll-driven). These are keyed to the winning user/team, but a prospect can be matched to "did my owner win the award that matches my position/side this season" (QB/HB → best_passing_game/best_rushing_game, defensive side → best_defense, any side → mvp).

### 1.4 Playoff/championship success & team success while on the roster
`rec_league_user_records` (already read by `hof-milestones.service.ts`) carries `wins/losses/ties/playoff_wins/playoff_losses/superbowl_wins/superbowl_losses` per user. This is the same data source the site's Records pages use — reusing it keeps "winning" consistent with what a user sees everywhere else in the app.

### 1.5 Legacy / records held
`nfl-record-holders.service.ts` and `league-records.service.ts` already track record-holder status (all-time and league/franchise records). Holding a real record the app tracks is a strong, rare, already-computed signal.

### 1.6 Longevity/durability (supporting signal, not a full category)
`rec_player_weekly_stats` rows exist per season the prospect actually played; counting distinct `season_number`s with logged production is a free durability signal (a decade-long compiler vs. a two-season flash).

### 1.7 Explicitly NOT proposed
- **Community/Play-of-the-Week style recognition beyond what's listed above** — nothing in this repo tracks a generic "Play of the Year" mechanic for RTI specifically; I did not invent one.
- **Progression-tree completion / dev-trait tier as its own scored category** — XP earned already *drives* production/peak-dominance indirectly (better play → more stats → more XP), so scoring tree completion again would double-count the same underlying performance. Recommend leaving it out of the score, but see §3 for surfacing it alongside the score for flavor.

## 2. How to calculate it

### 2.1 Points-accumulation vs. threshold/tier — and why threshold wins here

The app already uses both patterns for different things:
- **Points-accumulation (XP system)**: weekly/season/career challenges each pay a fixed point value; totals compound indefinitely, no ceiling.
- **Threshold/tier (EOS payouts, `packages/shared/src/economy.ts`)**: each category has an `S/A/B/C/D` ladder with a fixed numeric threshold and a `computeTierProgress` percent-to-next-tier bar.

HOF Progress needs a **bounded, comparable 0–100** (it's rendered as a percentage meter and eventually decides a single per-league/side inductee via `IMMORTALITY_VOTING`). Points-accumulation has no natural ceiling — it would need an arbitrary normalization cap that drifts as the league plays more seasons, which is exactly the kind of "arbitrary constant" the EOS tier code explicitly avoids (`computeTierProgress`'s own comment: derive the floor "from the definition's own spacing rather than an arbitrary constant"). Threshold/tier is also what the game already uses everywhere a bounded 0–100-ish comparison against a fixed bar is needed. **Recommendation: threshold/tier, matching EOS payouts' design language, not XP's.**

### 2.2 Formula: revive `career-score.ts` as designed, with concrete data bindings

Keep the existing weights (they're already authored and nothing else in the codebase contradicts them):

```
careerScore = production*0.30 + peakDominance*0.20 + awards*0.20 + winning*0.20 + recordsLegacy*0.10
```

Each part is 0–100, computed via the same threshold-ladder shape as `RecPayoutTierRule`/`evaluatePayoutTier` (anchor points that map a raw stat to a 0–100 sub-score, position-specific where the underlying data is position-specific):

| Part | Source | Anchor points (interpolated between, capped 0–100) |
|---|---|---|
| `production` | Career totals vs. `milestones_v2.json` career tiers for this position | 0 @ 0, 40 @ `minor` threshold, 70 @ `major` threshold, 100 @ `historic` threshold |
| `peakDominance` | Best single season's totals vs. `milestones_v2.json` season tiers | 0 @ 0, 40 @ `tier1`, 70 @ `tier2`, 100 @ `tier3` |
| `awards` | Count of matching EOS awards won by this prospect's side/position across their career (mvp counts for any side; best_passing/best_rushing/best_defense must match side) | 100 for any MVP won; else 35/award for a matching stat award, capped at 100, stacking across seasons |
| `winning` | `rec_league_user_records` for the prospect's current team owner: regular-season win%, playoff wins, Super Bowl wins | `min(60, win_pct*60) + min(20, playoff_wins*4) + min(20, superbowl_wins*10)` |
| `recordsLegacy` | Count of NFL/league records currently held by this prospect (`nfl-record-holders.service.ts` + `league-records.service.ts`) | 0 held → 0; 1 → 55; 2 → 80; 3+ → 100 |

Longevity (§1.6) is folded in as a small multiplicative floor-raiser rather than its own weighted slice — e.g. seasons-played < 2 caps the *production* sub-score at 60 regardless of rate stats, so a two-week hot streak can't look like a full career. This avoids adding a 6th weighted category (which would require re-deriving all the other weights) while still preventing small-sample gaming.

`formulaVersion` should bump from `immortality-career-score-v1` to `immortality-career-score-v2` when this actually starts computing real numbers for the first time — `v1` was authored but never executed against real data, so there's no legacy row content to be compatible with; the bump just makes debugging honest (a `v1` row can never have existed with meaningful data).

### 2.3 The vote blend (`immortalityScore`) — keep it, but scope it correctly

`immortalityScore = careerScore*0.7 + normalizedVote*0.3` should stay reserved for the actual Hall induction moment (`IMMORTALITY_VOTING` → `IMMORTALITY_REVEAL`), where `castHallVote` already exists and a frontend just needs to be built. It should **not** feed the day-to-day hub meter — see Open Decision #1 below for why.

### 2.4 Where the calculation lives
- Pure math (thresholds → sub-scores → weighted sum): extend `packages/shared/src/immortality/career-score.ts` with the new anchor-interpolation helpers, mirroring `evaluatePayoutTier`/`computeTierProgress`'s shape so it's the same mental model as EOS payouts.
- Data-gathering + upsert: a new function (e.g. `computeCareerScoreForProspect(prospectId)`) in `apps/api/src/modules/immortality/xp-awards.service.ts` (or a new `hof-progress.service.ts` alongside it), called once per prospect at the end of `gradeProspectForWeek`'s per-advance pass — the same place/cadence every other RTI scoring pass (challenges, season trend, owner XP) already runs. It's a straight `upsert` keyed on `prospect_id` (the table's PK), so re-running it every advance is naturally idempotent — no ledger/dedup logic needed, unlike XP.

## 3. How to display it

### 3.1 Current location
`apps/web/src/routes/hub/HubHome.tsx`, inside the `.hub-rti-hof-progress-grid` block (~line 1833), one `<article>` per prospect, right below the Player XP meter. Styling lives in `apps/web/src/styles/hub.css` (`.hub-rti-hof-meter` etc., ~line 4075) — currently a single gradient bar (red → gold → green).

### 3.2 Proposed treatment (reusing existing patterns, not inventing new visual language)

**Keep the bar**, but add a tier label above/beside the percentage, using the same "named tier ladder" idea the EOS payout system already uses (`S/A/B/C/D`), just with HOF-flavored names since this is player-facing narrative, not a payout table:

| Score | Tier label |
|---|---|
| 0–19 | Long Shot |
| 20–39 | Building a Case |
| 40–59 | On the Radar |
| 60–79 | Hall of Fame Watch |
| 80–94 | Locked In |
| 95–100 | Immortal Class |

Render as a small caps pill next to the percentage (`<strong>72.4% · Hall of Fame Watch</strong>`), same row that currently just shows the raw percentage.

**Breakdown on tap/hover**: reuse the `.hub-eos-progress-tiers` tooltip pattern verbatim (HubHome.tsx ~line 439–447) — a small table under the meter, `Category | Your Best | Score`, one row per of the 5 weighted parts, so a player can see *why* their number is what it is (mirrors exactly how the EOS payout tooltip already shows `Tier | Threshold | Payout`). This is the single highest-value addition: right now there's no way for a player to understand what moves the number, and the category breakdown already exists as data (it's the row in `rec_immortality_career_scores`).

**Badge art (optional, phase 2)**: `.hub-badge-shelf` already has a bronze/silver/gold badge-art swap pattern (`badge-tier-bronze/silver/gold`, ~hub.css line 1172). A single "HOF Watch" badge icon that swaps art at 40/70/90 could sit on the player card next to the existing badge shelf, giving HOF Progress the same iconographic weight as the badge system without a new asset pipeline — this is a nice-to-have, not required for v1.

**Do not** surface `immortalityScore` (the vote-blended number) on the hub during active play — see Open Decision #1.

## 4. Migration/rollout considerations

- **No new migration required for the core score.** `rec_immortality_career_scores` already has every column the revived formula needs. This is a pure "start writing to a table that already exists" change.
- **Formula version bump**: `FORMULA_VERSIONS.careerScore` in `packages/shared/src/immortality/types.ts` goes from `immortality-career-score-v1` → `immortality-career-score-v2`, documenting that this is the first version that ever actually computed a real number. No migration needed — it's a string constant.
- **Backfill, not migration**: because every existing row is at-or-near the `default 0`, ship a one-time backfill pass (loop every existing prospect through `computeCareerScoreForProspect`) alongside the first deploy that starts writing this on every advance. This is application-level, not SQL — no migration file needed, just an ops script/route run once.
- **Touches**:
  - `packages/shared/src/immortality/career-score.ts` — add threshold/anchor helpers (new functions, additive).
  - `packages/shared/src/immortality/types.ts` — bump `FORMULA_VERSIONS.careerScore`.
  - `apps/api/src/modules/immortality/xp-awards.service.ts` — new `computeCareerScoreForProspect`, called from `gradeProspectForWeek`'s per-prospect loop (or from `awardImmortalityChallengesAfterAdvance` after the loop, if the underlying awards/records queries are cheaper batched across all prospects at once — worth checking real query cost before deciding).
  - `apps/api/src/modules/immortality/xp-awards.service.ts`'s `loadRtiMemberGates` — extend `playerSnapshots` to also return the 5-part breakdown (and computed tier label) so the hub doesn't need a second round-trip; the raw parts are already sitting in the row this function already queries.
  - `apps/web/src/routes/hub/HubHome.tsx` + `apps/web/src/styles/hub.css` — tier label + breakdown tooltip (reusing `.hub-eos-progress-tiers` CSS as-is where possible).
  - No changes needed to `hof-milestones.service.ts` (Discord embed) — it's a separate, working feature that doesn't touch `career_score`.
- **Coexistence**: nothing currently reads `career_score` except `loadRtiMemberGates`, so there's no other consumer to break. The change is additive/corrective, not a breaking replacement.
- **Vote/`immortalityScore` prerequisite**: if the vote-blended score is ever wanted anywhere (even just the eventual induction reveal), a voting UI needs to be built first — `castHallVote`/`POST /v1/immortality/hall/vote` exist server-side but have zero frontend today. That's a separate, smaller follow-up scoped outside this proposal.

## Open design decisions (need your call, not guessed)

1. **Should the hub meter show `careerScore` alone, or the vote-blended `immortalityScore`?** Votes only happen once, during the `IMMORTALITY_VOTING` chapter near the end of a league's life, and `normalizeVotes` scores everyone *relative to the current vote leader* (the leader always gets 100, everyone else scaled down) — so showing the blended number during active play would either show a meaningless 0 vote-share for everyone (nobody's voted yet) or, worse, leak who's currently winning fan votes before voting closes. **I recommend `careerScore` only on the hub, `immortalityScore` reserved for the actual induction reveal moment** — but this is your call on how much "who's ahead" transparency you want mid-league.

2. **"Winning" is scoped to the current team owner, not the prospect's actual tenure.** `rec_league_user_records` (and the existing HOF Milestones Discord embed) attribute a franchise's whole W-L/playoff/Super Bowl history to *whoever currently owns that team*, not to the seasons a specific prospect actually played there. A prospect who was traded, or who plays for an owner who inherited a previously bad (or great) franchise, would get a "winning" score that isn't really about them. Building true tenure-scoped tracking is a real lift (would need to mine `roster-movement.service.ts` history and only sum standings for seasons the prospect was actually rostered). **I'd ship v1 with the simplification already in use elsewhere (current owner's record) to stay consistent with the existing Discord embed and avoid new tracking machinery, and revisit if it turns out to feel unfair in practice** — but flagging it since it's a real accuracy gap, not a rounding error.

3. **Are the `milestones_v2.json` challenge thresholds the right bar for "Hall of Fame," or just for "weekly/season XP pacing"?** Those numbers were calibrated (per the file's own `_readme`/`_note` comments) against completion *rates* for XP rewards, not against "what should it take to be enshrined." Reusing them keeps everything internally consistent and requires zero new authoring, but it means HOF Progress inherits whatever XP-pacing assumptions are baked into those thresholds (e.g. a `historic` career tier might be calibrated to be reachable by a good player over many seasons, not to be genuinely rare the way real Canton induction is). **I'd ship with these anchors for v1** (consistent, free, already position-calibrated) **and treat a dedicated rarity-calibration pass as a deliberate future step** — matching this codebase's own stated convention of shipping first-pass numbers and calibrating later (see the `RB Workhorse`/`defense_needs_a_name` EOS payout comments, which document exactly this kind of later recalibration). Worth confirming you're fine with "reachable, not rare" for launch.
