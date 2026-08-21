-- Xbox gamertag / PSN name from EA league hub userInfoMap and leagueTeams.userName.
-- CPU / unassigned slots are stored as null.
alter table public.rec_teams add column if not exists ea_username text;

comment on column public.rec_teams.ea_username is
  'Imported Xbox gamertag or PSN name from EA (league hub userInfoMap / leagueTeamInfoList.userName). Null for CPU.';
