-- Rise to Immortality: commissioner chooses the default 32 NFL clubs or 32 custom
-- replacements that occupy named NFL slots. Unused slots stay CPU after the rookie draft.

alter table public.rec_immortality_leagues
  add column if not exists team_pool text not null default 'default_nfl';

alter table public.rec_immortality_leagues
  drop constraint if exists rec_immortality_leagues_team_pool_check;

alter table public.rec_immortality_leagues
  add constraint rec_immortality_leagues_team_pool_check
  check (team_pool in ('default_nfl', 'custom_32'));
