alter table public.rec_box_score_submissions
  add column if not exists extra_discord_message_ids text[] not null default '{}',
  add column if not exists discord_cleanup_done boolean not null default false;

create index if not exists rec_box_score_submissions_cleanup_idx
  on public.rec_box_score_submissions(discord_guild_id, status, discord_cleanup_done)
  where discord_cleanup_done = false;
