-- Cloudflare Stream fields for tournament highlights, plus a full sportsbook wager schema.

alter table public.rec_site_tournament_highlights
  alter column url drop not null,
  drop constraint if exists rec_site_tournament_highlights_url_check;

alter table public.rec_site_tournament_highlights
  add column if not exists cloudflare_stream_uid text,
  add column if not exists storage_provider text,
  add column if not exists media_status text not null default 'pending',
  add column if not exists playback_url text;

alter table public.rec_site_tournament_highlights
  drop constraint if exists rec_site_tournament_highlights_media_status_check;

alter table public.rec_site_tournament_highlights
  add constraint rec_site_tournament_highlights_media_status_check
  check (media_status in ('pending', 'uploading', 'processing', 'ready', 'failed'));

alter table public.rec_site_tournament_matches
  add column if not exists box_score jsonb;

alter table public.rec_site_tournament_wagers
  drop constraint if exists rec_site_tournament_wagers_market_check;

alter table public.rec_site_tournament_wagers
  add column if not exists wager_kind text,
  add column if not exists market_key text,
  add column if not exists pick text,
  add column if not exists line numeric,
  add column if not exists odds numeric,
  add column if not exists potential_payout integer not null default 0,
  add column if not exists is_parlay boolean not null default false;

update public.rec_site_tournament_wagers
set
  wager_kind = case when market = 'h2h' then 'peer' else 'house' end,
  market_key = coalesce(market_key, 'moneyline'),
  pick = coalesce(pick, pick_user_id::text)
where wager_kind is null;

alter table public.rec_site_tournament_wagers
  alter column wager_kind set default 'house',
  alter column market_key set default 'moneyline';

update public.rec_site_tournament_wagers
set wager_kind = coalesce(wager_kind, 'house'),
    market_key = coalesce(market_key, 'moneyline');

alter table public.rec_site_tournament_wagers
  alter column wager_kind set not null,
  alter column market_key set not null;

alter table public.rec_site_tournament_wagers
  drop constraint if exists rec_site_tournament_wagers_kind_check;

alter table public.rec_site_tournament_wagers
  add constraint rec_site_tournament_wagers_kind_check
  check (wager_kind in ('house', 'peer'));

create table if not exists public.rec_site_tournament_wager_legs (
  id uuid primary key default gen_random_uuid(),
  wager_id uuid not null references public.rec_site_tournament_wagers(id) on delete cascade,
  match_id uuid not null references public.rec_site_tournament_matches(id) on delete cascade,
  market_key text not null,
  pick text not null,
  line numeric,
  odds numeric not null,
  result text
    check (result is null or result in ('won', 'lost', 'push')),
  created_at timestamptz not null default now()
);
alter table public.rec_site_tournament_wager_legs enable row level security;
create index if not exists rec_site_tournament_wager_legs_wager_idx
  on public.rec_site_tournament_wager_legs (wager_id);
