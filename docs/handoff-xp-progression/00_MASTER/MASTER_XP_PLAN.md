# REC XP + Progression — Canonical Master Plan

## Core model

Non-RTI leagues contain two separate XP economies.

| XP layer | Owner | Internal currency | Conversion | Spend target |
|---|---|---:|---:|---|
| Franchise XP | user/team in league | Franchise Progress Points (FPP) | 6,000 = 1 XP | franchise progression tree |
| Player XP | specific REC player instance | Player Progress Points (PPP) | 6,000 = 1 XP | that player's attributes |

They never share balances. One event can legitimately create both FPP and PPP when it represents both team and player achievement.

## Accounting

- Store integer Progress Points only.
- `display_xp = points / 6000`.
- 9,600 PPP displays as 1.60 Player XP.
- 21,300 FPP displays as 3.55 Franchise XP.
- Never make floating-point XP authoritative.

## Player season targets

- limited contributor: 1–4 XP
- average starter: 4–8
- good starter: 7–12
- high-end starter: 10–15
- elite season: 14–19
- exceptional/award season: 18–22
- historic season + deep playoff run: hard ceiling 25 XP

The ceiling is enforced from season-earned points, not current balance.

## Franchise season targets

- poor/low engagement: 6–10 XP
- typical: 10–15
- strong: 14–19
- contender: 18–23
- championship-caliber: 22–28

This preserves multi-season progression across the planned 133-XP tree.

## Weekly challenge scope

Every challenge is explicitly `TEAM` or `PLAYER`.

### TEAM
A team-level objective. Challenge completion awards FPP only. Individual players still independently earn PPP from performance.

### PLAYER
A specific named player has a frozen stat-line objective. Completion awards both:
- PPP to the named player;
- FPP to the franchise.

PLAYER targeting is especially appropriate for Dev opportunities, record/milestone chases, hot streaks, acquisitions, Media Day commitments, verified Twitter beef, active rivalry, and revenge/rematch after a poor prior showing.

Default expectation: roughly 75–85% TEAM, 15–25% PLAYER, but this is contextual rather than a quota.

## Rivalry / beef targeting

A player gets elevated targeting when REC has verified social/rivalry context and the current opponent is relevant. The system may say a WR was held to 31 yards against Philadelphia if that is verified. It may not say a specific CB locked him down unless direct matchup attribution exists.

## Post-advance evaluation order

1. verify final game/import;
2. resolve player identity mapping;
3. build canonical player stat lines;
4. grade weekly challenge;
5. evaluate player weekly performance;
6. evaluate streak/milestone/award events;
7. evaluate Player Performance Dividend for the team;
8. grade one payout-bearing Media Day commitment;
9. apply caps/modifiers;
10. write immutable ledgers;
11. update state projections;
12. freeze reward snapshot.

## Correctness rules

- missing stat is not zero;
- unresolved player identity receives no PPP until resolved;
- challenge target freezes at issue time;
- highest challenge tier only;
- no Bronze+Silver+Gold stacking;
- no whole-XP grants;
- ledger history is immutable;
- corrected imports create reversal + re-evaluation;
- season cap is earned-points based;
- team performance dividend uses only top five player performances;
- one payout-bearing Media commitment per advance;
- social narrative cannot become football fact without canonical evidence.
