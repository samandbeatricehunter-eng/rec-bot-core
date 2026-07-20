create table public.rec_cfb_rivalry_catalog (
  id uuid primary key,
  team_a_abbreviation text not null,
  team_b_abbreviation text not null,
  rivalry_name text not null check (char_length(rivalry_name) between 1 and 64),
  first_year_played integer check (first_year_played between 1869 and 2100),
  team_a_wins integer not null default 0 check (team_a_wins >= 0),
  team_b_wins integer not null default 0 check (team_b_wins >= 0),
  ties integer not null default 0 check (ties >= 0),
  last_game_team_a_score integer check (last_game_team_a_score >= 0),
  last_game_team_b_score integer check (last_game_team_b_score >= 0),
  streak_winner_abbreviation text,
  streak_length integer not null default 0 check (streak_length >= 0),
  verified_through_year integer not null default 2025,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_cfb_rivalry_catalog_distinct_teams check (team_a_abbreviation <> team_b_abbreviation),
  constraint rec_cfb_rivalry_catalog_pair_key unique (team_a_abbreviation, team_b_abbreviation),
  constraint rec_cfb_rivalry_catalog_streak_winner_check check (
    streak_winner_abbreviation is null
    or streak_winner_abbreviation in (team_a_abbreviation, team_b_abbreviation)
  )
);

alter table public.rec_cfb_rivalry_catalog enable row level security;

create table public.rec_league_rivalries (
  id uuid primary key,
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  catalog_id uuid references public.rec_cfb_rivalry_catalog(id) on delete set null,
  team_a_id uuid not null references public.rec_teams(id) on delete cascade,
  team_b_id uuid not null references public.rec_teams(id) on delete cascade,
  rivalry_name text not null check (char_length(rivalry_name) between 1 and 64),
  first_year_played integer check (first_year_played between 1869 and 2100),
  baseline_team_a_wins integer not null default 0 check (baseline_team_a_wins >= 0),
  baseline_team_b_wins integer not null default 0 check (baseline_team_b_wins >= 0),
  baseline_ties integer not null default 0 check (baseline_ties >= 0),
  baseline_last_game_team_a_score integer check (baseline_last_game_team_a_score >= 0),
  baseline_last_game_team_b_score integer check (baseline_last_game_team_b_score >= 0),
  baseline_streak_winner_team_id uuid references public.rec_teams(id) on delete set null,
  baseline_streak_length integer not null default 0 check (baseline_streak_length >= 0),
  team_a_wins integer not null default 0 check (team_a_wins >= 0),
  team_b_wins integer not null default 0 check (team_b_wins >= 0),
  ties integer not null default 0 check (ties >= 0),
  last_game_team_a_score integer check (last_game_team_a_score >= 0),
  last_game_team_b_score integer check (last_game_team_b_score >= 0),
  streak_winner_team_id uuid references public.rec_teams(id) on delete set null,
  streak_length integer not null default 0 check (streak_length >= 0),
  is_seeded boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_league_rivalries_distinct_teams check (team_a_id <> team_b_id),
  constraint rec_league_rivalries_pair_key unique (league_id, team_a_id, team_b_id),
  constraint rec_league_rivalries_streak_winner_check check (
    streak_winner_team_id is null
    or streak_winner_team_id in (team_a_id, team_b_id)
  )
);

alter table public.rec_league_rivalries enable row level security;

create unique index rec_league_rivalries_unordered_pair_key
  on public.rec_league_rivalries (league_id, least(team_a_id, team_b_id), greatest(team_a_id, team_b_id));
create index rec_league_rivalries_team_a_idx on public.rec_league_rivalries (league_id, team_a_id) where is_active;
create index rec_league_rivalries_team_b_idx on public.rec_league_rivalries (league_id, team_b_id) where is_active;

alter table public.rec_games
  add column rivalry_id uuid references public.rec_league_rivalries(id) on delete set null,
  add column rivalry_opt_out boolean not null default false;

create index rec_games_rivalry_idx on public.rec_games (rivalry_id) where rivalry_id is not null;

create table public.rec_rivalry_game_results (
  id uuid primary key,
  rivalry_id uuid not null references public.rec_league_rivalries(id) on delete cascade,
  game_id uuid not null references public.rec_games(id) on delete cascade,
  game_result_id uuid references public.rec_game_results(id) on delete cascade,
  season_number integer not null,
  week_number integer,
  team_a_score integer not null check (team_a_score >= 0),
  team_b_score integer not null check (team_b_score >= 0),
  winner_team_id uuid references public.rec_teams(id) on delete set null,
  is_tie boolean not null default false,
  played_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rec_rivalry_game_results_game_key unique (game_id)
);

alter table public.rec_rivalry_game_results enable row level security;

create index rec_rivalry_game_results_history_idx
  on public.rec_rivalry_game_results (rivalry_id, season_number desc, week_number desc, played_at desc);

