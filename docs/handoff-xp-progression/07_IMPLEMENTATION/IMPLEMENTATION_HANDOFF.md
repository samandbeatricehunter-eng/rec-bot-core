# Implementation Handoff

## Phase 1 — ledger foundation
Build player/franchise ledgers and states, evaluation-run audit, reversals, idempotency. No UI-first shortcut.

## Phase 2 — player mapping
Import → REC player identity, pending identity-link queue, trade persistence, season-cap identity.

## Phase 3 — challenge scope
TEAM vs PLAYER, frozen target, named player metadata, tier rules, dual reward, Dev promotion rule, void/reissue.

## Phase 4 — player performance evaluator
Order: participation → stat tier → Impact Score → position finish → splash → base cap → streak → Dev → rivalry → season cap → ledger.

## Phase 5 — franchise engine
Challenge FPP, top-five dividend, win/milestone FPP, recognition dividend, game-derived cap.

## Phase 6 — Media commitments
Structured extraction, conditional follow-up, difficulty score, one payout commitment, deterministic grading, Media/Tweet result events.

## Phase 7 — rivalry/beef targeting
Player storyline records, social-thread links, prior-game comparison, target fatigue, safe attribution language.

## Phase 8 — awards/records/postseason
Canonical award event IDs, explicit record-break event stream, postseason extras, reversals.

## Phase 9 — post-advance reward snapshot
Include Franchise FPP/XP delta, franchise meter, players with PPP/XP deltas, source breakdowns, reversals/corrections.

## Phase 10 — Season 1 backtest
Required reports: player distribution by position, starter median/P75/P90/P95/max, cap hits, franchise totals, challenge completion, PLAYER target rate, repeat-target rate, Media commitment defended rate.

## Phase 11 — formula versioning
Every rule set gets a version. Historical ledger rows never mutate when formula changes.

## Required automated tests

- highest challenge tier only
- TEAM challenge pays no PPP
- PLAYER challenge pays both ledgers
- Dev promotion below required threshold does not promote
- season cap survives spending
- trade does not reset PPP/cap
- missing stat does not become zero
- cohort <4 only #1 position reward
- target fatigue enforced
- beef without stored thread cannot trigger
- direct CB/WR claim blocked without attribution
- duplicate import pays once
- correction writes reversal
- VOID challenge pays nothing
- Media Day only one payout commitment
- team dividend top-five only
- game-derived FPP cap enforced
- historical Dev Trait used
- rivalry does not multiply ordinary challenge reward by default


## Record Book migration / legacy stat cleanup
- generalize RTI-only NFL record service to all Madden league types
- remove `loadImmortalityLeague` as universal-record prerequisite
- replace old `rec_immortality_nfl_records` dependency with universal record storage or a compatibility migration
- migrate tracked Discord message handling
- add site cache
- guarantee Media event for rank #2–#5 entries
- dedicated record-break event for #1
- historical Season 1 replay before initial non-RTI board publish
- delete combined-tackle category
- delete stale box-score comments/paths and route every evaluator to canonical imports
- confirm imported `tackles` semantics before active tackle record baseline
