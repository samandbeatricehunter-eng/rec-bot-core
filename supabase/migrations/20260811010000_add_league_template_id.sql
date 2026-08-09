-- Tracks which CreateLeagueWizard template (see apps/site/src/lib/league-templates.ts) a
-- league was created from, purely for display in League Search ("REC OG (REC Recommended)").
-- Null for leagues created without picking a template, or created via the Discord-first flow
-- (which has no template concept).
alter table public.rec_leagues add column if not exists template_id text;
