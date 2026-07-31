-- Commissioner Command Center: promotes rec_commissioners_inbox toward a real "case" model
-- without touching any of its 16+ existing writers. Every new field is additive/nullable and
-- the existing status vocabulary (pending/approved/denied/cancelled/resolved) is unchanged —
-- richer display states (Under Review, Waiting on User, Voting) are computed in the API/UI
-- from status + these flags, not stored as new status values.
alter table public.rec_commissioners_inbox
  add column if not exists internal_memo text,
  add column if not exists voting_topic_id uuid references public.rec_commissioner_chat_topics(id),
  add column if not exists awaiting_user_response boolean not null default false;

-- Immutable per-case audit trail, populated automatically by the trigger below rather than by
-- application code, so every existing insert/update call site gets history for free.
create table public.rec_commissioner_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.rec_commissioners_inbox(id) on delete cascade,
  actor_user_id uuid references public.rec_users(id),
  event_type text not null,
  prior_state jsonb,
  next_state jsonb,
  note text,
  created_at timestamptz not null default now()
);

alter table public.rec_commissioner_case_events enable row level security;

create index rec_commissioner_case_events_case_idx
  on public.rec_commissioner_case_events (case_id, created_at);

-- Actor attribution is best-effort: Postgres triggers have no session-user concept here since
-- the API always connects as the service role, so this uses whichever identity is already on
-- the row (reviewed_by_user_id if this update set it, else requester_user_id on insert).
create or replace function public.log_commissioner_case_event()
returns trigger language plpgsql as $$
begin
  insert into public.rec_commissioner_case_events (case_id, actor_user_id, event_type, prior_state, next_state)
  values (
    new.id,
    coalesce(new.reviewed_by_user_id, new.requester_user_id),
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists trg_log_commissioner_case_event on public.rec_commissioners_inbox;
create trigger trg_log_commissioner_case_event
  after insert or update on public.rec_commissioners_inbox
  for each row execute function public.log_commissioner_case_event();
