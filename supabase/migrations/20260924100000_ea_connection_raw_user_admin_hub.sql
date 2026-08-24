-- Raw userAdminHubInfo blob from EA's league hub, captured as-is on every import. We've only
-- ever typed a handful of fields off this structure (userName/team/isOwner/isCoach) based on
-- guesses -- storing the raw JSON lets us inspect what EA actually sends (e.g. a real
-- commissioner/permission field we haven't found yet) without needing a packet capture.
alter table public.rec_ea_connections
  add column if not exists ea_user_admin_hub_raw jsonb;

comment on column public.rec_ea_connections.ea_user_admin_hub_raw is
  'Raw userAdminHubInfo from EA''s league hub response, captured on every import for field discovery -- not used programmatically.';
