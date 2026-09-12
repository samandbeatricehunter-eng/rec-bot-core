# Economy and Progression

## Ledger model
All spend/award paths are idempotent and append-only.

Coin source examples:
- weekly salary
- EOS
- POTW/award
- media
- rivalry bonus
- interest
- store spend
- refund
- admin correction
- transfer

XP families have separate ledgers and scopes.

## Economy replay
Before production balance lock, replay at least one representative completed season using real source events.

Report:
- p10 / p25 / median / p75 / p90 / max gross Coins
- organic income excluding admin grants/refunds/transfers
- interest share
- Franchise XP
- Player XP
- purchase affordability
- ending balances under representative spend strategies

Prices should be configuration/version data, not duplicated constants across clients.

## Attribute upgrade atomicity
Server owns:
- ownership check
- pending-batch check
- current attributes
- OVR
- effective Dev Trait
- XP balance
- cost calculation
- discount eligibility
- batch cap
- ledger debit
- Pending Item creation

One transaction succeeds or nothing changes.

Pending Item:
`player_attribute_upgrade`

Store:
- player/team/user
- authoritative pre-request OVR
- before/requested attributes
- total XP spent
- pricing/formula version
- request timestamp

After commissioner applies Madden changes:
- mark Applied in Madden
- next EA sync compares requested values with actual imported values
- fulfill or mismatch
- explicit audited correction handles refunds; never silently refund/re-spend

## Non-RTI Player XP earnings

Ordinary non-RTI Player XP earning rules are production-defined in `PLAYER_XP_REWARDS.md`.

The system rewards:
- weekly stat-line tiers
- position-relative performance
- splash games
- production streaks
- season production
- awards and records
- postseason performance

Dev Trait earning multipliers:
- Normal 1.00x
- Star 1.10x
- Superstar 1.20x
- X-Factor 1.30x

Use fractional remainder banking so modified XP is not lost to integer rounding.

## Non-RTI progression tree release gate
The branch identities/effects listed in the Master Plan are binding.

The exact per-node Franchise XP cost map must be provided as configuration before the tree is production-enabled.

Implementation should therefore:
- build the tree from data/config, not hardcoded JSX
- support prerequisites/cross-branch dependencies
- total cost validation
- audit unlock time
- expose historical entitlement for compliance checks

Reject a config whose total does not equal 133 XP.
