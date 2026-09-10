-- Diagnostic log for the read-only EA/Blaze award-probe (does the Madden Companion App's
-- Blaze backend expose native Player-of-the-Week / league award winners?). Every attempt --
-- success or failure -- against a small hardcoded whitelist of candidate commandNames is
-- recorded here so raw EA responses can be inspected directly via SQL instead of a packet
-- capture. This is a diagnostic log, not a queue: nothing consumes/dequeues rows.
create table if not exists public.rec_ea_award_probes (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  probe_key text not null,
  command_name text not null,
  component_id integer,
  command_id integer,
  request_payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('success', 'error')),
  response_payload jsonb,
  matched_award_keywords jsonb,
  error_message text,
  triggered_by_user_id uuid references public.rec_users(id),
  created_at timestamptz not null default now()
);

alter table public.rec_ea_award_probes enable row level security;

create index if not exists rec_ea_award_probes_league_id_created_at_idx
  on public.rec_ea_award_probes (league_id, created_at desc);
