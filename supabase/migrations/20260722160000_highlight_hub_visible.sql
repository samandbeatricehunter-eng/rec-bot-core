-- Gate hub display on commissioner approval. Existing ready clips stay visible.
alter table public.rec_highlight_posts
  add column if not exists hub_visible boolean not null default false;

update public.rec_highlight_posts
set hub_visible = true
where media_status = 'ready'
  and coalesce(hub_visible, false) = false
  and (
    payout_issued = true
    or payout_review_id is null
    or exists (
      select 1
      from public.rec_highlight_payout_reviews r
      where r.id = rec_highlight_posts.payout_review_id
        and r.status in ('approved', 'issued')
    )
  );

-- Historical ready clips without a completed review still display (grandfathered).
update public.rec_highlight_posts
set hub_visible = true
where media_status = 'ready'
  and hub_visible = false
  and created_at < now();

create index if not exists rec_highlight_posts_league_hub_visible_idx
  on public.rec_highlight_posts (league_id, season_number, hub_visible)
  where hub_visible = true and media_status = 'ready';

alter table public.rec_highlight_posts enable row level security;
