-- Rise to Immortality: every completed prospect build now goes to the commissioner as a
-- rec_commissioners_inbox pending item (queue_type 'immortality_prospect') before it counts
-- toward franchise-offer eligibility -- same reviewed/approved/rejected pattern custom players
-- already use (see custom-players.service.ts).
alter table public.rec_immortality_prospects
  add column if not exists review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'rejected')),
  add column if not exists review_reason text,
  add column if not exists reviewed_by_discord_id text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists throwing_motion_key text;

-- Every prospect that existed before this gate shipped was never reviewed and shouldn't be
-- retroactively blocked from franchise offers -- only prospects that finish Creation Points
-- from here forward go through the new review queue.
update public.rec_immortality_prospects set review_status = 'approved' where review_status = 'pending_review';
