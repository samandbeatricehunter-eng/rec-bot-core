-- Site inbox / messaging (Phase A): friendships, conversations, messages.
-- Retention: messages purged after 30 days (API job + lazy purge on read/send).

create table public.rec_site_friendships (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.rec_users(id) on delete cascade,
  addressee_user_id uuid not null references public.rec_users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_user_id <> addressee_user_id)
);

create unique index rec_site_friendships_pair_uidx
  on public.rec_site_friendships (
    least(requester_user_id, addressee_user_id),
    greatest(requester_user_id, addressee_user_id)
  );

create index rec_site_friendships_requester_idx
  on public.rec_site_friendships (requester_user_id, status);

create index rec_site_friendships_addressee_idx
  on public.rec_site_friendships (addressee_user_id, status);

alter table public.rec_site_friendships enable row level security;

create table public.rec_site_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'commissioner', 'support')),
  league_id uuid references public.rec_leagues(id) on delete cascade,
  created_by_user_id uuid not null references public.rec_users(id) on delete cascade,
  dm_user_low_id uuid references public.rec_users(id) on delete cascade,
  dm_user_high_id uuid references public.rec_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  check (
    (kind = 'dm' and dm_user_low_id is not null and dm_user_high_id is not null
      and dm_user_low_id < dm_user_high_id and league_id is null)
    or (kind = 'commissioner' and league_id is not null
      and dm_user_low_id is null and dm_user_high_id is null)
    or (kind = 'support' and league_id is null
      and dm_user_low_id is null and dm_user_high_id is null)
  )
);

create unique index rec_site_conversations_dm_pair_uidx
  on public.rec_site_conversations (dm_user_low_id, dm_user_high_id)
  where kind = 'dm';

create unique index rec_site_conversations_commissioner_uidx
  on public.rec_site_conversations (league_id, created_by_user_id)
  where kind = 'commissioner';

create index rec_site_conversations_last_message_at_idx
  on public.rec_site_conversations (last_message_at desc nulls last);

alter table public.rec_site_conversations enable row level security;

create table public.rec_site_conversation_members (
  conversation_id uuid not null references public.rec_site_conversations(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  role text not null check (role in ('member', 'commissioner', 'support_agent')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  hidden_at timestamptz,
  primary key (conversation_id, user_id)
);

create unique index rec_site_conversation_members_pair_uidx
  on public.rec_site_conversation_members (conversation_id, user_id);

create index rec_site_conversation_members_user_idx
  on public.rec_site_conversation_members (user_id);

alter table public.rec_site_conversation_members enable row level security;

create table public.rec_site_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.rec_site_conversations(id) on delete cascade,
  author_user_id uuid not null references public.rec_users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  reported_at timestamptz
);

create index rec_site_messages_conversation_created_idx
  on public.rec_site_messages (conversation_id, created_at);

alter table public.rec_site_messages enable row level security;
