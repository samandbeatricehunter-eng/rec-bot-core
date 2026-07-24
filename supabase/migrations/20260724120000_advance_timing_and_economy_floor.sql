-- Advance timing + hard economy linked-user floor
alter table public.rec_league_configuration
  add column if not exists advance_timing text not null default '24hr';

alter table public.rec_league_configuration
  add column if not exists advance_timing_other text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rec_league_configuration_advance_timing_check'
  ) then
    alter table public.rec_league_configuration
      add constraint rec_league_configuration_advance_timing_check
      check (advance_timing in ('24hr', '48hr', '72hr', 'other'));
  end if;
end $$;

update public.rec_league_configuration
set advance_timing = '24hr'
where advance_timing is null or advance_timing = '';

update public.rec_league_configuration
set coin_economy_minimum_linked_users = greatest(coalesce(coin_economy_minimum_linked_users, 8), 8);

delete from public.rec_highlight_reactions r
using public.rec_highlight_posts p
where r.highlight_post_id = p.id
  and r.user_id = p.user_id
  and r.reaction_key in ('TOTY', 'COTY', 'ROTY', 'IOTY', 'HOTY', 'MVP_PLAY');
