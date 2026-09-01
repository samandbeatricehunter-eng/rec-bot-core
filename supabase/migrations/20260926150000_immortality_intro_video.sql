-- Rise to Immortality: commissioner-set intro video that every member must watch to completion
-- before Origins unlocks. No url set = no gate (skip straight to Origins), so this is opt-in.

alter table public.rec_immortality_leagues
  add column if not exists intro_video_url text;

create table if not exists public.rec_immortality_intro_views (
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (immortality_league_id, user_id)
);
alter table public.rec_immortality_intro_views enable row level security;
