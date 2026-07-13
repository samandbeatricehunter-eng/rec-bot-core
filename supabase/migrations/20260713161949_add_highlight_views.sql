create table if not exists public.rec_highlight_views (
  id uuid primary key,
  highlight_post_id uuid not null references public.rec_highlight_posts(id) on delete cascade,
  user_id uuid not null references public.rec_users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  constraint rec_highlight_views_highlight_user_key unique (highlight_post_id, user_id)
);

alter table public.rec_highlight_views enable row level security;

create index if not exists rec_highlight_views_highlight_idx
  on public.rec_highlight_views(highlight_post_id);
