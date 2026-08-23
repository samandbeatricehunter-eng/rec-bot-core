-- Commissioner tool: reset how much a user has spent toward their season's core/non-core
-- attribute cap. Spend itself is derived live by summing rec_purchases (no stored counter to
-- zero out) -- a reset just records a cutoff timestamp per (league, user, season, category);
-- purchases at or before that cutoff stop counting toward the cap, without touching the
-- purchase rows themselves (the player keeps whatever attribute changes those purchases already
-- applied -- this resets next season's budget, not history).
create table if not exists public.rec_attribute_cap_resets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  season_number integer not null,
  category text not null check (category in ('core', 'non_core')),
  reset_at timestamptz not null default now(),
  reset_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (league_id, user_id, season_number, category)
);
alter table public.rec_attribute_cap_resets enable row level security;
create index if not exists rec_attribute_cap_resets_lookup_idx
  on public.rec_attribute_cap_resets (league_id, user_id, season_number);
