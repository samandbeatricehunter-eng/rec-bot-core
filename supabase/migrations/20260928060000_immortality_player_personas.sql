-- Fictional Twitter personalities for a league's real (non-RTI) roster players -- the top 5 by
-- OVR per team, generated once real EA roster data is imported. Drives queuePlayerChatterAfterImport
-- (tweet-generation.service.ts) so this curated ~160-player subset gets a consistent voice/tone
-- over time (backed by a few packages/shared/src/immortality/config/persona_dna.json trait names)
-- instead of the fully ad-hoc random tone every other roster player still gets.
create table if not exists public.rec_immortality_player_personas (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  player_id uuid not null references public.rec_players(id) on delete cascade,
  team_id uuid references public.rec_teams(id) on delete set null,
  handle text not null,
  display_name text not null,
  traits jsonb not null default '[]',
  tone_praise_weight numeric not null default 0.5,
  avatar_url text,
  created_at timestamptz not null default now(),
  unique (league_id, player_id)
);
alter table public.rec_immortality_player_personas enable row level security;

create index if not exists rec_immortality_player_personas_team_idx
  on public.rec_immortality_player_personas (league_id, team_id);
create index if not exists rec_immortality_player_personas_handle_idx
  on public.rec_immortality_player_personas (league_id, handle);
