-- League search viewer settings: Sliders Adjusted + CFB Coach XP
alter table public.rec_league_configuration
  add column if not exists sliders_adjusted boolean not null default false;

alter table public.rec_league_configuration
  add column if not exists coach_xp_setting text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rec_league_configuration_coach_xp_setting_check'
  ) then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_coach_xp_setting_check
      check (coach_xp_setting is null or coach_xp_setting in ('casual', 'career'));
  end if;
end $$;

update public.rec_league_configuration c
set coach_xp_setting = 'casual'
from public.rec_leagues l
where l.id = c.league_id
  and l.game = 'cfb_27'
  and c.coach_xp_setting is null;

update public.rec_league_configuration
set sliders_adjusted = true
where nullif(trim(coalesce(difficulty_custom_settings, '')), '') is not null;
