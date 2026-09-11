-- Master Handoff Plan, Phase 1: resolve unused snapshot/raw-data tables.
-- All of these are leftovers from CFB league-mode support (fully removed) and the CFP
-- bracket feature (its API routes/service were already deleted). Confirmed zero source
-- references anywhere in apps/*/src before writing this. rec_recruiting_profiles and
-- rec_recruiting_commitment_history are EXCLUDED from this pass -- rec_players.source_recruit_id
-- and rec_recruiting_board_entries.recruit_id (both live tables) have foreign keys into
-- rec_recruiting_profiles, so removing it needs its own dedicated pass, not a blind drop.

-- CFB baseline import dataset (one had 659k+ rows) -- cfb-baseline.service.ts/routes.ts were
-- already deleted by the "Remove CFB support" commit; nothing reads these anymore.
drop table if exists public.rec_cfb_baseline_player_attributes;
drop table if exists public.rec_cfb_baseline_players;
drop table if exists public.rec_cfb_baseline_source_records;
drop table if exists public.rec_cfb_baseline_teams;
drop table if exists public.rec_cfb_roster_datasets;

-- CFP (College Football Playoff) bracket -- cfp-bracket.service.ts was already deleted; the
-- last web caller (CfpStandingsDrawer) was removed earlier in this same Phase 1 pass.
drop table if exists public.rec_cfp_bracket_slots;
drop table if exists public.rec_cfp_brackets;

-- CFB transfer-portal entries -- transfer-portal.service.ts/routes.ts were already deleted.
drop table if exists public.rec_transfer_portal_entries;
