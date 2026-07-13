alter table public.rec_highlight_views
  drop constraint if exists rec_highlight_views_highlight_user_key;

alter table public.rec_game_stories
  add column if not exists story_type text not null default 'game_article',
  add column if not exists roundtable jsonb,
  add column if not exists published_by_discord_id text;

alter table public.rec_game_results
  add column if not exists manual_stats jsonb;

alter table public.rec_box_score_submissions
  add column if not exists entry_method text not null default 'box_score';

create table if not exists public.rec_story_comments (
  id uuid primary key,
  story_id uuid not null references public.rec_game_stories(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_story_comments enable row level security;
create index if not exists rec_story_comments_story_created_idx on public.rec_story_comments(story_id, created_at);

create table if not exists public.rec_story_reactions (
  id uuid primary key,
  story_id uuid not null references public.rec_game_stories(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  season_number integer not null,
  reaction_key text not null check (reaction_key in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  constraint rec_story_reactions_story_user_key unique(story_id, user_id)
);
alter table public.rec_story_reactions enable row level security;
create index if not exists rec_story_reactions_season_idx on public.rec_story_reactions(season_number, reaction_key, story_id);

create table if not exists public.rec_game_reactions (
  id uuid primary key,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  season_number integer not null,
  reaction_key text not null check (reaction_key in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  constraint rec_game_reactions_game_user_key unique(game_id, user_id)
);
alter table public.rec_game_reactions enable row level security;
create index if not exists rec_game_reactions_season_likes_idx on public.rec_game_reactions(season_number, reaction_key, game_id);
