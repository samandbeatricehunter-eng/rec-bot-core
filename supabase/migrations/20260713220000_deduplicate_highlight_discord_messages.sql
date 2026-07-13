-- A Discord message is one highlight submission. Prefer an existing row that is
-- already attached to payout history, then the oldest import, before enforcing it.
with ranked as (
  select
    id,
    row_number() over (
      partition by league_id, discord_channel_id, discord_message_id
      order by (payout_review_id is not null) desc, created_at asc, id asc
    ) as duplicate_rank
  from public.rec_highlight_posts
  where discord_channel_id is not null
    and discord_message_id is not null
)
delete from public.rec_highlight_posts as highlight
using ranked
where highlight.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists rec_highlight_posts_discord_message_key
  on public.rec_highlight_posts (league_id, discord_channel_id, discord_message_id)
  where discord_channel_id is not null
    and discord_message_id is not null;
