alter table public.rec_games
  add column if not exists advance_outcome_override text,
  add column if not exists advance_outcome_marked_by_discord_id text,
  add column if not exists advance_outcome_marked_at timestamptz;

alter table public.rec_games
  drop constraint if exists rec_games_advance_outcome_override_check;

alter table public.rec_games
  add constraint rec_games_advance_outcome_override_check
  check (advance_outcome_override is null or advance_outcome_override in ('fs', 'fw'));

comment on column public.rec_games.advance_outcome_override is 'Advance wizard commissioner marker for fair sim (fs) or force win (fw).';

alter table public.rec_games enable row level security;
