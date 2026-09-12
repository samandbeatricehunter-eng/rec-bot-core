-- Total Master Handoff Plan: capture two previously-unused EA raw payload fields, per
-- RAW_PAYLOAD_UTILIZATION.md's findings (teamSchemeOvr: 4,134 reviewed rows have a positive
-- value; confRating: high-value dynamic Player Confidence). Both are internal/supplemental --
-- never the authoritative OVR.

alter table public.rec_players
  add column if not exists team_scheme_ovr integer,
  add column if not exists confidence_rating integer;
