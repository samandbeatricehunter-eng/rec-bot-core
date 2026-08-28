-- Live rookie-draft stock: grades update after each Origins stage and when the class grows.
-- Franchise pick order is seeded once so later joiners do not reshuffle existing slots.

create table if not exists public.rec_immortality_draft_grades (
  prospect_id uuid primary key references public.rec_immortality_prospects(id) on delete cascade,
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  side text not null check (side in ('offense','defense')),
  raw_score integer not null default 0,
  stage_scores jsonb not null default '{}'::jsonb,
  draft_value integer not null default 0,
  class_rank integer not null default 1,
  class_size integer not null default 1,
  projected_round integer not null default 4,
  preferred_min integer not null default 3,
  preferred_max integer not null default 5,
  grade_label text not null default 'B',
  stock text not null default 'new' check (stock in ('new','rising','holding','sliding')),
  ready boolean not null default false,
  previous_class_rank integer,
  previous_draft_value integer,
  updated_at timestamptz not null default now()
);
alter table public.rec_immortality_draft_grades enable row level security;
create index if not exists rec_immortality_draft_grades_league_side_idx
  on public.rec_immortality_draft_grades (immortality_league_id, side, class_rank);

create table if not exists public.rec_immortality_draft_orders (
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  pick_order integer not null,
  participating boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (immortality_league_id, team_id),
  unique (immortality_league_id, pick_order)
);
alter table public.rec_immortality_draft_orders enable row level security;
create index if not exists rec_immortality_draft_orders_pick_idx
  on public.rec_immortality_draft_orders (immortality_league_id, pick_order);
