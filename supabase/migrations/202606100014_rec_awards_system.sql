-- REC Awards system tables

create table public.rec_awards (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  season_number int not null,
  award_key text not null,
  award_name text not null,
  award_category text not null check (award_category in ('football', 'league', 'community')),
  requires_voting boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'voting', 'voting_closed', 'commissioner_review', 'completed', 'no_nominees')),
  voting_message_id text,
  voting_channel_id text,
  voting_opens_at timestamptz,
  voting_closes_at timestamptz,
  payout_amount numeric not null default 100,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(league_id, season_number, award_key)
);
alter table public.rec_awards enable row level security;

create table public.rec_award_nominees (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references public.rec_awards(id) on delete cascade,
  user_id uuid not null,
  team_name text,
  performance_score numeric not null default 0,
  vote_count int not null default 0,
  final_score numeric,
  display_label text,
  raw_stats jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(award_id, user_id)
);
alter table public.rec_award_nominees enable row level security;

create table public.rec_award_votes (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references public.rec_awards(id) on delete cascade,
  voter_user_id uuid not null,
  nominee_user_id uuid not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(award_id, voter_user_id)
);
alter table public.rec_award_votes enable row level security;

-- Permanent history — never deleted
create table public.rec_award_winners (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  season_number int not null,
  award_key text not null,
  award_name text not null,
  winner_user_id uuid not null,
  winner_team_name text,
  winner_discord_id text,
  performance_score numeric,
  vote_count int not null default 0,
  final_score numeric,
  payout_amount numeric not null default 100,
  payout_issued boolean not null default false,
  payout_ledger_id uuid,
  created_at timestamptz default now(),
  unique(league_id, season_number, award_key)
);
alter table public.rec_award_winners enable row level security;

-- POTY: add category + highlight reference
alter table public.rec_poty_nominations
  add column if not exists poty_category text,
  add column if not exists highlight_id uuid,
  add column if not exists highlight_url text;
