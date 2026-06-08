alter table public.rec_server_routes
  add column if not exists pending_economy_channel_id text,
  add column if not exists game_channels_category_id text;

create table if not exists public.rec_purchase_holds (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.rec_purchases(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  league_id uuid not null references public.rec_leagues(id),
  amount integer not null check (amount >= 0),
  status text not null default 'held' check (status in ('held', 'cleared', 'refunded')),
  held_at timestamptz not null default now(),
  cleared_at timestamptz,
  refunded_at timestamptz,
  refund_reason text,
  created_by_user_id uuid references public.rec_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rec_purchase_holds_purchase_id_key on public.rec_purchase_holds(purchase_id);

create table if not exists public.rec_eos_payout_batches (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  batch_type text not null default 'eos_regular_season',
  status text not null default 'draft' check (status in ('draft', 'posted', 'partially_approved', 'approved', 'denied', 'cleared', 'issued', 'failed')),
  version integer not null default 1,
  created_by_user_id uuid references public.rec_users(id),
  cleared_by_user_id uuid references public.rec_users(id),
  clear_reason text,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  cleared_at timestamptz,
  issued_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists rec_eos_payout_batches_league_season_idx on public.rec_eos_payout_batches(league_id, season_number, batch_type, status);

create table if not exists public.rec_eos_payout_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.rec_eos_payout_batches(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  user_id uuid not null references public.rec_users(id),
  team_id uuid references public.rec_teams(id),
  season_number integer not null,
  payout_category text not null,
  payout_key text not null,
  payout_label text not null,
  source_entity_type text,
  source_entity_id text,
  source_entity_name text,
  source_entity_position text,
  qualified_tier text,
  qualified_value numeric,
  amount integer not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'issued', 'voided')),
  discord_channel_id text,
  discord_message_id text,
  denied_reason text,
  metadata jsonb not null default '{}'::jsonb,
  approved_by_user_id uuid references public.rec_users(id),
  denied_by_user_id uuid references public.rec_users(id),
  issued_ledger_id uuid references public.rec_dollar_ledger(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  denied_at timestamptz,
  issued_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists rec_eos_payout_items_batch_payout_key_key on public.rec_eos_payout_items(batch_id, payout_key);
create index if not exists rec_eos_payout_items_league_user_idx on public.rec_eos_payout_items(league_id, season_number, user_id, status);

create table if not exists public.rec_weekly_challenges (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  game_id uuid references public.rec_games(id) on delete set null,
  user_id uuid not null references public.rec_users(id),
  team_id uuid not null references public.rec_teams(id),
  opponent_team_id uuid references public.rec_teams(id),
  opponent_user_id uuid references public.rec_users(id),
  is_cpu_game boolean not null default false,
  challenge_side text not null check (challenge_side in ('offense', 'defense')),
  challenge_key text not null,
  target_type text not null default 'team' check (target_type in ('team', 'player')),
  target_player_external_id text,
  target_player_name text,
  target_player_position text,
  s_tier_goal text not null,
  a_tier_goal text not null,
  b_tier_goal text not null default 'Win the game',
  status text not null default 'active' check (status in ('active', 'voided', 'evaluated')),
  earned_tier text check (earned_tier in ('S', 'A', 'B')),
  earned_amount integer not null default 0,
  evaluation_details jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  evaluated_at timestamptz,
  paid_ledger_id uuid references public.rec_dollar_ledger(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rec_weekly_challenges_unique_active_key on public.rec_weekly_challenges(league_id, season_number, week_number, user_id, challenge_side) where status = 'active';
create index if not exists rec_weekly_challenges_audit_idx on public.rec_weekly_challenges(league_id, season_number, week_number, user_id);

create table if not exists public.rec_game_channels (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  game_id uuid references public.rec_games(id) on delete set null,
  discord_channel_id text not null,
  away_team_id uuid references public.rec_teams(id),
  home_team_id uuid references public.rec_teams(id),
  away_user_id uuid references public.rec_users(id),
  home_user_id uuid references public.rec_users(id),
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists rec_game_channels_discord_channel_id_key on public.rec_game_channels(discord_channel_id);
create index if not exists rec_game_channels_active_idx on public.rec_game_channels(league_id, season_number, week_number, status);

create table if not exists public.rec_game_channel_checkins (
  id uuid primary key default gen_random_uuid(),
  game_channel_id uuid not null references public.rec_game_channels(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  discord_channel_id text not null,
  discord_user_id text not null,
  user_id uuid references public.rec_users(id),
  first_message_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rec_game_channel_checkins_channel_user_key on public.rec_game_channel_checkins(game_channel_id, discord_user_id);

create table if not exists public.rec_game_channel_reminders (
  id uuid primary key default gen_random_uuid(),
  game_channel_id uuid not null references public.rec_game_channels(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('four_hour', 'eight_hour', 'twelve_hour')),
  target_user_id uuid references public.rec_users(id),
  status text not null default 'sent' check (status in ('sent', 'skipped', 'failed')),
  sent_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists rec_game_channel_reminders_once_key on public.rec_game_channel_reminders(game_channel_id, reminder_type, coalesce(target_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.rec_weekly_player_awards (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  conference text not null,
  award_side text not null check (award_side in ('offense', 'defense')),
  award_source text not null default 'rec_calculated' check (award_source in ('madden_import', 'rec_calculated')),
  player_external_id text,
  player_name text not null,
  position text,
  team_id uuid references public.rec_teams(id),
  user_id uuid references public.rec_users(id),
  score numeric,
  payout_amount integer not null default 10,
  paid_ledger_id uuid references public.rec_dollar_ledger(id),
  source_import_job_id uuid references public.rec_import_jobs(id),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rec_weekly_player_awards_unique_key on public.rec_weekly_player_awards(league_id, season_number, week_number, conference, award_side, award_source);
