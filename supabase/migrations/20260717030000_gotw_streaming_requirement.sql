alter table public.rec_league_configuration
  add column if not exists gotw_streaming_requirement text not null default 'recommended',
  add column if not exists gotw_streaming_side text not null default 'either';

alter table public.rec_league_configuration
  drop constraint if exists rec_league_configuration_gotw_streaming_requirement_check,
  drop constraint if exists rec_league_configuration_gotw_streaming_side_check;

alter table public.rec_league_configuration
  add constraint rec_league_configuration_gotw_streaming_requirement_check
    check (gotw_streaming_requirement in ('required', 'recommended', 'disabled')),
  add constraint rec_league_configuration_gotw_streaming_side_check
    check (gotw_streaming_side in ('home', 'away', 'either', 'both'));

update public.rec_league_configuration c
set gotw_streaming_requirement = 'required', gotw_streaming_side = 'home'
from public.rec_leagues l
where l.id = c.league_id and l.game = 'cfb_27';

comment on column public.rec_league_configuration.gotw_streaming_requirement is
  'Whether streaming is required, recommended, or disabled specifically for Game of the Week.';
comment on column public.rec_league_configuration.gotw_streaming_side is
  'Which participant must stream Game of the Week: home, away, either, or both.';

alter table public.rec_league_configuration enable row level security;
