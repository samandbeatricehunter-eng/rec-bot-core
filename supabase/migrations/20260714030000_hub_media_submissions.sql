do $$ begin
  alter type public.rec_source_type add value if not exists 'media';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.rec_source_type add value if not exists 'gotw';
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rec-media',
  'rec-media',
  true,
  10485760,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.rec_game_stories
  add column if not exists image_url text,
  add column if not exists media_kind text,
  add column if not exists author_user_id uuid references public.rec_users(id) on delete set null,
  add column if not exists author_discord_id text,
  add column if not exists source_submission_id uuid,
  add column if not exists published_at timestamptz;

create table if not exists public.rec_media_submissions (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  server_id uuid references public.rec_discord_servers(id) on delete cascade,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  week_number integer not null,
  submission_type text not null check (submission_type in ('commissioner_article', 'user_article', 'interview')),
  status text not null default 'pending' check (status in ('pending', 'scheduled', 'approved', 'denied', 'published')),
  title text not null,
  body text not null,
  image_url text,
  interview_answers jsonb not null default '[]'::jsonb,
  submitter_user_id uuid references public.rec_users(id) on delete set null,
  submitter_discord_id text,
  team_id uuid references public.rec_teams(id) on delete set null,
  tag_opponent boolean not null default false,
  opponent_user_id uuid references public.rec_users(id) on delete set null,
  opponent_discord_id text,
  opponent_team_id uuid references public.rec_teams(id) on delete set null,
  game_id uuid references public.rec_games(id) on delete set null,
  amount integer not null default 0,
  approved_story_id uuid references public.rec_game_stories(id) on delete set null,
  issued_ledger_id uuid references public.rec_dollar_ledger(id) on delete set null,
  reviewed_by_user_id uuid references public.rec_users(id) on delete set null,
  reviewed_by_discord_id text,
  reviewed_at timestamptz,
  denied_reason text,
  publish_after_advance boolean not null default false,
  submitted_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_media_submissions enable row level security;

create index if not exists rec_media_submissions_league_status_idx
  on public.rec_media_submissions(league_id, status, submitted_at desc);

create index if not exists rec_media_submissions_guild_status_idx
  on public.rec_media_submissions(guild_id, status, submitted_at desc);

create unique index if not exists rec_media_submissions_user_article_week_idx
  on public.rec_media_submissions(league_id, season_number, week_number, submitter_user_id)
  where submission_type = 'user_article' and status <> 'denied';

create unique index if not exists rec_media_submissions_interview_week_idx
  on public.rec_media_submissions(league_id, season_number, week_number, submitter_user_id)
  where submission_type = 'interview' and status <> 'denied';

grant select, insert, update, delete on public.rec_media_submissions to service_role;
