-- Match evidence extras, highlight clips, and tournament-bracket wagers.

alter table public.rec_site_tournament_matches
  add column if not exists stream_url text,
  add column if not exists player_a_score integer,
  add column if not exists player_b_score integer,
  add column if not exists betting_open boolean not null default true;

create table if not exists public.rec_site_tournament_highlights (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.rec_site_tournaments(id) on delete cascade,
  match_id uuid not null references public.rec_site_tournament_matches(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  url text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  payout_issued_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(url) between 8 and 500)
);
alter table public.rec_site_tournament_highlights enable row level security;
create index if not exists rec_site_tournament_highlights_tourney_idx
  on public.rec_site_tournament_highlights (tournament_id, status, created_at desc);
create index if not exists rec_site_tournament_highlights_match_user_idx
  on public.rec_site_tournament_highlights (match_id, user_id);

create table if not exists public.rec_site_tournament_wagers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.rec_site_tournaments(id) on delete cascade,
  match_id uuid not null references public.rec_site_tournament_matches(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  market text not null check (market in ('house', 'h2h')),
  pick_user_id uuid not null references public.rec_users(id),
  stake integer not null check (stake > 0),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'settled', 'refunded', 'void')),
  accepted_by_user_id uuid references public.rec_users(id),
  payout_amount integer not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.rec_site_tournament_wagers enable row level security;
create index if not exists rec_site_tournament_wagers_match_idx
  on public.rec_site_tournament_wagers (match_id, status);
