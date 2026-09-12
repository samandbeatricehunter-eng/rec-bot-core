# Universal REC Record Book — Implementation Plan

## Goal
Use one NFL baseline Top 5 record system across RTI and non-RTI Madden leagues, then allow verified REC performances to replace those baseline entries.

## Source of truth
All record evaluation must use canonical import-derived player statistics.

Legacy box-score/manual-stat dependencies are not valid sources.

## Data model
Preferred universal table:
`rec_record_book_entries`

Fields:
- league_id
- scope: game | season | career
- category
- rank
- holder_type: NFL_BASELINE | REC_PLAYER
- holder_name
- player_id nullable
- user_id nullable
- team_id nullable
- team_name_snapshot
- team_abbreviation_snapshot
- value
- season_number nullable
- week_number nullable
- game_id nullable
- source_type
- source_ref
- set_at
- updated_at

Baseline metadata should additionally include:
- source team association
- season/year for game/season record
- source citation metadata

Career baseline holders with multiple teams should support multiple associations rather than fake a single-team history.

## Cache
`rec_record_book_cache`
- league_id
- scope
- payload jsonb
- source_version
- source_hash
- generated_at

Unique: league_id + scope

## Discord
Reuse tracked-message editing pattern from RTI.

Every Top-5 change edits the appropriate record board.

Every new REC Top-5 entry generates a Media event.

New #1 additionally creates a dedicated record-break Discord post.

## Historical migration
For preexisting leagues:
- replay historical finalized imports
- do not infer from current holder-only rows
- preserve original season/week/game/team
- no retrospective XP unless owner explicitly chooses retroactive economy credit
- honor historical record placement in the board

## Tackles cleanup
Remove `tackles_combined` everywhere.

Do not retain legacy "box-score" language.

Stored imports currently expose `tackles` but not a separate `tackles_solo`.

Before activating a Tackles record baseline:
1. inspect EA import contract/parser;
2. confirm what `tackles` semantically represents;
3. choose a matching historical NFL baseline;
4. label the category exactly to match that semantic.

Never map a generic imported `tackles` number to "Solo Tackles" merely because the old RTI board used that label.
