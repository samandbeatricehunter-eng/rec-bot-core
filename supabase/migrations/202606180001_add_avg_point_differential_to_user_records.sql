-- rec_global_user_records and rec_league_user_records were missing avg_point_differential,
-- which incrementRecord()/auditAndRepairRecords always write. Every global/league record write
-- was failing on the missing column (errors swallowed), so games_played stayed 0 and global/league
-- records never updated. rec_season_user_records already has the column, which is why season
-- records worked. Add the column so the writes succeed.
alter table public.rec_global_user_records add column if not exists avg_point_differential numeric not null default 0;
alter table public.rec_league_user_records add column if not exists avg_point_differential numeric not null default 0;
