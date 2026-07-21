-- App-wide member notifications for apps/site (and mobile).
-- Commissioner review-queue items still live in rec_commissioners_inbox;
-- the site bell merges both feeds with clear section labels.

create table public.rec_site_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rec_users(id) on delete cascade,
  league_id uuid references public.rec_leagues(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  href text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(title) between 1 and 240),
  check (body is null or char_length(body) <= 1000),
  check (char_length(href) between 1 and 500),
  check (char_length(kind) between 1 and 64)
);

create index rec_site_notifications_user_created_idx
  on public.rec_site_notifications (user_id, created_at desc);

create index rec_site_notifications_user_unread_idx
  on public.rec_site_notifications (user_id)
  where read_at is null;

alter table public.rec_site_notifications enable row level security;
