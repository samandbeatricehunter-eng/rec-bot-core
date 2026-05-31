drop index if exists rec_league_ea_franchise_links_one_active_idx;

create unique index if not exists rec_league_ea_franchise_links_one_active_idx
  on public.rec_league_ea_franchise_links(league_id, server_id)
  where is_active = true;

alter table public.rec_league_ea_franchise_links
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by_discord_id text,
  add column if not exists replacement_reason text;

comment on table public.rec_league_ea_franchise_links is 'History of EA franchise selections for REC leagues. Only one active link is allowed per league/server, but older links remain inactive for audit history.';
