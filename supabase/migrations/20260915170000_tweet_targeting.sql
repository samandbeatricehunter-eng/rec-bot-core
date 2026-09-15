-- Twitter beef bridge: lets a posted tweet name a specific target (a team, its owner/user, or a
-- specific player) so both the manual Discord targeting flow and autonomous persona-driven
-- instigation have somewhere to record who a post is aimed at. parent_tweet_id/root_tweet_id
-- already existed but were never written anywhere -- this migration doesn't touch them, the
-- application code now finally populates them on insert.

alter table public.rec_tweets
  add column if not exists target_kind text check (target_kind in ('team', 'owner', 'player')),
  add column if not exists target_team_id uuid references public.rec_teams(id) on delete set null,
  add column if not exists target_user_id uuid references public.rec_users(id) on delete set null,
  add column if not exists target_player_id uuid references public.rec_players(id) on delete set null,
  add column if not exists target_label text;

create index if not exists rec_tweets_target_team_idx on public.rec_tweets (league_id, target_team_id);
create index if not exists rec_tweets_target_player_idx on public.rec_tweets (league_id, target_player_id);