create or replace function private.rec_recalculate_rivalry(p_rivalry_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  r public.rec_league_rivalries%rowtype;
  latest public.rec_rivalry_game_results%rowtype;
  row_result public.rec_rivalry_game_results%rowtype;
  calculated_streak integer := 0;
begin
  select * into r from public.rec_league_rivalries where id = p_rivalry_id;
  if not found then return; end if;
  select * into latest from public.rec_rivalry_game_results where rivalry_id = p_rivalry_id
    order by season_number desc, week_number desc nulls last, played_at desc, id desc limit 1;

  if not found then
    update public.rec_league_rivalries set
      team_a_wins = baseline_team_a_wins, team_b_wins = baseline_team_b_wins, ties = baseline_ties,
      last_game_team_a_score = baseline_last_game_team_a_score,
      last_game_team_b_score = baseline_last_game_team_b_score,
      streak_winner_team_id = baseline_streak_winner_team_id,
      streak_length = baseline_streak_length, updated_at = now()
    where id = p_rivalry_id;
    return;
  end if;

  if latest.is_tie or latest.winner_team_id is null then
    calculated_streak := 0;
  else
    for row_result in select * from public.rec_rivalry_game_results where rivalry_id = p_rivalry_id
      order by season_number desc, week_number desc nulls last, played_at desc, id desc
    loop
      exit when row_result.is_tie or row_result.winner_team_id is distinct from latest.winner_team_id;
      calculated_streak := calculated_streak + 1;
    end loop;
    if calculated_streak = (select count(*) from public.rec_rivalry_game_results where rivalry_id = p_rivalry_id)
       and r.baseline_streak_winner_team_id = latest.winner_team_id then
      calculated_streak := calculated_streak + r.baseline_streak_length;
    end if;
  end if;

  update public.rec_league_rivalries set
    team_a_wins = baseline_team_a_wins + (select count(*) from public.rec_rivalry_game_results where rivalry_id=p_rivalry_id and winner_team_id=r.team_a_id),
    team_b_wins = baseline_team_b_wins + (select count(*) from public.rec_rivalry_game_results where rivalry_id=p_rivalry_id and winner_team_id=r.team_b_id),
    ties = baseline_ties + (select count(*) from public.rec_rivalry_game_results where rivalry_id=p_rivalry_id and is_tie),
    last_game_team_a_score = latest.team_a_score, last_game_team_b_score = latest.team_b_score,
    streak_winner_team_id = case when latest.is_tie then null else latest.winner_team_id end,
    streak_length = calculated_streak, updated_at = now()
  where id = p_rivalry_id;
end $$;

create or replace function private.rec_sync_rivalry_game_result()
returns trigger language plpgsql set search_path = '' as $$
declare
  target_game_id uuid;
  target_rivalry_id uuid;
  rivalry public.rec_league_rivalries%rowtype;
begin
  if tg_op = 'DELETE' then
    target_game_id := old.game_id;
    select rivalry_id into target_rivalry_id from public.rec_rivalry_game_results where game_id = target_game_id;
    delete from public.rec_rivalry_game_results where game_id = target_game_id;
    perform private.rec_recalculate_rivalry(target_rivalry_id);
    return old;
  end if;
  target_game_id := new.game_id;
  select rivalry_id into target_rivalry_id from public.rec_games where id = new.game_id;
  if target_rivalry_id is null then return new; end if;
  select * into rivalry from public.rec_league_rivalries where id = target_rivalry_id and is_active;
  if not found then return new; end if;
  insert into public.rec_rivalry_game_results (
    id,rivalry_id,game_id,game_result_id,season_number,week_number,team_a_score,team_b_score,winner_team_id,is_tie,played_at
  ) values (
    gen_random_uuid(),target_rivalry_id,new.game_id,new.id,new.season_number,coalesce(new.week_number,0),
    case when new.home_team_id=rivalry.team_a_id then new.home_score else new.away_score end,
    case when new.home_team_id=rivalry.team_b_id then new.home_score else new.away_score end,
    new.winning_team_id,new.is_tie,coalesce(new.played_at,now())
  ) on conflict (game_id) do update set
    game_result_id=excluded.game_result_id,season_number=excluded.season_number,week_number=excluded.week_number,
    team_a_score=excluded.team_a_score,team_b_score=excluded.team_b_score,winner_team_id=excluded.winner_team_id,
    is_tie=excluded.is_tie,played_at=excluded.played_at,updated_at=now();
  perform private.rec_recalculate_rivalry(target_rivalry_id);
  return new;
end $$;

create trigger trg_sync_rivalry_game_result
after insert or update or delete on public.rec_game_results
for each row execute function private.rec_sync_rivalry_game_result();

revoke all on function private.rec_recalculate_rivalry(uuid) from public, anon, authenticated;
revoke all on function private.rec_sync_rivalry_game_result() from public, anon, authenticated;
