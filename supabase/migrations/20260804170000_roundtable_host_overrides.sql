-- Per-league customization of the 4 fixed roundtable analyst voices (caleb/maya/theo/nina).
-- Only display_name + personality_key are overridable — the underlying take-bank content
-- stays keyed to the fixed voice slot, so renaming a host doesn't require rewriting any takes.
create table if not exists public.rec_roundtable_host_overrides (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  voice_key text not null check (voice_key in ('caleb', 'maya', 'theo', 'nina')),
  display_name text not null,
  personality_key text not null,
  updated_by_user_id uuid references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, voice_key)
);

alter table public.rec_roundtable_host_overrides enable row level security;
