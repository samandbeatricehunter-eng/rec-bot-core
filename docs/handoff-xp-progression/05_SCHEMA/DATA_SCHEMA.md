# Data Schema

Exact migration names can adapt to repo conventions; these logical fields are required.

## rec_player_xp_ledger

Immutable event ledger:
- id
- league_id / season_id / season_number / week_number
- game_id nullable
- player_id / team_id / user_id
- event_type / event_subtype
- source_type / source_id
- raw_points
- base_cap_points nullable
- points_after_base_cap
- dev_trait_at_event
- dev_multiplier_bps
- rivalry_multiplier_bps
- other_multiplier_bps
- uncapped_final_points
- season_cap_suppressed_points
- credited_points
- reversal_of nullable
- formula_version
- idempotency_key UNIQUE
- metadata JSONB
- created_at

## rec_player_xp_state

- league_id + player_id unique
- available_points
- season_points_earned
- lifetime_points_earned
- lifetime_points_spent
- updated_at

## rec_franchise_xp_ledger

- id
- league/season/week/stage/game IDs
- user_id / team_id
- event_type / source_type / source_id
- raw_points
- game_cap_points nullable
- uncapped_points
- credited_points
- reversal_of nullable
- formula_version
- idempotency_key UNIQUE
- metadata
- created_at

## rec_franchise_xp_state

- league_id
- progression_owner_id
- active_team_id
- available_points
- season_points_earned
- lifetime_points_earned
- lifetime_points_spent
- updated_at

`progression_owner_id` ownership must be explicitly chosen before migration.

## rec_weekly_challenge_assignments

- id
- league/season/week/game/team/user IDs
- challenge_scope TEAM|PLAYER
- challenge_id / formula_version
- target_player_id nullable
- target player name/position snapshots
- bronze_rule / silver_rule / gold_rule JSONB
- dev_promotion_rule nullable
- targeting_reason_codes JSONB
- context_snapshot_id
- issued_at / locked_at
- status ACTIVE|VOID|GRADED
- grade NONE|BRONZE|SILVER|GOLD|VOID
- graded_at

## rec_player_storylines

- id
- league_id
- story_type
- player_id / opponent_player_id nullable
- team_id / opponent_team_id
- origin_game_id nullable
- origin_social_thread_id nullable
- verified_stat_context JSONB
- heat
- active
- first_seen_at / last_seen_at
- last_used_for_challenge_week
- times_used_for_challenge

## rec_media_commitments

- id
- league/season/week-stage/game/team/user IDs
- subject_type TEAM|PLAYER|OWNER
- subject_player_id nullable
- source_media_day_response_id
- metric_key / operator / threshold
- grading_scope
- difficulty STANDARD|STRONG|HIGH_RISK
- reward_fpp
- formula_version
- status OPEN|DEFENDED|MISSED|VOID
- result_value
- graded_at

Enforce one payout-bearing commitment per team/user/advance.

## rec_xp_evaluation_runs

- id
- league/season/week/game/import_run IDs
- evaluator_version
- source_hash
- status
- started/completed timestamps
- error_summary

## rec_xp_pending_identity_links

- id
- league/game IDs
- external_player_id
- imported name/team
- candidate player IDs
- status
- resolved_player_id / resolved_by / resolved_at

No PPP finalization until identity is resolved.
