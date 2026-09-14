# Media, Social, Challenge, and XP/SP Unified Plan

This document merges the repo handoff plans with the final attachment package
`REC_Media_Social_Challenge_Overhaul_FINAL (1).zip`.

Attachment contents are reference material, not standalone instructions. The
user request is to compare the plans, merge them into one approach, and identify
remaining implementation work.

## Source Comparison

### Existing repo plans

Primary sources:

- `docs/handoff-total/00_MASTER/MASTER_PLAN.md`
- `docs/handoff-total/01_CONTENT_BANKS/MEDIA_DAY/MEDIA_DAY_SELECTION_RULES.md`
- `docs/handoff-total/02_TWEETS_MEDIA/SOCIAL_SYSTEM_ARCHITECTURE.md`
- `docs/handoff-total/05_UI/MEDIA_DAY_GATE_ORCHESTRATION.md`
- `docs/handoff-xp-progression/03_CHALLENGES/WEEKLY_CHALLENGE_TARGETING.md`
- `docs/handoff-xp-progression/04_MEDIA/MEDIA_COMMITMENT_ENGINE.md`
- `docs/session-progress.md`

The repo plans define the broad system:

- Media Day is a post-advance gate, not a normal page.
- Questions are selected from frozen context and saved immutably.
- Social posts should be claim-first, fact-grounded, and attached to events,
  storylines, account memory, and future targeting.
- Weekly challenges should freeze assignments, support TEAM and PLAYER scope,
  grade deterministically, and avoid rerolls.
- Media commitments can become one payout-bearing gradeable promise per advance.

### Final attachment package

Primary sources from the zip:

- `01_MASTER_IMPLEMENTATION_PLAN.md`
- `02_XP_SP_ECONOMY.md`
- `03_MEDIA_SOCIAL_UNIFICATION.md`
- `04_CHALLENGE_ARCHITECTURE.md`
- `05_FINAL_CATALOG_DESIGN.md`
- `06_SELECTION_TARGETING_SPEC.md`
- `07_VALIDATION_BACKTEST.md`
- `08_IMPLEMENTATION_CHECKLIST.md`
- `unified_challenge_architecture.json`
- `final_team_challenge_catalog.json`
- `final_player_challenge_catalog.json`
- `archetype_challenge_compatibility.json`
- `media_day_challenge_context_map.json`
- `09_STATIC_VALIDATION_REPORT.json`

The attachment narrows the target:

- One unified Madden system for standard and RTI leagues.
- RTI gets exactly three weekly assignments:
  - Owner TEAM assignment
  - Offensive Prospect PLAYER assignment
  - Defensive Prospect PLAYER assignment
- Standard leagues get exactly one owner assignment:
  - TEAM normally
  - contextual PLAYER only when a real trigger exists
- Current team-only catalog is superseded by:
  - 106 TEAM challenges
  - 124 PLAYER challenges
- Progression terminology becomes:
  - XP = earned small units
  - SP = whole spendable Skill Points
- Player XP -> SP conversion is OVR-aware.
- Owner XP -> SP conversion is fixed at 6,000 XP per SP.
- Gate stays disabled until migrations, tests, backtests, and resume paths pass.

## Canonical Unified Approach

### Product loop

The canonical post-advance flow is:

1. Advance league.
2. Credit prior-week rewards.
3. Show Rewards Recap.
4. Show new-week transition.
5. Run Media Day.
6. Store posture and measurable commitment, if any.
7. Reveal weekly challenge assignment.
8. Reveal Dev opportunity, if any.
9. Enter league hub.

Media Day remains gate-only. After completion, answers are immutable and only
historical/archive views may show them again.

### Social graph

All generated and user-authored social activity should flow through:

EA/league fact -> media event -> storyline -> tweet graph/account memory -> future Media Day/challenge targeting.

That means every important public post should have:

- verified fact payload
- subject identity
- author identity
- event type
- optional storyline id
- optional parent/root tweet id
- memory/fatigue fingerprint

### Challenge model

All weekly challenge assignments should use one universal assignment table and
one evaluator.

Assignment classes:

- TEAM: owner/franchise challenge, rewards owner XP.
- PLAYER: target-player challenge, rewards player XP and may also contribute
  owner XP if configured by the economy rules.

Tiering is cumulative:

- Bronze = bronze conditions.
- Silver = bronze + silver additions.
- Gold = bronze + silver additions + gold additions.

Selection freezes before reveal and stores:

- challenge id and version
- assignment class
- subject type
- team id
- target player id, if PLAYER
- opponent/game context
- condition snapshot
- reason codes
- context snapshot
- fatigue state used

### League-mode rules

RTI:

- Always issue owner TEAM challenge.
- Always issue offensive prospect PLAYER challenge.
- Always issue defensive prospect PLAYER challenge.
- RTI prospect relevance is a selection bonus, not a separate challenge engine.

