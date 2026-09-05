-- Rise to Immortality Pass 2 (Identity Integrity): tracks whether an RTI prospect's synthetic
-- rec_players row has been reconciled with a real EA-imported player. See
-- player-identity.service.ts (apps/api) for the reconciliation logic that maintains these
-- columns -- this table only, not the shared rec_players table, since the concept is RTI-specific.
alter table public.rec_immortality_prospects
  add column if not exists identity_status text not null default 'synthetic',
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_match_method text,
  add column if not exists identity_checked_at timestamptz,
  add column if not exists identity_note text;

alter table public.rec_immortality_prospects
  drop constraint if exists rec_immortality_prospects_identity_status_check;
alter table public.rec_immortality_prospects
  add constraint rec_immortality_prospects_identity_status_check
  check (identity_status in ('synthetic', 'verified', 'missing', 'ambiguous', 'stale'));
