-- Spotlight-specific reactions (likes here award +25 coins to the original poster).

create table if not exists public.rec_spotlight_reactions (
  id uuid primary key default gen_random_uuid(),
  highlight_post_id uuid not null references public.rec_highlight_posts(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  reaction_key text not null check (reaction_key in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  unique (highlight_post_id, user_id)
);
create index if not exists rec_spotlight_reactions_highlight_idx
  on public.rec_spotlight_reactions (highlight_post_id);
alter table public.rec_spotlight_reactions enable row level security;