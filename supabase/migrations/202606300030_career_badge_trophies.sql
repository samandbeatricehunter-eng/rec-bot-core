-- Permanent "Career Trophies": when a season ends (league advances out of
-- super_bowl into the offseason), each season badge a coach holds is converted
-- into a row here, carrying its tier. The "×N" counter shown on profiles is the
-- count of distinct season_number per (user, badge_key, tier). Idempotent insert
-- on the unique key keeps re-running the advance from double-counting. The coach's
-- weekly+season rec_badge_ownership rows are wiped AFTER this conversion runs.
create table if not exists public.rec_user_season_badge_trophies (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null,
  badge_key text not null,
  tier text not null default 'normal',
  season_number integer not null,
  badge_label text,
  badge_description text,
  created_at timestamptz not null default now(),
  unique (league_id, user_id, badge_key, tier, season_number)
);

alter table public.rec_user_season_badge_trophies enable row level security;

create index if not exists rec_user_season_badge_trophies_lookup
  on public.rec_user_season_badge_trophies (league_id, user_id, badge_key, tier);
