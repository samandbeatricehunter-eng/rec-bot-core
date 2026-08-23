-- Over/under and parlay picks are not user ids.
alter table public.rec_site_tournament_wagers
  alter column pick_user_id drop not null;

create unique index if not exists rec_site_tournament_highlights_stream_uid_idx
  on public.rec_site_tournament_highlights (cloudflare_stream_uid)
  where cloudflare_stream_uid is not null;
