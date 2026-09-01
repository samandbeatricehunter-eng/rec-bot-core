-- Rise to Immortality: the commissioner picks their franchise directly at league creation
-- (via the existing generic completeWizard -> rec_team_assignments path -- no new table needed
-- for that). Everyone else creates an Owner (name + personality interview + headshot) after
-- finishing Origins for both sides, then is offered 4 random still-available franchises to pick
-- from instead of a batch virtual-draft solve.

create table if not exists public.rec_immortality_owners (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  first_name text,
  last_name text,
  headshot_url text,
  origins_step text not null default 'identity' check (origins_step in ('identity', 'persona', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (immortality_league_id, user_id)
);
alter table public.rec_immortality_owners enable row level security;

create table if not exists public.rec_immortality_owner_persona_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.rec_immortality_owners(id) on delete cascade,
  scores jsonb not null,
  primary_dimension text not null,
  secondary_dimension text not null,
  label text not null,
  answers jsonb not null default '[]'::jsonb,
  formula_version text not null default 'immortality-persona-v1',
  created_at timestamptz not null default now(),
  unique (owner_id)
);
alter table public.rec_immortality_owner_persona_results enable row level security;

-- offered_team_ids is fixed at generation time and never regenerated once a user has a row --
-- re-rolling on demand would let someone game the division-balancing weights.
create table if not exists public.rec_immortality_team_offers (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  offered_team_ids uuid[] not null,
  chosen_team_id uuid references public.rec_teams(id),
  generated_at timestamptz not null default now(),
  chosen_at timestamptz,
  unique (immortality_league_id, user_id)
);
alter table public.rec_immortality_team_offers enable row level security;
