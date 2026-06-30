-- Manual championship credits requested after the badge/records split.
-- Per-game records remain game-specific. The all-games career counter uses
-- superbowl_wins as the stored championship count and does not track title losses.

create table if not exists public.rec_manual_championship_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  game text check (game is null or game in ('madden_26', 'madden_27', 'cfb_27')),
  championship_count integer not null default 1 check (championship_count > 0),
  source_key text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (source_key)
);

alter table public.rec_manual_championship_credits enable row level security;

with desired_accounts(discord_id, game) as (
  values
    ('792819168461324290', 'madden_26'),
    ('1349158444204298358', 'madden_26'),
    ('435637796204576779', null)
),
existing_accounts as (
  select da.discord_id, da.user_id
  from public.rec_discord_accounts da
  join desired_accounts d on d.discord_id = da.discord_id
),
missing_account_user as (
  insert into public.rec_users (display_name, status)
  select d.discord_id, 'active'
  from desired_accounts d
  where not exists (
    select 1
    from public.rec_discord_accounts da
    where da.discord_id = d.discord_id
  )
  returning id as user_id, display_name as discord_id
),
created_account as (
  insert into public.rec_discord_accounts (user_id, discord_id, username, global_name)
  select user_id, discord_id, discord_id, discord_id
  from missing_account_user
  on conflict (discord_id) do nothing
  returning discord_id, user_id
),
target_accounts as (
  select discord_id, user_id from existing_accounts
  union all
  select discord_id, user_id from created_account
),
manual_credits as (
  select
    t.discord_id,
    t.user_id,
    d.game,
    1::integer as championship_credit
  from target_accounts t
  join desired_accounts d on d.discord_id = t.discord_id
),
credit_insert as (
  insert into public.rec_manual_championship_credits (
    user_id,
    game,
    championship_count,
    source_key,
    note
  )
  select
    user_id,
    game,
    championship_credit,
    '2026-06-30:manual_championship:' || discord_id,
    case
      when game = 'madden_26' then 'Manual Madden 26 Super Bowl credit; no win/loss game result was logged.'
      else 'Manual all-games Championship credit; no per-game Super Bowl record was requested.'
    end
  from manual_credits
  on conflict (source_key) do nothing
  returning user_id, game, championship_count
),
credit_totals as (
  select user_id, sum(championship_count)::integer as championship_credits
  from credit_insert
  group by user_id
),
global_upsert as (
  insert into public.rec_global_user_records (
    user_id,
    wins,
    losses,
    ties,
    playoff_wins,
    playoff_losses,
    superbowl_wins,
    superbowl_losses,
    points_for,
    points_against,
    point_differential,
    games_played,
    avg_point_differential,
    updated_at
  )
  select
    user_id,
    0,
    0,
    0,
    0,
    0,
    championship_credits,
    0,
    0,
    0,
    0,
    0,
    0,
    now()
  from credit_totals
  on conflict (user_id) do update
    set superbowl_wins = public.rec_global_user_records.superbowl_wins + excluded.superbowl_wins,
        superbowl_losses = 0,
        playoff_wins = 0,
        playoff_losses = 0,
        updated_at = now()
  returning user_id
),
game_credit_totals as (
  select user_id, game, sum(championship_count)::integer as championship_credits
  from credit_insert
  where game is not null
  group by user_id, game
)
insert into public.rec_global_user_game_records (
  user_id,
  game,
  wins,
  losses,
  ties,
  playoff_wins,
  playoff_losses,
  superbowl_wins,
  superbowl_losses,
  points_for,
  points_against,
  point_differential,
  games_played,
  avg_point_differential,
  updated_at
)
select
  game_credit_totals.user_id,
  game_credit_totals.game,
  0,
  0,
  0,
  0,
  0,
  game_credit_totals.championship_credits,
  0,
  0,
  0,
  0,
  0,
  0,
  now()
from game_credit_totals
on conflict (user_id, game) do update
  set superbowl_wins = public.rec_global_user_game_records.superbowl_wins + excluded.superbowl_wins,
      updated_at = now();
