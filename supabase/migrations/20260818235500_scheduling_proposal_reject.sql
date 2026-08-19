-- Adds a "rejected" proposal status distinct from "withdrawn": withdraw is proposer-initiated
-- (they pull back their own offer), reject is recipient-initiated (they decline someone else's
-- offer without countering). Site's Review Offers modal and the matching API action need this
-- to tell the two apart in history/notifications.
alter table public.rec_game_time_proposals drop constraint rec_game_time_proposals_status_check;
alter table public.rec_game_time_proposals add constraint rec_game_time_proposals_status_check
  check (status in ('pending', 'accepted', 'countered', 'withdrawn', 'rejected'));
