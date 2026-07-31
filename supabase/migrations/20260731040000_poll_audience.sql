-- Public/commissioner poll audience model (spec §13). Reuses the existing commissioner-chat
-- topics/votes tables (already a generic arbitrary-options poll engine) rather than building a
-- second poll system — the only gap was that every topic was implicitly staff-only. Existing
-- rows default to 'commissioners', preserving current behavior for every existing caller.
alter table public.rec_commissioner_chat_topics
  add column if not exists audience text not null default 'commissioners' check (audience in ('commissioners', 'league'));
