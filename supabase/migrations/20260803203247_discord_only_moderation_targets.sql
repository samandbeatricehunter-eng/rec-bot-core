alter table public.rec_league_bans
  alter column banned_user_id drop not null,
  add column if not exists target_discord_id text;

alter table public.rec_league_bans drop constraint if exists rec_league_bans_target_check;
alter table public.rec_league_bans add constraint rec_league_bans_target_check
  check (banned_user_id is not null or nullif(target_discord_id, '') is not null);

create index if not exists rec_league_bans_discord_lookup_idx
  on public.rec_league_bans(target_discord_id, active, expires_at)
  where target_discord_id is not null;
