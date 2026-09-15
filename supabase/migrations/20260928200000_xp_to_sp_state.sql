-- XP -> SP conversion state for the unified challenge/economy package.
-- XP remains the earned raw unit; SP is whole spendable Skill Points with remainder carry.

alter table public.rec_player_xp_state
  add column if not exists balance_sp integer not null default 0,
  add column if not exists lifetime_earned_sp integer not null default 0,
  add column if not exists xp_toward_next_sp integer not null default 0,
  add column if not exists last_sp_threshold integer,
  add column if not exists last_sp_ovr integer,
  add column if not exists last_sp_conversion_at timestamptz;

alter table public.rec_franchise_xp_state
  add column if not exists balance_sp integer not null default 0,
  add column if not exists lifetime_earned_sp integer not null default 0,
  add column if not exists xp_toward_next_sp integer not null default 0,
  add column if not exists last_sp_threshold integer,
  add column if not exists last_sp_conversion_at timestamptz;

-- One-time backfill: existing XP balances become remainder toward the next SP.
update public.rec_player_xp_state
set xp_toward_next_sp = greatest(0, floor(balance_xp)::integer)
where xp_toward_next_sp = 0 and balance_xp > 0;

update public.rec_franchise_xp_state
set xp_toward_next_sp = greatest(0, balance_fpp)
where xp_toward_next_sp = 0 and balance_fpp > 0;
