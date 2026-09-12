# REC XP + Progression Engine Plan

This package defines the non-RTI REC progression economy as two separate but connected systems:

1. **Franchise XP** — owned by the user's team/franchise and spent on the franchise progression tree.
2. **Player XP** — owned by a specific REC player instance and spent only on that player's attributes.

Both use the same internal scale: **6,000 Progress Points = 1.00 displayed XP**. No event grants whole XP directly.

It also defines weekly TEAM vs PLAYER challenges, Dev promotion challenges, player performance earning, franchise rewards derived from player performance, Media Day commitment defense, Twitter-beef/rivalry targeting, target fatigue, deterministic grading, reversals, season caps, balancing, schema, and implementation tests.

Read order:
1. `00_MASTER/MASTER_XP_PLAN.md`
2. `01_PLAYER/PLAYER_XP_ENGINE.md`
3. `02_FRANCHISE/FRANCHISE_XP_ENGINE.md`
4. `03_CHALLENGES/WEEKLY_CHALLENGE_TARGETING.md`
5. `04_MEDIA/MEDIA_COMMITMENT_ENGINE.md`
6. `05_SCHEMA/DATA_SCHEMA.md`
7. `06_BALANCE/BALANCE_AND_BUG_AUDIT.md`
8. `07_IMPLEMENTATION/IMPLEMENTATION_HANDOFF.md`
9. `config/xp_economy.json`

## Latest amendments

- `00_MASTER/AMENDMENTS_COMPETITIVE_BALANCE_RECORD_BOOK.md`
- `08_RECORDS/UNIVERSAL_RECORD_BOOK.md`
