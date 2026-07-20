alter table public.rec_teams
  add column primary_color text not null default '#FFFFFF'
  check (primary_color ~ '^#[0-9A-Fa-f]{6}$');

create table public.rec_matchup_chat_messages (
  id uuid primary key,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  author_user_id uuid not null references public.rec_users(id) on delete cascade,
  author_discord_id text,
  author_display_name text not null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.rec_matchup_chat_messages enable row level security;

create index rec_matchup_chat_messages_game_created_idx
  on public.rec_matchup_chat_messages (game_id, created_at);
