# REC Leagues — Master Handoff Plan

This package is the single implementation handoff for the current REC Leagues direction.

It is self-contained and authoritative for the current target design.

## Repo baseline reviewed
- Repository: `samandbeatricehunter-eng/rec-bot-core`
- Branch: `main`
- Reviewed baseline commit: `bc8ac6e90888c22df5ef10513dcc6cb28211ba77`
- The repo already removed the REC Guide feature and completed major CFB-removal work, but the handoff still requires a final dependency/dead-code scan before signoff.

## Read order
1. `docs/MASTER_PLAN.md`
2. `docs/FINAL_AUDIT.md`
3. `docs/IMPLEMENTATION_HANDOFF.md`
4. Domain appendices as needed.

## Domain appendices
- `PLATFORM_DATA_EA.md`
- `ECONOMY_PROGRESSION.md`
- `PLAYER_XP_REWARDS.md`
- `LEGENDS_PENDING_ITEMS.md`
- `MATCHUPS_DISCORD_RULES.md`
- `MEDIA_SOCIAL_HIGHLIGHTS.md`
- `UI_ROSTER_PLAYER_CARDS.md`
- `COPY_ERRORS_ACCESSIBILITY.md`
- `ACCEPTANCE_TESTS.md`

## Important release gates
One numeric progression configuration still requires owner approval before production enablement:
- the exact node-by-node XP cost table for the six-department non-RTI progression tree.

Ordinary non-RTI Player XP earning rules are now fully specified in `docs/PLAYER_XP_REWARDS.md`.

The Legend catalog also requires its remaining player-by-player evidence pass before every catalog entry can be called production-ready.
