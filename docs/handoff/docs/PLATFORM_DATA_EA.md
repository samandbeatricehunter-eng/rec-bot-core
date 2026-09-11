# Platform, Data and EA Integration

## Madden-only application boundary
The application may retain neutral college reference data, but no college-football league mode should remain reachable.

Dependency scan targets:
- routes
- API endpoints
- setup schemas
- bot command branches
- imports
- tests
- store products
- database foreign keys
- CSS/theme imports
- assets

Before deleting any remaining CFB rivalry catalog data, remove the `rec_league_rivalries.catalog_id` dependency.

## EA sync scheduler
Use a short recurring dispatcher that claims leagues whose `next_auto_sync_due_at <= now`.

Per league:
- acquire import lock
- create `sync_run_id`
- mark started
- fetch full required datasets
- validate completeness
- commit canonical state
- run downstream diff/economy/media work only after success
- mark completed
- set next due = completion + 4h

Retries must reuse idempotency boundaries so the same source event cannot pay twice or duplicate media/compliance records.

## Import provenance
Keep normalized fields needed for product behavior:
- external identity
- team/roster state
- `playerBestOvr`
- `playerSchemeOvr`
- Dev Trait
- age
- position
- contract
- abilities/signature slots
- confidence
- stats

Retain compact source provenance/checksums.

Archive large full raw payloads to object storage under a retention policy rather than growing hot DB tables indefinitely.

## Temporary Persona diagnostics
On representative raw roster payloads, scan for stable keys related to:
- persona
- DNA
- mindset
- motivation
- temporary traits

Store diagnostics separately.

Only promote a field into production schema after repeatable verification.

## `playerSchemeOvr`
Preserve separately.

Do not use it as the main OVR.

A controlled scheme-change test can determine whether it is safe to expose as current scheme-fit OVR. Until then it is supplemental/internal.

## REC tracking baseline for career stats
At first successful league import:
- record tracking start
- snapshot cumulative imported season/career counters needed to subtract pre-REC production

REC career views aggregate only production after tracking start.

This is especially important when an existing Madden franchise joins REC midseason.

## Database cleanup
Resolve:
- unused/zombie snapshot tables
- duplicate raw-data paths
- stale route-channel fields such as REC Rules channel
- stale command registration sources
- CFB-only tables after dependency migration
- obsolete Coin-based attribute product tables/builders if no caller remains

Public tables require explicit RLS policy decisions.

## Error diagnostics
Member response:
- plain explanation
- whether anything changed
- retry guidance
- REC error code

Commissioner diagnostics:
- safe lookup by code
- backend context
- source run/purchase/game IDs
- recommended action
- no secret leakage