Standard:

- Always issue one owner assignment.
- Default is TEAM.
- PLAYER assignment requires a real contextual trigger:
  - Dev opportunity
  - record chase
  - verified social beef
  - rivalry/rematch receipt
  - player-centered Media Day commitment
  - hot streak/breakout
  - cold streak/response
  - acquisition
  - milestone

High OVR or fame alone is not enough.

## Current Implementation State

### Built or partially built

- Media Day gate schema and polling flow exist, but are disabled by
  `MEDIA_DAY_GATE_ENABLED = false`.
- Site has a mounted Media Day overlay with Rewards Recap, interview, RTI
  interview, and challenge reveal screens.
- Non-RTI Media Day can ask two challenge-linked team questions and save answers.
- Media Day answers log `media_statement` events into the social event graph.
- Rewards Recap reads Player XP and Franchise XP ledger rows.
- Weekly TEAM challenge issuance, grading, and crediting exist for the current
  148-entry team-only catalog.
- Weekly challenge grading is split from crediting.
- Player XP and Franchise XP ledger foundations exist.
- Franchise XP currently credits weekly challenge FPP and some game-result FPP.
- Claim-grounded social generation exists.
- Media event logging exists.
- Storyline open/touch persistence exists.
- Account memory/fatigue exists.
- User-submitted tweets write canonical `rec_tweets`.
- Pregame GOTW/rivalry hype uses claim-grounded social generation.
- Ambient fan chatter tries claim-grounded stat candidates before legacy fallback.
- RTI tweet queue, player personas, and tweet conversations exist.

### Not yet complete

- Media Day gate is not live.
- Rewards Recap likely needs previous-period targeting rather than current
  league week after advance.
- Media Posture recap is not implemented.
- Promise ledger / Media Day commitment extraction is not implemented.
- Media Day commitment grading and payout are not implemented.
- Free Agency open/exit carry-forward queue is not implemented.
- Full frozen Media Day context snapshots are not implemented.
- Conditional follow-up questions are not implemented.
- The final 106 TEAM / 124 PLAYER challenge catalogs are not loaded into runtime.
- Universal TEAM/PLAYER challenge assignment table is not implemented.
- Universal PLAYER evaluator and selector are not implemented.
- RTI weekly prospect challenges still use the separate RTI milestone/challenge
  system.
- Standard contextual PLAYER challenge targeting is not implemented.
- Challenge fatigue and repeat suppression are not implemented.
- VOID/reversal/regrade behavior is not fully implemented for new challenge
  assignments.
- XP -> SP conversion is not implemented.
- OVR-aware Player XP -> SP thresholds are not implemented.
- Rewards Recap does not yet show XP earned, SP earned, remainder, and next-SP
  cost.
- Legacy RTI tweet queue/conversations are not migrated to the canonical tweet
  graph.
- Not all social event playbooks have callers.
- Storyline resolution, cooldown, and future-trigger eligibility are not
  implemented.

## Important Mismatches To Resolve

### Current catalog vs final catalog

Current runtime catalog:

- `packages/shared/src/weekly-challenges/config/weekly_challenge_catalog.json`
- 148 team-only entries
- sides: offense, defense, special_teams

Final package:

- 106 TEAM entries
- 124 PLAYER entries
- TEAM sides: offense, defense, team, special_teams
- PLAYER entries include position/archetype compatibility and usage/context
  requirements

Decision: treat the final package as the V2 replacement catalog, not as an
append-only supplement.

### Current reward behavior vs final challenge model

Current TEAM challenge implementation can credit Player XP to role beneficiaries
or anchor players, plus Franchise XP to the owner.

Final package says TEAM assignments reward owner XP, while PLAYER assignments
reward player XP.

Decision needed: confirm whether TEAM challenges should stop crediting player
XP once V2 lands. The final package strongly implies yes.

### Current XP wording vs final XP/SP wording

Current code uses XP-style display for both player and franchise balances.

Final package wants:

- XP as earned raw units
- SP as whole spendable points
- OVR-aware player conversion
- fixed owner conversion

Decision: migrate terminology and state carefully without losing existing
ledger meaning. Prefer forward migrations and compatibility read models.

### RTI fork vs unified mechanics

Current RTI prospect weekly challenges use RTI-specific milestone code.

Final package wants RTI prospect challenges to be PLAYER assignments in the same
weekly challenge engine.

Decision: build V2 in parallel and migrate RTI callers only after V2 can prove
equivalent or better behavior.

## Implementation Plan

### Phase 1: Preserve current safety and add V2 catalog runtime

