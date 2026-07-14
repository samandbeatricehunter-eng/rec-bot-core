-- REC Guide, backward-compatible Weekly Submissions routing, normalized player
-- stat submissions, and auditable recruiting commitment changes.

alter table public.rec_server_routes
  add column if not exists weekly_submissions_channel_id text,
  add column if not exists rec_guide_channel_id text,
  add column if not exists weekly_submissions_panel_message_id text;

update public.rec_server_routes
set weekly_submissions_channel_id = box_scores_channel_id
where weekly_submissions_channel_id is null and box_scores_channel_id is not null;

create table if not exists public.rec_guide_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  discord_channel_id text not null,
  discord_message_id text not null,
  section_index integer not null check (section_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, section_index),
  unique (discord_channel_id, discord_message_id)
);
alter table public.rec_guide_messages enable row level security;

create table if not exists public.rec_weekly_submission_panels (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  season_stage text not null,
  week_number integer,
  discord_channel_id text not null,
  discord_message_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, season_number, season_stage, week_number)
);
alter table public.rec_weekly_submission_panels enable row level security;
create index if not exists rec_weekly_submission_panels_active_idx
  on public.rec_weekly_submission_panels(league_id, is_active);

create table if not exists public.rec_player_stat_submissions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  season_stage text not null,
  week_number integer,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id),
  submitted_by_user_id uuid references public.rec_users(id),
  submitted_by_discord_id text not null,
  watched_player_id uuid references public.rec_watched_players(id),
  player_display_name text not null,
  normalized_player_name text not null,
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected','removed')),
  reviewed_by_discord_id text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, team_id, submitted_by_discord_id, normalized_player_name)
);
alter table public.rec_player_stat_submissions enable row level security;
create index if not exists rec_player_stat_submissions_context_idx
  on public.rec_player_stat_submissions(league_id, season_number, week_number, team_id, status);

create table if not exists public.rec_player_stat_lines (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.rec_player_stat_submissions(id) on delete cascade,
  category text not null check (category in ('passing','rushing','receiving','defense','kick_returns','punt_returns','kicking','punting')),
  stats jsonb not null default '{}'::jsonb,
  raw_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, category)
);
alter table public.rec_player_stat_lines enable row level security;
create index if not exists rec_player_stat_lines_submission_idx on public.rec_player_stat_lines(submission_id);

create table if not exists public.rec_player_stat_audit (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.rec_player_stat_submissions(id) on delete cascade,
  action text not null,
  actor_discord_id text,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_player_stat_audit enable row level security;
create index if not exists rec_player_stat_audit_submission_idx on public.rec_player_stat_audit(submission_id, created_at);

alter table public.rec_recruiting_profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists normalized_full_name text,
  add column if not exists submitted_by_user_id uuid references public.rec_users(id),
  add column if not exists submitted_by_discord_id text,
  add column if not exists committed_at timestamptz;

alter table public.rec_recruiting_profiles drop constraint if exists rec_recruiting_profiles_status_check;
alter table public.rec_recruiting_profiles
  add constraint rec_recruiting_profiles_status_check
  check (status in ('uncommitted','committed','decommitted','flipped','withdrawn','signed'));

create table if not exists public.rec_recruiting_commitment_history (
  id uuid primary key default gen_random_uuid(),
  recruit_id uuid not null references public.rec_recruiting_profiles(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  from_status text,
  to_status text not null,
  from_team_id uuid references public.rec_teams(id),
  to_team_id uuid references public.rec_teams(id),
  changed_by_discord_id text,
  change_reason text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_recruiting_commitment_history enable row level security;
create index if not exists rec_recruiting_history_recruit_idx
  on public.rec_recruiting_commitment_history(recruit_id, created_at);
