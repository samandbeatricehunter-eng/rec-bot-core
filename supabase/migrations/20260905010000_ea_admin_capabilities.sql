-- EA's userAdminHubInfo.userAdminInfo payload includes league-level Franchise permission flags
-- (canAdminsBootAdmins/canAdminsRemoveAdmins/canEnableUnlimitedAutoPilot) that were previously
-- captured only in the raw discovery blob (ea_user_admin_hub_raw), never parsed into queryable
-- columns. Storing them so the Tools UI can warn before Boot User/Remove Admin against a target
-- who is themselves an admin, instead of only finding out after EA rejects the action.
alter table public.rec_ea_connections
  add column if not exists ea_can_boot_admins boolean,
  add column if not exists ea_can_remove_admins boolean,
  add column if not exists ea_can_unlimited_autopilot boolean;
