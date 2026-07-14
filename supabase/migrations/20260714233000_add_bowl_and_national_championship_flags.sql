alter table public.rec_games
  add column if not exists is_bowl_game boolean not null default false,
  add column if not exists is_national_championship boolean not null default false;
