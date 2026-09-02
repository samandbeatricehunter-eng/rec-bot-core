-- Keep RTI record-book embeds stable: each scope/batch remembers its Discord message so
-- corrected baselines and newly broken records edit in place instead of spamming duplicates.
create table if not exists public.rec_immortality_nfl_record_messages (
  id uuid primary key default gen_random_uuid(),
  immortality_league_id uuid not null references public.rec_immortality_leagues(id) on delete cascade,
  scope text not null check (scope in ('game', 'season', 'career')),
  batch_index integer not null check (batch_index >= 0),
  channel_id text not null,
  message_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (immortality_league_id, scope, batch_index)
);

alter table public.rec_immortality_nfl_record_messages enable row level security;

create index if not exists rec_immortality_nfl_record_messages_league_idx
  on public.rec_immortality_nfl_record_messages (immortality_league_id, scope);
