-- Universal Record Book (see 08_RECORDS/UNIVERSAL_RECORD_BOOK.md in the uploaded XP Progression
-- Engine plan): generalizes RTI's existing NFL-baseline Top-5 record system
-- (rec_immortality_nfl_records, apps/api/src/modules/immortality/nfl-record-holders.service.ts)
-- to non-RTI leagues too, without touching that live, already-working RTI feature. Deliberately a
-- separate table keyed by plain league_id (works for any league) rather than a migration of RTI's
-- immortality_league_id-keyed data -- record-book.service.ts explicitly no-ops for RTI leagues,
-- which keep using their existing system. Consolidating onto one shared table/engine is a later
-- "Phase 6" cleanup once both are independently proven, not this pass.
create table if not exists public.rec_record_book_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  scope text not null check (scope in ('game', 'season', 'career')),
  category text not null,
  rank integer not null check (rank between 1 and 5),
  holder_type text not null check (holder_type in ('NFL_BASELINE', 'REC_PLAYER')),
  holder_name text not null,
  player_id uuid references public.rec_players(id) on delete set null,
  user_id uuid references public.rec_users(id) on delete set null,
  team_id uuid references public.rec_teams(id) on delete set null,
  value numeric not null,
  season_number integer,
  week_number integer,
  set_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (league_id, scope, category, rank)
);
alter table public.rec_record_book_entries enable row level security;
create index if not exists rec_record_book_entries_league_scope_idx
  on public.rec_record_book_entries (league_id, scope);
