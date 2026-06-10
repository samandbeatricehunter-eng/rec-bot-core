-- Feature 7: Highlight posts (one payout embed per user per advance week)
create table public.rec_highlight_posts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  team_id uuid references public.rec_teams(id),
  season_number integer not null,
  week_number integer not null,
  season_stage text,
  discord_channel_id text,
  discord_message_id text,
  message_url text,
  content text,
  is_first_this_week boolean not null default false,
  payout_review_id uuid,
  payout_issued boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_highlight_posts enable row level security;
create index on public.rec_highlight_posts (league_id, season_number, week_number, user_id);

-- Feature 7/8: POTY nominations (one per nominator per season, replaced on re-submit)
create table public.rec_poty_nominations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  nominator_user_id uuid not null references public.rec_users(id),
  nominee_user_id uuid not null references public.rec_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id, season_number, nominator_user_id)
);
alter table public.rec_poty_nominations enable row level security;

-- Feature 8: GOTY nominations (one per nominator per season, replaced on re-submit)
create table public.rec_goty_nominations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  nominator_user_id uuid not null references public.rec_users(id),
  nominated_game_id uuid references public.rec_game_results(id),
  home_team_label text,
  away_team_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id, season_number, nominator_user_id)
);
alter table public.rec_goty_nominations enable row level security;

-- Feature 10: Dev upgrade prize events
create table public.rec_dev_upgrade_prizes (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid references public.rec_users(id),
  team_id uuid references public.rec_teams(id),
  season_number integer not null,
  week_number integer not null,
  player_name text,
  madden_player_id text,
  old_dev_trait text,
  new_dev_trait text,
  prize_amount integer not null default 0,
  issued boolean not null default false,
  ledger_id uuid,
  import_job_id text,
  created_at timestamptz not null default now()
);
alter table public.rec_dev_upgrade_prizes enable row level security;
create index on public.rec_dev_upgrade_prizes (league_id, issued, created_at);
create unique index on public.rec_dev_upgrade_prizes (league_id, import_job_id, madden_player_id) where import_job_id is not null;

-- Feature 10: Track dev_trait + overall_rating on players for change detection
alter table public.rec_players
  add column if not exists dev_trait text,
  add column if not exists overall_rating integer;

-- EOS polls patch: tiebreaker tracking
alter table public.rec_eos_award_polls
  add column if not exists tiebreaker_needed boolean not null default false,
  add column if not exists tied_candidate_ids jsonb;
