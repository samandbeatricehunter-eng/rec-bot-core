create index rec_site_identity_claim_challenges_rec_updated_idx
  on public.rec_site_identity_claim_challenges (rec_user_id, updated_at desc);
