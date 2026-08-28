-- Performance-granted Madden 27 abilities for Rise to Immortality created players.
-- Slots come from Gold weeks / season / career / awards. In-game Bronze/Silver/Gold
-- still requires the catalog attribute floors.

create table if not exists public.rec_immortality_ability_grants (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  event_type text not null,
  source_id text not null,
  slots integer not null default 1 check (slots >= 0 and slots <= 4),
  created_at timestamptz not null default now(),
  unique (prospect_id, event_type, source_id)
);
alter table public.rec_immortality_ability_grants enable row level security;
create index if not exists rec_immortality_ability_grants_prospect_idx
  on public.rec_immortality_ability_grants (prospect_id, created_at);

create table if not exists public.rec_immortality_prospect_abilities (
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  ability_id text not null,
  ability_name text not null,
  kind text not null check (kind in ('superstar','xfactor')),
  selected_at timestamptz not null default now(),
  primary key (prospect_id, ability_id)
);
alter table public.rec_immortality_prospect_abilities enable row level security;
create index if not exists rec_immortality_prospect_abilities_prospect_idx
  on public.rec_immortality_prospect_abilities (prospect_id);
