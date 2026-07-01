-- Global Legends catalog (game-agnostic reference data, not league-scoped). One row
-- per legend player with their full 54-attribute estimate. What's actually sold in a
-- given league is tracked via rec_purchases (purchase_type='legend', details->>'legendId').
create table if not exists public.rec_legend_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position text not null,
  position_group text not null check (position_group in ('offense', 'defense')),
  est_ovr numeric not null,
  height text,
  weight integer,
  hand text,
  jersey_number integer,
  dev_trait text,
  archetype text,
  build_note text,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (name, position)
);
alter table public.rec_legend_catalog enable row level security;

create index if not exists rec_legend_catalog_group_position_idx
  on public.rec_legend_catalog(position_group, position);
