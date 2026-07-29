-- Mirrors rec_manual_championship_credits: a place to preserve an achievement that can no
-- longer be derived from live data (most commonly: the league that issued it was deleted via
-- rec_delete_league, which hard-deletes rec_award_winners/rec_eos_award_polls). Career awards
-- should travel with the user, not disappear when a league is torn down for inactivity.
create table if not exists public.rec_manual_award_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  award_key text not null,
  award_name text not null,
  game text,
  season_number integer,
  source_key text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists rec_manual_award_credits_user_id_idx on public.rec_manual_award_credits (user_id);
alter table public.rec_manual_award_credits enable row level security;
