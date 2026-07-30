alter table public.rec_comp_profiles
  add column if not exists preferred_game text
  check (preferred_game is null or preferred_game in ('madden_26', 'madden_27', 'cfb_27'));

alter table public.rec_games
  add column if not exists postseason_round text,
  add column if not exists bowl_name text;

alter table public.rec_team_byes
  add column if not exists bye_type text not null default 'regular_season'
  check (bye_type in ('regular_season', 'cfp_first_round'));

comment on column public.rec_games.postseason_round is
  'CFB postseason round: conference_championship, cfp_first_round, cfp_quarterfinals, cfp_semifinals, or national_championship.';
comment on column public.rec_games.bowl_name is
  'Commissioner-entered bowl or CFP game name.';
comment on column public.rec_team_byes.bye_type is
  'Distinguishes a normal schedule bye from a CFP first-round bye.';
