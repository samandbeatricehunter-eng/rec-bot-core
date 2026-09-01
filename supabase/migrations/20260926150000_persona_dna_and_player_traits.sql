-- Real Persona DNA (60-trait catalog + Mindset Focus) and Player Traits (QB/MIKE
-- gameplay-tendency catalogs), per the Origins design spec §04/§07. Distinct from
-- rec_immortality_persona_results (the 6-dimension backstory blend, already built).
create table if not exists public.rec_immortality_prospect_persona_dna (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  trait_key text not null,
  created_at timestamptz not null default now(),
  unique (prospect_id, trait_key)
);
alter table public.rec_immortality_prospect_persona_dna enable row level security;

create table if not exists public.rec_immortality_prospect_mindset_focus (
  prospect_id uuid primary key references public.rec_immortality_prospects(id) on delete cascade,
  focus_key text not null,
  created_at timestamptz not null default now()
);
alter table public.rec_immortality_prospect_mindset_focus enable row level security;

create table if not exists public.rec_immortality_prospect_player_traits (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  trait_key text not null,
  position_group text not null,
  created_at timestamptz not null default now(),
  unique (prospect_id, trait_key)
);
alter table public.rec_immortality_prospect_player_traits enable row level security;
