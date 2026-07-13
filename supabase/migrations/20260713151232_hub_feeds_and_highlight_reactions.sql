create table if not exists public.rec_hub_announcements (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  title text not null,
  body text not null,
  season_number integer,
  week_number integer,
  discord_channel_id text,
  discord_message_id text,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.rec_hub_announcements enable row level security;
create index if not exists rec_hub_announcements_league_published_idx
  on public.rec_hub_announcements (league_id, published_at desc);

create table if not exists public.rec_highlight_reactions (
  id uuid primary key default gen_random_uuid(),
  highlight_post_id uuid not null references public.rec_highlight_posts(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  reaction_key text not null check (reaction_key in ('like', 'dislike', 'TOTY', 'COTY', 'ROTY', 'IOTY', 'HOTY')),
  created_at timestamptz not null default now(),
  unique (highlight_post_id, user_id, reaction_key)
);
alter table public.rec_highlight_reactions enable row level security;
create index if not exists rec_highlight_reactions_highlight_idx
  on public.rec_highlight_reactions (highlight_post_id, reaction_key);

grant select, insert, update, delete on public.rec_hub_announcements to service_role;
grant select, insert, update, delete on public.rec_highlight_reactions to service_role;

alter table public.rec_server_routes drop column if exists headlines_channel_id;
alter table public.rec_server_routes drop column if exists voting_polls_channel_id;
