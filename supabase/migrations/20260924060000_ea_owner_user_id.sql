-- EA user id (Blaze userAdminHubInfo.userInfoMap key) for the human owning each team. Distinct
-- from ea_username (the gamertag) -- this is the id write-side Blaze admin commands (BootUser,
-- AddAdmin, ToggleAutoPilot, etc.) need as their target user. Null for CPU-controlled teams.
alter table public.rec_teams add column if not exists ea_owner_user_id text;

comment on column public.rec_teams.ea_owner_user_id is
  'EA Blaze user id (userAdminHubInfo.userInfoMap key) for this team''s human owner. Null for CPU.';
