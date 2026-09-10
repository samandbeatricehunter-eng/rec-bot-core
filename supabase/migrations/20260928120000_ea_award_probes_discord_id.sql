-- rec_ea_admin_actions records both triggered_by_user_id and triggered_by_discord_id (the
-- latter is what route handlers actually have on hand from requireBotOrUserSession -- resolving
-- a rec_users id needs an extra lookup routes don't otherwise need). Match that here.
alter table public.rec_ea_award_probes
  add column if not exists triggered_by_discord_id text;
