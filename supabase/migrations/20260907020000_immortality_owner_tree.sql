-- Rise to Immortality Pass 7 (Owner Tree / Franchise Pillar): a from-scratch progression tree
-- for rec_immortality_owners, parallel to (but independent from) the prospect Player-XP system.

create table if not exists public.rec_immortality_owner_xp_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.rec_immortality_owners(id) on delete cascade,
  event_type text not null,
  source_id text not null,
  xp_delta int not null,
  season_number int,
  week_number int,
  formula_version text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, event_type, source_id)
);
alter table public.rec_immortality_owner_xp_ledger enable row level security;
create index if not exists rec_immortality_owner_xp_ledger_owner_idx on public.rec_immortality_owner_xp_ledger (owner_id);

-- Serialize Owner XP debits per owner so concurrent purchase/investment requests can't overspend,
-- same pattern as rec_immortality_spend_xp (20260828250000_atomic_immortality_xp_spend.sql).
create or replace function public.rec_immortality_spend_owner_xp(
  p_owner_id uuid,
  p_event_type text,
  p_source_id text,
  p_xp_delta integer,
  p_formula_version text,
  p_season_number integer default null,
  p_week_number integer default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_xp integer;
begin
  perform 1 from public.rec_immortality_owners where id = p_owner_id for update;
  if not found then
    return false;
  end if;

  select coalesce(sum(xp_delta), 0)::integer into current_xp
  from public.rec_immortality_owner_xp_ledger where owner_id = p_owner_id;

  if current_xp + p_xp_delta < 0 then
    return false;
  end if;

  insert into public.rec_immortality_owner_xp_ledger (
    owner_id, event_type, source_id, xp_delta, season_number, week_number, formula_version
  ) values (
    p_owner_id, p_event_type, p_source_id, p_xp_delta, p_season_number, p_week_number, p_formula_version
  );

  return true;
end;
$$;

revoke all on function public.rec_immortality_spend_owner_xp(uuid, text, text, integer, text, integer, integer) from public;
grant execute on function public.rec_immortality_spend_owner_xp(uuid, text, text, integer, text, integer, integer) to service_role;

create table if not exists public.rec_immortality_owner_progression (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.rec_immortality_owners(id) on delete cascade,
  characteristic_key text not null,
  slot_cost int not null default 0,
  xp_spent int not null default 0,
  source text not null default 'progression_tree',
  created_at timestamptz not null default now(),
  unique (owner_id, characteristic_key)
);
alter table public.rec_immortality_owner_progression enable row level security;
create index if not exists rec_immortality_owner_progression_owner_idx on public.rec_immortality_owner_progression (owner_id);

-- One flat "invest now, mature next season" mechanic (no catalog of investment types yet -- see
-- characteristics_OWNER.json's Organizational Influence lane, which only gates whether this is
-- unlocked and bonus-stacks the ROI rate; a fuller investment-type catalog is a natural Pass 9/10
-- addition once real usage shows whether one flat track is enough).
create table if not exists public.rec_immortality_franchise_investments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.rec_immortality_owners(id) on delete cascade,
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  xp_invested int not null,
  invested_season_number int not null,
  matures_season_number int not null,
  roi_rate numeric not null,
  status text not null default 'active' check (status in ('active', 'matured')),
  created_at timestamptz not null default now(),
  matured_at timestamptz
);
alter table public.rec_immortality_franchise_investments enable row level security;
create index if not exists rec_immortality_franchise_investments_owner_idx on public.rec_immortality_franchise_investments (owner_id, status);
