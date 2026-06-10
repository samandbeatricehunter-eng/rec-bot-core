-- Badge prestige system: tracks lifetime earn counts and prestige tier per user per badge type.
-- Prestige tiers: bronze (1+), silver (5+), gold (15+), platinum (30+), diamond (50+).
-- This table survives season resets — it accumulates across all seasons.

create table if not exists public.rec_user_badge_prestige (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  badge_name text not null,
  total_earned integer not null default 0,
  prestige_tier text not null default 'bronze',
  first_earned_at timestamptz,
  last_earned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, badge_name)
);

alter table public.rec_user_badge_prestige enable row level security;
