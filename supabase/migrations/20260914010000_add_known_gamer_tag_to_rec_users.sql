-- Phase 1 cleanup (Comp removal): tournaments.service.ts used rec_comp_profiles.gamer_tag as a
-- durable "known gamer tag" cache. Comp is being removed, so move that cache onto rec_users
-- directly and backfill from the existing Comp profiles before those tables are dropped.
alter table public.rec_users add column if not exists known_gamer_tag text;

update public.rec_users u
set known_gamer_tag = p.gamer_tag
from public.rec_comp_profiles p
where p.user_id = u.id
  and coalesce(p.gamer_tag, '') <> ''
  and coalesce(u.known_gamer_tag, '') = '';
