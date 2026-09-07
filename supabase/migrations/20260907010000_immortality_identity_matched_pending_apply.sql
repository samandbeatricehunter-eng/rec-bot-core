-- Rise to Immortality: identity verification now also requires the commissioner to have actually
-- clicked "Applied In Game" on the prospect's build review (rec_immortality_prospects.review_status
-- = 'approved' AND reviewed_at is not null -- reviewed_at is only ever set by reviewImmortalityProspect,
-- never by the automatic Creation-Points-time approval, so it's the real signal). A roster-name
-- match found before that click now lands here instead of jumping straight to 'verified'.
alter table public.rec_immortality_prospects
  drop constraint if exists rec_immortality_prospects_identity_status_check;
alter table public.rec_immortality_prospects
  add constraint rec_immortality_prospects_identity_status_check
  check (identity_status in ('synthetic', 'verified', 'missing', 'ambiguous', 'stale', 'matched_pending_apply'));
