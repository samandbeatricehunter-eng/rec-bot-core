create table if not exists public.rec_league_ea_franchise_links (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  server_id uuid not null references public.rec_discord_servers(id) on delete cascade,
  ea_franchise_id uuid not null references public.rec_ea_franchises(id) on delete cascade,
  selected_by_discord_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(league_id, server_id, ea_franchise_id)
);

create unique index if not exists rec_league_ea_franchise_links_one_active_idx
  on public.rec_league_ea_franchise_links(league_id, server_id)
  where is_active = true;

create index if not exists rec_league_ea_franchise_links_franchise_idx
  on public.rec_league_ea_franchise_links(ea_franchise_id);
