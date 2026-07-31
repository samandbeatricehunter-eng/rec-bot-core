-- Image attachments on chat messages (spec §9.1/§9.5). Reuses the proven Supabase Storage
-- upload pattern from box-score screenshots (persistUploadedImageBuffer) — same public-bucket
-- approach, a new dedicated bucket so chat uploads don't mix with box-score storage.
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', true)
on conflict (id) do nothing;

create table public.rec_chat_attachments (
  id uuid primary key default gen_random_uuid(),
  channel_type text not null check (channel_type in ('league', 'game', 'commissioner')),
  message_id uuid not null,
  provider text not null default 'supabase',
  storage_key text not null,
  original_url text not null,
  proxy_url text,
  mime_type text not null,
  filename text,
  size_bytes integer,
  width integer,
  height integer,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

alter table public.rec_chat_attachments enable row level security;

create index rec_chat_attachments_message_idx
  on public.rec_chat_attachments (channel_type, message_id);
