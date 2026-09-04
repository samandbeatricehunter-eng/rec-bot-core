-- Tracks whether the Rivalry Head-to-Head render (team comparison + prospect comparison,
-- combined graphic) has already been posted for a given game+side, so the Media Day rivalry
-- trigger (a read-path call, hit on every page load) can stay idempotent with a plain
-- insert-or-skip instead of a fragile generated-text dedup check.
create table if not exists public.rec_immortality_rivalry_h2h_posts (
  game_id uuid not null references public.rec_games(id) on delete cascade,
  side text not null check (side in ('offense','defense')),
  posted_at timestamptz not null default now(),
  primary key (game_id, side)
);
alter table public.rec_immortality_rivalry_h2h_posts enable row level security;
