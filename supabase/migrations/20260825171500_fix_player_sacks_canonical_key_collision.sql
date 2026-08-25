-- packages/shared/src/stats/stat-definitions.ts's canonicalizeStatPayload alias map used
-- last-write-wins: player-scope "sacks" and team-scope "team_sacks" both alias the raw EA key
-- "defSacks", and team_sacks (declared later in STAT_DEFINITIONS) silently overwrote sacks'
-- registration -- every player defensive row's sack count was canonicalized (and stored) under
-- "team_sacks" instead of "sacks", so `stats->>'sacks'` read 0 for every player, in every
-- league, always. Confirmed via Player of the Week scoring picking the wrong defensive winners
-- (real 6-sack/11-sack performances scoring as zero sacks). The code is now fixed to
-- first-write-wins (player definitions are declared before team ones); this backfills the
-- already-affected rows by copying the misfiled value into the correct key.
update public.rec_player_weekly_stats
set stats = stats || jsonb_build_object('sacks', stats->'team_sacks'), updated_at = now()
where stat_category = 'defense' and stats ? 'team_sacks' and not (stats ? 'sacks');
