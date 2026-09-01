-- Rise to Immortality "Progression Tree" (§10 of the Origins design spec): lets a
-- prospect buy Characteristics with Player XP over a career instead of only at
-- creation. Existing rows are creation-time picks, so they backfill as free/zero-XP.
alter table public.rec_immortality_prospect_characteristics
  add column if not exists unlocked_at timestamptz not null default now(),
  add column if not exists xp_spent integer not null default 0,
  add column if not exists source text not null default 'creation';

alter table public.rec_immortality_prospect_characteristics
  drop constraint if exists rec_immortality_prospect_characteristics_source_check;
alter table public.rec_immortality_prospect_characteristics
  add constraint rec_immortality_prospect_characteristics_source_check
  check (source in ('creation', 'progression_tree'));
