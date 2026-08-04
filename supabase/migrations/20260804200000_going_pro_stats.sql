-- CFB-only "players gone pro" tracking per coach, season and career.
alter table public.rec_season_user_records add column if not exists players_gone_pro integer not null default 0;
alter table public.rec_global_user_records add column if not exists players_gone_pro_career integer not null default 0;
