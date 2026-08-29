-- League-facing franchise branding mapped to an unchanged underlying REC/Madden team slot.
create table if not exists public.rec_league_team_identities (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.rec_leagues(id) on delete cascade,
  team_id uuid not null references public.rec_teams(id) on delete cascade,
  madden_team_id text not null,
  is_custom_identity boolean not null default false,
  default_team_name text not null,
  default_city text not null,
  default_abbreviation text not null,
  display_team_name text not null,
  display_city text not null,
  display_abbreviation text not null,
  primary_logo_url text,
  secondary_logo_url text,
  wordmark_url text,
  primary_color text,
  secondary_color text,
  tertiary_color text,
  conference text not null,
  division text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, team_id),
  unique (league_id, default_abbreviation)
);
alter table public.rec_league_team_identities enable row level security;
create index if not exists rec_league_team_identities_madden_idx
  on public.rec_league_team_identities (league_id, madden_team_id);

-- Backfill every existing RTI league, preserving its current custom display projection.
with nfl(name, abbreviation, conference, division) as (values
  ('Baltimore Ravens','BAL','AFC','North'),('Buffalo Bills','BUF','AFC','East'),
  ('Cincinnati Bengals','CIN','AFC','North'),('Cleveland Browns','CLE','AFC','North'),
  ('Denver Broncos','DEN','AFC','West'),('Houston Texans','HOU','AFC','South'),
  ('Indianapolis Colts','IND','AFC','South'),('Jacksonville Jaguars','JAX','AFC','South'),
  ('Kansas City Chiefs','KC','AFC','West'),('Las Vegas Raiders','LV','AFC','West'),
  ('Los Angeles Chargers','LAC','AFC','West'),('Miami Dolphins','MIA','AFC','East'),
  ('New England Patriots','NE','AFC','East'),('New York Jets','NYJ','AFC','East'),
  ('Pittsburgh Steelers','PIT','AFC','North'),('Tennessee Titans','TEN','AFC','South'),
  ('Arizona Cardinals','ARI','NFC','West'),('Atlanta Falcons','ATL','NFC','South'),
  ('Carolina Panthers','CAR','NFC','South'),('Chicago Bears','CHI','NFC','North'),
  ('Dallas Cowboys','DAL','NFC','East'),('Detroit Lions','DET','NFC','North'),
  ('Green Bay Packers','GB','NFC','North'),('Los Angeles Rams','LAR','NFC','West'),
  ('Minnesota Vikings','MIN','NFC','North'),('New Orleans Saints','NO','NFC','South'),
  ('New York Giants','NYG','NFC','East'),('Philadelphia Eagles','PHI','NFC','East'),
  ('San Francisco 49ers','SF','NFC','West'),('Seattle Seahawks','SEA','NFC','West'),
  ('Tampa Bay Buccaneers','TB','NFC','South'),('Washington Commanders','WAS','NFC','East')
)
insert into public.rec_league_team_identities (
  league_id, team_id, madden_team_id, is_custom_identity,
  default_team_name, default_city, default_abbreviation,
  display_team_name, display_city, display_abbreviation,
  primary_logo_url, primary_color, conference, division
)
select
  t.league_id, t.id, coalesce(t.madden_team_id, nfl.abbreviation), coalesce(t.is_relocated, false),
  nfl.name, regexp_replace(nfl.name, ' [^ ]+$', ''), nfl.abbreviation,
  t.name, coalesce(t.display_city, regexp_replace(nfl.name, ' [^ ]+$', '')),
  coalesce(t.display_abbr, t.abbreviation, nfl.abbreviation), t.logo_url, t.primary_color,
  coalesce(t.conference, nfl.conference), coalesce(t.division, nfl.division)
from public.rec_teams t
join public.rec_leagues l on l.id = t.league_id and l.league_type = 'rise_to_immortality'
join nfl on nfl.abbreviation = upper(coalesce(t.original_abbreviation, t.abbreviation))
on conflict (league_id, team_id) do nothing;
