-- CFB postseason, billing idempotency, configurable economy limits, and league bans.

alter table public.rec_league_configuration
  add column if not exists cfb_difficulty text;

update public.rec_league_configuration
set cfb_difficulty = case difficulty::text
  when 'all_madden' then 'heisman'
  when 'all_pro' then 'all_american'
  when 'pro' then 'varsity'
  when 'rookie' then 'freshman'
  else coalesce(cfb_difficulty, 'heisman')
end
where cfb_difficulty is null;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_cfb_difficulty_check
  check (cfb_difficulty is null or cfb_difficulty in ('freshman','varsity','all_american','heisman'));

create table if not exists public.rec_cfp_rankings (
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  rank integer not null check (rank between 1 and 25),
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  conference_champion boolean not null default false,
  updated_by_user_id uuid references public.rec_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (league_id, season_number, rank),
  unique (league_id, season_number, team_id)
);
alter table public.rec_cfp_rankings enable row level security;

create table if not exists public.rec_cfp_brackets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  status text not null default 'draft' check (status in ('draft','active','complete')),
  generated_by_user_id uuid references public.rec_users(id) on delete set null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, season_number)
);
alter table public.rec_cfp_brackets enable row level security;

create table if not exists public.rec_cfp_bracket_slots (
  id uuid primary key default gen_random_uuid(),
  bracket_id uuid not null references public.rec_cfp_brackets(id) on delete cascade,
  round text not null check (round in ('first_round','quarterfinal','semifinal','championship')),
  slot_number integer not null check (slot_number > 0),
  home_seed integer check (home_seed between 1 and 12),
  away_seed integer check (away_seed between 1 and 12),
  home_team_id uuid references public.rec_teams(id) on delete restrict,
  away_team_id uuid references public.rec_teams(id) on delete restrict,
  source_home_slot_id uuid references public.rec_cfp_bracket_slots(id) on delete set null,
  source_away_slot_id uuid references public.rec_cfp_bracket_slots(id) on delete set null,
  game_id uuid references public.rec_games(id) on delete set null,
  bowl_name text,
  updated_at timestamptz not null default now(),
  unique (bracket_id, round, slot_number)
);
alter table public.rec_cfp_bracket_slots enable row level security;

create index if not exists rec_cfp_bracket_slots_game_idx
  on public.rec_cfp_bracket_slots(game_id) where game_id is not null;

create table if not exists public.rec_stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing','processed','failed')),
  attempts integer not null default 1,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.rec_stripe_webhook_events enable row level security;

create table if not exists public.rec_league_purchase_caps (
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  purchase_type text not null,
  season_cap integer check (season_cap is null or season_cap >= 0),
  attribute_caps jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid references public.rec_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (league_id, purchase_type)
);
alter table public.rec_league_purchase_caps enable row level security;

create table if not exists public.rec_league_bans (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  banned_user_id uuid not null references public.rec_users(id) on delete cascade,
  scope text not null check (scope in ('league','owner_all_leagues')),
  reason text not null,
  appeal_instructions text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  discord_ban_applied_at timestamptz,
  created_by_user_id uuid not null references public.rec_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  lifted_by_user_id uuid references public.rec_users(id) on delete set null,
  lifted_at timestamptz
);
alter table public.rec_league_bans enable row level security;
create index if not exists rec_league_bans_lookup_idx
  on public.rec_league_bans(banned_user_id, active, expires_at);

create table if not exists public.rec_league_restrictions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  restriction_type text not null check (restriction_type in ('wagers','highlights')),
  reason text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  created_by_user_id uuid not null references public.rec_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  lifted_by_user_id uuid references public.rec_users(id) on delete set null,
  lifted_at timestamptz
);
alter table public.rec_league_restrictions enable row level security;
create index if not exists rec_league_restrictions_lookup_idx
  on public.rec_league_restrictions(league_id, user_id, restriction_type, active);

create table if not exists public.rec_league_moderation_audit (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references public.rec_leagues(id) on delete cascade,
  actor_user_id uuid references public.rec_users(id) on delete set null,
  target_user_id uuid references public.rec_users(id) on delete set null,
  action text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.rec_league_moderation_audit enable row level security;

alter table public.rec_users
  add column if not exists league_creation_tutorial_preference text not null default 'ask'
  check (league_creation_tutorial_preference in ('ask','show','never'));

revoke all on table public.rec_cfp_rankings from anon, authenticated;
revoke all on table public.rec_cfp_brackets from anon, authenticated;
revoke all on table public.rec_cfp_bracket_slots from anon, authenticated;
revoke all on table public.rec_stripe_webhook_events from anon, authenticated;
revoke all on table public.rec_league_purchase_caps from anon, authenticated;
revoke all on table public.rec_league_bans from anon, authenticated;
revoke all on table public.rec_league_restrictions from anon, authenticated;
revoke all on table public.rec_league_moderation_audit from anon, authenticated;
