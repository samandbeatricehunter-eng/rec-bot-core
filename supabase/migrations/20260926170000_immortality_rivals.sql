-- Rise to Immortality: one rival team per prospect side (offense/defense), set by the user.
-- Same team can be picked for both sides -- their bonuses stack, nothing here prevents it.
create table if not exists public.rec_immortality_rivals (
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  side text not null check (side in ('offense','defense')),
  rival_team_id uuid not null references public.rec_teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (immortality_league_id, user_id, side)
);
alter table public.rec_immortality_rivals enable row level security;
