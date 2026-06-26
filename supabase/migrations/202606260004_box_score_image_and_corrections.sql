-- Persist the uploaded box-score screenshot and allow commissioner corrections.
-- The Discord CDN URL dies when the source message is deleted, so we re-host the
-- screenshot in a public Storage bucket and keep its URL on the submission. The
-- correction flow patches team_stats / scores / quarter_scores / matchup in place
-- on the pending row before approval reads it. rec_box_score_submissions already
-- has RLS enabled; no new table is created here.

alter table public.rec_box_score_submissions
  add column if not exists image_storage_url text;

-- Public bucket for re-hosted box-score screenshots. Public read; writes happen
-- through the service role (which bypasses Storage RLS), so no extra policies are
-- needed for the bot/API to upload.
insert into storage.buckets (id, name, public)
values ('box-scores', 'box-scores', true)
on conflict (id) do nothing;
