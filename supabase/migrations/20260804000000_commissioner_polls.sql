-- General-purpose commissioner polls (Media page) — a commissioner writes a free-text question
-- and up to 10 options, the API posts it as a native Discord poll (single-select), and results
-- sync back here for the web to display. Native Discord polls enforce one vote per member —
-- "double-vote elimination" is Discord's own platform guarantee (allowMultiselect: false), not
-- something this table needs to re-implement.
create table if not exists public.rec_commissioner_polls (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  season_number integer not null,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  discord_channel_id text,
  discord_message_id text,
  results jsonb,
  created_by_user_id uuid references public.rec_users(id),
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_commissioner_polls enable row level security;

create index if not exists rec_commissioner_polls_league_idx on public.rec_commissioner_polls(league_id, status);
