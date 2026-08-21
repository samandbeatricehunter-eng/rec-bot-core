-- Store a public logo URL (uploaded custom crest or a relocation-brand path)
-- so relocated/custom teams can render site-wide and on Discord matchup cards.
alter table public.rec_teams
  add column if not exists logo_url text;

comment on column public.rec_teams.logo_url is
  'Public image URL or site-relative path for a relocated/custom team crest. Null keeps the stock NFL logo via original_abbreviation.';
