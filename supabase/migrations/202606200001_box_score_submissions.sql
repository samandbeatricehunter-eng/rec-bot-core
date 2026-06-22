create table public.rec_box_score_submissions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer,
  week_number integer,
  phase text,

  -- Submitter
  submitted_by_discord_id text not null,
  submitted_by_user_id uuid references public.rec_users(id) on delete set null,

  -- Discord context
  discord_guild_id text,
  discord_channel_id text,
  discord_message_id text,
  image_urls jsonb not null default '[]'::jsonb,

  -- OCR abbreviations (raw from parser)
  team1_abbr text,
  team2_abbr text,

  -- Resolved team + user IDs
  home_team_id uuid references public.rec_teams(id) on delete set null,
  away_team_id uuid references public.rec_teams(id) on delete set null,
  home_user_id uuid references public.rec_users(id) on delete set null,
  away_user_id uuid references public.rec_users(id) on delete set null,

  -- Score
  home_score integer,
  away_score integer,
  -- { team1: [q1,q2,q3,q4,ot], team2: [q1,q2,q3,q4,ot] }
  quarter_scores jsonb,

  -- All parsed team stats including derived red_zone_def_percentage
  -- { stat_key: { team1: string, team2: string }, ... }
  team_stats jsonb,

  -- Linked game record (null if auto-match failed)
  game_id uuid references public.rec_games(id) on delete set null,

  -- Parse metadata
  parse_warnings jsonb not null default '[]'::jsonb,

  -- ── Comeback stats ────────────────────────────────────────────────────────
  -- Null on all comeback fields = no comeback occurred (winner was never trailing)

  -- Largest point deficit the winner faced at any quarter break
  comeback_deficit integer,
  -- Quarter at which the max deficit occurred (1–4)
  comeback_deficit_quarter integer,
  -- comeback_deficit / quarters_remaining_at_max_deficit (higher = faster comeback)
  comeback_rate numeric(8, 2),
  -- Team that made the comeback
  comeback_winner_team_id uuid references public.rec_teams(id) on delete set null,
  -- True if the winner was trailing entering Q4 (after Q3)
  fourth_quarter_comeback boolean not null default false,

  -- ── Review lifecycle: draft → pending → approved | denied ─────────────────
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'denied')),
  reviewed_by_discord_id text,
  reviewed_at timestamptz,
  denied_reason text,
  payout_issued boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_box_score_submissions enable row level security;

create index on public.rec_box_score_submissions(league_id, status, created_at desc);
create index on public.rec_box_score_submissions(submitted_by_discord_id);
create index on public.rec_box_score_submissions(game_id) where game_id is not null;
create index on public.rec_box_score_submissions(discord_guild_id, status);
create index on public.rec_box_score_submissions(league_id, season_number, fourth_quarter_comeback) where fourth_quarter_comeback = true;
create index on public.rec_box_score_submissions(league_id, season_number, comeback_deficit) where comeback_deficit is not null;
