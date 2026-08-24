-- The connected persona's own EA user id (userAdminHubInfo.userInfoMap key, resolved by matching
-- the map's gamertags against the persona's known display name) -- the requestor/actor identity
-- write-side Blaze admin commands need, distinct from blazeId (a different, much larger id
-- space). ea_own_is_owner mirrors EA's own "isOwner" flag for that entry, since EA's admin
-- commands plausibly require the actor to be the EA-recognized league owner specifically.
alter table public.rec_ea_connections
  add column if not exists ea_own_user_id text,
  add column if not exists ea_own_is_owner boolean;

comment on column public.rec_ea_connections.ea_own_user_id is
  'EA Blaze user id (userAdminHubInfo.userInfoMap key) for the connected persona itself -- the requestor identity for write-side admin commands.';
comment on column public.rec_ea_connections.ea_own_is_owner is
  'Whether EA''s own userAdminHubInfo data flags the connected persona as isOwner (league owner/admin) for that entry.';
