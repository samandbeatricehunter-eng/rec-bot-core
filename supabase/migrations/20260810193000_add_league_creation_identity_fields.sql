alter table public.rec_leagues
  add column if not exists max_members integer not null default 32,
  add column if not exists logo_url text,
  add column if not exists advertisement_eligible boolean not null default true;

alter table public.rec_leagues
  drop constraint if exists rec_leagues_max_members_check;

alter table public.rec_leagues
  add constraint rec_leagues_max_members_check check (max_members between 2 and 32);

update public.rec_leagues
set advertisement_eligible = coalesce(is_online, true)
where advertisement_eligible is distinct from coalesce(is_online, true);

comment on column public.rec_leagues.max_members is
  'Maximum occupied teams, including registered members, commissioners, and Discord-only team assignees.';
comment on column public.rec_leagues.logo_url is
  'Public URL for the active league logo; league abbreviation is the display fallback.';
comment on column public.rec_leagues.advertisement_eligible is
  'Server-authoritative guard for REC league advertisements. Offline leagues must remain false.';
