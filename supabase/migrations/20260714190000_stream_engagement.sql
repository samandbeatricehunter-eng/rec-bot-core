create table if not exists public.rec_stream_views (
  id uuid primary key default gen_random_uuid(),
  stream_log_id uuid not null references public.rec_stream_compliance_logs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  user_id uuid references public.rec_users(id) on delete set null,
  discord_id text,
  anonymous_viewer_id text,
  viewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.rec_stream_views is
  'Unique per-user stream link clicks. Top 3 Streamers are ranked by season view count.';

alter table public.rec_stream_views enable row level security;

create index if not exists rec_stream_views_stream_idx
  on public.rec_stream_views(stream_log_id, viewed_at desc);

create unique index if not exists rec_stream_views_one_per_user_stream_idx
  on public.rec_stream_views(stream_log_id, user_id)
  where user_id is not null;

create unique index if not exists rec_stream_views_one_per_discord_stream_idx
  on public.rec_stream_views(stream_log_id, discord_id)
  where user_id is null and discord_id is not null;

create unique index if not exists rec_stream_views_one_per_anonymous_stream_idx
  on public.rec_stream_views(stream_log_id, anonymous_viewer_id)
  where user_id is null and discord_id is null and anonymous_viewer_id is not null;

create table if not exists public.rec_stream_reactions (
  id uuid primary key default gen_random_uuid(),
  stream_log_id uuid not null references public.rec_stream_compliance_logs(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  user_id uuid references public.rec_users(id) on delete set null,
  discord_id text,
  reaction_key text not null check (reaction_key in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rec_stream_reactions is
  'Per-user stream like/dislike reactions. League Favorite Streamer score is likes - dislikes + (views * 0.5).';

alter table public.rec_stream_reactions enable row level security;

create unique index if not exists rec_stream_reactions_one_per_user_stream_idx
  on public.rec_stream_reactions(stream_log_id, user_id)
  where user_id is not null;

create unique index if not exists rec_stream_reactions_one_per_discord_stream_idx
  on public.rec_stream_reactions(stream_log_id, discord_id)
  where user_id is null and discord_id is not null;

create index if not exists rec_stream_reactions_stream_idx
  on public.rec_stream_reactions(stream_log_id, reaction_key);

grant select, insert, update, delete on public.rec_stream_views to service_role;
grant select, insert, update, delete on public.rec_stream_reactions to service_role;
