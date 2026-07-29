-- REC badge v2 catalog plus the independent H2H Comp matchmaking/stat system.
-- The API remains the only data-access path; all public tables have RLS enabled and no
-- anon/authenticated policies.

create table if not exists public.rec_badge_catalog (
  badge_key text not null,
  game text not null check (game in ('madden_26', 'madden_27', 'cfb_27', 'all')),
  mode text not null check (mode in ('dynasty', 'comp', 'global')),
  scope text not null check (scope in ('game', 'season', 'career')),
  category text not null,
  label text not null,
  description text not null,
  active_qualifier boolean not null default false,
  sort_order integer not null default 0,
  primary key (badge_key, game, mode)
);
alter table public.rec_badge_catalog enable row level security;

alter table public.rec_badge_ownership
  alter column league_id drop not null,
  add column if not exists game text,
  add column if not exists mode text not null default 'dynasty',
  add column if not exists is_active boolean not null default true,
  add column if not exists earned_at timestamptz,
  add column if not exists progress_value numeric,
  add column if not exists definition_version integer not null default 2;

create index if not exists rec_badge_ownership_v2_user_idx
  on public.rec_badge_ownership (user_id, game, mode, badge_scope, is_active);
create unique index if not exists rec_badge_ownership_comp_unique_idx
  on public.rec_badge_ownership (user_id, badge_key, game, mode)
  where mode = 'comp';

alter table public.rec_badge_events
  alter column league_id drop not null;

create table if not exists public.rec_comp_profiles (
  user_id uuid primary key references public.rec_users(id) on delete cascade,
  console text check (console in ('xbox', 'ps5', 'pc')),
  gamer_tag text,
  cross_play_enabled boolean not null default false,
  matchmaking_suspended_until timestamptz,
  matchmaking_suspension_reason text,
  updated_at timestamptz not null default now()
);
alter table public.rec_comp_profiles enable row level security;

create table if not exists public.rec_comp_seasons (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  label text not null,
  unique (starts_at, ends_at),
  check (ends_at > starts_at)
);
alter table public.rec_comp_seasons enable row level security;

create table if not exists public.rec_comp_queue_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  game text not null check (game in ('madden_26', 'madden_27', 'cfb_27')),
  roster_mode text not null check (roster_mode in ('default', 'cut')),
  quarter_length integer check (quarter_length between 4 and 8),
  accelerated_clock boolean,
  accelerated_clock_minimum integer check (
    accelerated_clock_minimum is null or accelerated_clock_minimum between 15 and 25
  ),
  queued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 minutes'),
  unique (user_id)
);
alter table public.rec_comp_queue_entries enable row level security;
create index if not exists rec_comp_queue_game_expiry_idx
  on public.rec_comp_queue_entries (game, roster_mode, expires_at);

create table if not exists public.rec_comp_matches (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('madden_26', 'madden_27', 'cfb_27')),
  roster_mode text not null check (roster_mode in ('default', 'cut')),
  requester_user_id uuid not null references public.rec_users(id) on delete restrict,
  opponent_user_id uuid not null references public.rec_users(id) on delete restrict,
  home_user_id uuid references public.rec_users(id) on delete restrict,
  away_user_id uuid references public.rec_users(id) on delete restrict,
  requester_team_id uuid references public.rec_teams(id) on delete set null,
  opponent_team_id uuid references public.rec_teams(id) on delete set null,
  status text not null default 'requested' check (
    status in ('requested', 'accepted', 'submission_pending', 'correction_pending',
               'admin_review', 'completed', 'voided', 'canceled', 'expired')
  ),
  quarter_length integer check (quarter_length between 4 and 8),
  accelerated_clock boolean,
  accelerated_clock_minimum integer check (
    accelerated_clock_minimum is null or accelerated_clock_minimum between 15 and 25
  ),
  requested_at timestamptz not null default now(),
  request_expires_at timestamptz not null default (now() + interval '10 minutes'),
  accepted_at timestamptz,
  active_expires_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  check (requester_user_id <> opponent_user_id)
);
alter table public.rec_comp_matches enable row level security;
create unique index if not exists rec_comp_one_open_match_per_pair_idx
  on public.rec_comp_matches (
    least(requester_user_id, opponent_user_id),
    greatest(requester_user_id, opponent_user_id)
  )
  where status in ('requested', 'accepted', 'submission_pending', 'correction_pending', 'admin_review');
