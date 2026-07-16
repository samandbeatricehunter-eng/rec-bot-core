-- rec_media_submissions was originally an abandoned award-voting table design (award_type
-- NOT NULL, no default). The 20260714030000 migration's "create table if not exists" silently
-- no-opped against that legacy table instead of creating the intended hub-media-submissions
-- shape, so award_type survived as a leftover NOT NULL column that nothing in current code
-- ever populates — every insert (commissioner article, user article, interview) has been
-- failing with "null value in column award_type violates not-null constraint".
--
-- Nothing reads or writes award_type today (it belonged to the old rec_media_awards/
-- rec_media_votes voting design, not the current submission_type-based flow), so it's safe
-- to simply drop the not-null requirement.
alter table public.rec_media_submissions
  alter column award_type drop not null;
