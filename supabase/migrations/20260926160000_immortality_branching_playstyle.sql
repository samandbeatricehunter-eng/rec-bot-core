-- Rise to Immortality: Branching Playstyle results for QB and MIKE (the two positions with a
-- fixed baseline + real attribute-floor/ceiling drill content). Separate from the older
-- rec_immortality_playstyle_results (flat voting model, still used by every other position).
create table if not exists public.rec_immortality_branching_playstyle_results (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  primary_archetype text not null,
  secondary_archetype text,
  blend jsonb not null,
  attribute_deltas jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  formula_version text not null default 'immortality-playstyle-branching-v1',
  created_at timestamptz not null default now(),
  unique (prospect_id)
);
alter table public.rec_immortality_branching_playstyle_results enable row level security;