create index if not exists rec_comp_matches_participants_idx
  on public.rec_comp_matches (requester_user_id, opponent_user_id, status);

create table if not exists public.rec_comp_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.rec_comp_matches(id) on delete cascade,
  author_user_id uuid not null references public.rec_users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.rec_comp_messages enable row level security;
create index if not exists rec_comp_messages_match_idx
  on public.rec_comp_messages (match_id, created_at);

create table if not exists public.rec_comp_stream_shares (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.rec_comp_matches(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  stream_url text not null,
  created_at timestamptz not null default now()
);
alter table public.rec_comp_stream_shares enable row level security;

create table if not exists public.rec_comp_box_score_submissions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.rec_comp_matches(id) on delete cascade,
  submitted_by_user_id uuid not null references public.rec_users(id) on delete restrict,
  reviewer_user_id uuid not null references public.rec_users(id) on delete restrict,
  revision integer not null default 1,
  image_urls jsonb not null default '[]'::jsonb,
  parsed_payload jsonb not null default '{}'::jsonb,
  corrected_payload jsonb not null default '{}'::jsonb,
  status text not null default 'awaiting_opponent' check (
    status in ('draft', 'awaiting_opponent', 'awaiting_submitter', 'admin_review',
               'approved', 'voided')
  ),
  review_note text,
  response_due_at timestamptz not null default (now() + interval '8 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_comp_box_score_submissions enable row level security;
create index if not exists rec_comp_box_scores_match_idx
  on public.rec_comp_box_score_submissions (match_id, revision desc);
create index if not exists rec_comp_box_scores_deadline_idx
  on public.rec_comp_box_score_submissions (status, response_due_at);

create table if not exists public.rec_comp_game_stats (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.rec_comp_matches(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  opponent_user_id uuid not null references public.rec_users(id) on delete cascade,
  game text not null,
  won boolean not null default false,
  lost boolean not null default false,
  tied boolean not null default false,
  points_for integer not null default 0,
  points_against integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  played_at timestamptz not null default now(),
  unique (match_id, user_id)
);
alter table public.rec_comp_game_stats enable row level security;
create index if not exists rec_comp_game_stats_user_game_idx
  on public.rec_comp_game_stats (user_id, game, played_at);

create table if not exists public.rec_comp_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.rec_comp_matches(id) on delete cascade,
  reporter_user_id uuid not null references public.rec_users(id) on delete restrict,
  reported_user_id uuid references public.rec_users(id) on delete restrict,
  report_type text not null check (
    report_type in ('server_issue', 'dashed_first_half', 'quit_out', 'inappropriate_behavior', 'other')
  ),
  details text,
  evidence_urls jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'awaiting_response', 'confirmed', 'disputed', 'validated', 'dismissed')
  ),
  response text,
  response_due_at timestamptz,
  counts_toward_dasher boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.rec_users(id) on delete set null
);
alter table public.rec_comp_reports enable row level security;
create index if not exists rec_comp_reports_user_season_idx
  on public.rec_comp_reports (reported_user_id, report_type, created_at, status);

create table if not exists public.rec_comp_user_season_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  season_id uuid not null references public.rec_comp_seasons(id) on delete cascade,
  flag_type text not null check (flag_type in ('connection_issue', 'dasher')),
  active boolean not null default true,
  activated_at timestamptz not null default now(),
  expires_at timestamptz,
  clean_games_since integer not null default 0,
  unique (user_id, season_id, flag_type)
);
alter table public.rec_comp_user_season_flags enable row level security;

create table if not exists public.rec_comp_admin_cases (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.rec_comp_matches(id) on delete cascade,
  submission_id uuid references public.rec_comp_box_score_submissions(id) on delete cascade,
  report_id uuid references public.rec_comp_reports(id) on delete cascade,
  case_type text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  summary text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_auth_user_id uuid
);
alter table public.rec_comp_admin_cases enable row level security;
create index if not exists rec_comp_admin_cases_open_idx
  on public.rec_comp_admin_cases (status, created_at);

-- Fixed global two-month Comp seasons.
insert into public.rec_comp_seasons (starts_at, ends_at, label)
values
  ('2026-07-01T05:00:00Z', '2026-09-01T05:00:00Z', 'July–August 2026'),
  ('2026-09-01T05:00:00Z', '2026-11-01T05:00:00Z', 'September–October 2026'),
  ('2026-11-01T05:00:00Z', '2027-01-01T06:00:00Z', 'November–December 2026')
on conflict (starts_at, ends_at) do nothing;
