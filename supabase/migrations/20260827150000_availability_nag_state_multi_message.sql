-- The availability nag was silently failing to post whenever a league had enough non-compliant
-- users to push the single Discord message over the 2000-char content limit (Discord rejects the
-- whole message with a generic 400/50035 "Invalid Form Body", which was never surfaced anywhere
-- since postDiscordChannelMessage only logs a WARN, not an exception). The fix chunks the nag into
-- multiple messages, so the tracked state needs to hold more than one message id per league.
alter table public.rec_availability_nag_state add column if not exists message_ids text[] not null default '{}';
update public.rec_availability_nag_state set message_ids = array[message_id] where message_id is not null and message_ids = '{}';
alter table public.rec_availability_nag_state drop column if exists message_id;