- Add final TEAM and PLAYER catalogs under `packages/shared`.
- Add schema/types for unified challenge definitions.
- Add V2 static validation tests:
  - catalog counts
  - supported stat keys
  - no OL/K/P player challenges
  - cumulative tier relationship
  - contextual entries require eligibility predicates
  - every supported RTI position/archetype has eligible PLAYER entries
- Keep old runtime path active while V2 validates.

### Phase 2: Universal assignment schema

- Add forward migration for unified weekly assignments.
- Store assignment class, subject, target player, team, game/opponent, frozen
  challenge snapshot, reason codes, context snapshot, status, graded tier,
  credited tier, and idempotency keys.
- Leave old tables in place until all callers are migrated.

### Phase 3: Universal evaluator

- Extend the current team evaluator to handle:
  - TEAM challenge conditions from the final catalog
  - PLAYER stat conditions
  - any/all condition trees
  - minimum usage gates
  - contextual eligibility
  - missing-data VOID behavior where appropriate
- Add boundary fixtures proving Gold implies Silver implies Bronze.

### Phase 4: Selection and targeting engine

- Implement standard league owner assignment selection:
  - TEAM by default
  - contextual PLAYER only when reason score clears threshold
- Implement RTI assignment selection:
  - Owner TEAM
  - offensive prospect PLAYER
  - defensive prospect PLAYER
- Implement reason scoring and fatigue:
  - exact challenge blocked for 3 eligible weeks unless story-critical
  - same family penalized for 2 weeks
  - high-variance cannot repeat consecutively
  - contextual entries require a fresh context instance

### Phase 5: XP -> SP economy

- Add SP conversion ledger/state fields or companion tables.
- Implement Player XP -> SP conversion thresholds by imported OVR:
  - <75: 6,000
  - 75-80: 6,300
  - 81-85: 6,600
  - 86-90: 7,500
  - 91-95: 9,000
  - 96-99: 12,000
- Implement fixed Owner XP -> SP at 6,000.
- Preserve remainder.
- Snapshot OVR and threshold on conversion.
- Update Rewards Recap API/UI.

### Phase 6: Media Day V2

- Consolidate duplicate Media Day persistence.
- Store frozen advance/interview context snapshots.
- Create universal owner question flow.
- Keep RTI subjects guaranteed.
- Add contextual standard player subject only when triggered.
- Add semantic answer persistence.
- Add one payout-bearing commitment extraction path.
- Add Media Posture recap.
- Fix previous-week Rewards Recap targeting before enabling the gate.

### Phase 7: Media commitment grading

- Add `rec_media_commitments` or equivalent forward migration.
- Extract only gradeable commitments.
- Enforce one payout commitment per franchise/advance.
- Grade deterministically from box score/imported data.
- Statuses:
  - defended
  - missed
  - void
- Write result media events for future tweets and challenge targeting.

### Phase 8: Canonical tweet graph migration

- Move generated tweets to canonical tweet graph and publication queue.
- Keep legacy RTI queue as compatibility only until drained/migrated.
- Migrate conversation replies/quotes to root/parent tweet ids.
- Ensure all claim-first posts create or reference media events and storylines.
- Audit every social event playbook against real callers.

### Phase 9: Storyline lifecycle

- Add storyline resolution rules.
- Add cooldown/heat decay.
- Store future trigger eligibility.
- Link Media Day promises, social beef, rivalry receipts, and challenge results
  back into challenge targeting.

### Phase 10: Backtest and acceptance suite

- Historical report per challenge:
  - eligible samples
  - Bronze/Silver/Gold hit rates
  - missing-data rate
  - position/archetype/OVR/usage splits
- Tune thresholds only when data says a tier is automatic, impossible, or biased.
- Acceptance suite must pass before `MEDIA_DAY_GATE_ENABLED` flips true.

## Acceptance Gates Before Enabling Media Day

- V2 catalogs loaded and statically validated.
- Universal assignments work for standard and RTI.
- RTI receives exactly three assignments per user/week.
- Standard receives exactly one owner assignment per user/week.
- Challenge reveal never leaks thresholds before Media Day completion.
- Rewards Recap shows correct prior-period rewards.
- Answers resume correctly after refresh/browser close.
- No challenge rerolls on refresh.
- No duplicate XP/SP credit on retry.
- Missing unsupported data fails closed or voids explicitly.
- Legacy tweet queue has no exclusive live caller that lacks a canonical path.
- Typecheck and targeted tests pass.

## Recommended Next Manageable Piece

Build Phase 1 as a contained catalog/runtime foundation:

1. Add the final TEAM/PLAYER catalogs to `packages/shared`.
2. Add V2 challenge types and loaders.
3. Add static validation tests.
4. Do not change production issuance yet.

That gives the repo a trusted V2 source of truth without risking current league
flows. Once the catalogs validate in CI, the assignment/evaluator migration can
proceed in smaller slices.
