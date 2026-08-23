-- Admin roster controls: pause registration/event independently, pending vs approved entries.

alter table public.rec_site_tournaments
  add column if not exists registration_paused boolean not null default false,
  add column if not exists event_paused boolean not null default false,
  add column if not exists timezone text not null default 'America/Chicago';

alter table public.rec_site_tournament_entrants
  add column if not exists entry_status text not null default 'pending';

alter table public.rec_site_tournament_entrants
  drop constraint if exists rec_site_tournament_entrants_entry_status_check;

alter table public.rec_site_tournament_entrants
  add constraint rec_site_tournament_entrants_entry_status_check
  check (entry_status in ('pending', 'approved', 'removed'));

-- Existing rows were already in the field.
update public.rec_site_tournament_entrants
set entry_status = 'approved'
where entry_status = 'pending';
