-- Official result sources for box scores + commissioner advance display results.

do $$ begin
  alter type public.rec_source_type add value if not exists 'box_score';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.rec_source_type add value if not exists 'box_score_screenshot';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.rec_source_type add value if not exists 'commissioner_advance';
exception when duplicate_object then null;
end $$;

-- Per-game-title global career records (box-score deltas only; legacy baseline applies to all-game global).
create table if not exists public.rec_global_user_game_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  game text not null check (game in ('madden_26', 'madden_27', 'cfb_27')),
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  playoff_wins integer not null default 0,
  playoff_losses integer not null default 0,
  superbowl_wins integer not null default 0,
  superbowl_losses integer not null default 0,
  points_for integer not null default 0,
  points_against integer not null default 0,
  point_differential integer not null default 0,
  games_played integer not null default 0,
  avg_point_differential numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, game)
);

create index if not exists idx_rec_global_user_game_records_user
  on public.rec_global_user_game_records (user_id);

alter table public.rec_global_user_game_records enable row level security;
