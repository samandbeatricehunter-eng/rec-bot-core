-- Native Discord EOS award poll tracking.
-- Existing tables already have RLS enabled; no new table is created.

alter table public.rec_eos_award_polls
  add column if not exists award_amount integer not null default 200,
  add column if not exists nominee_user_ids jsonb not null default '[]'::jsonb,
  add column if not exists nominee_payloads jsonb not null default '[]'::jsonb,
  add column if not exists discord_channel_id text,
  add column if not exists discord_message_id text,
  add column if not exists settled_at timestamptz,
  add column if not exists paid_ledger_id uuid references public.rec_dollar_ledger(id),
  add column if not exists vote_counts jsonb not null default '{}'::jsonb;

alter table public.rec_eos_award_polls
  drop constraint if exists rec_eos_award_polls_status_check;

alter table public.rec_eos_award_polls
  add constraint rec_eos_award_polls_status_check
  check (status in ('draft', 'open', 'settled', 'cancelled', 'needs_review'));

create index if not exists rec_eos_award_polls_open_idx
  on public.rec_eos_award_polls(league_id, status, closes_at);

create index if not exists rec_eos_award_polls_message_idx
  on public.rec_eos_award_polls(discord_channel_id, discord_message_id);
