-- Seed primary colors for all 32 NFL/Madden teams. Custom / relocated teams stay white.
with color_catalog as (
  select key as abbreviation, value as primary_color
  from jsonb_each_text('{
    "BUF":"#00338D","MIA":"#008E97","NE":"#002244","NYJ":"#125740",
    "BAL":"#241773","CIN":"#FB4F14","CLE":"#311D00","PIT":"#FFB612",
    "HOU":"#03202F","IND":"#002C5F","JAX":"#006778","TEN":"#0C2340",
    "DEN":"#FB4F14","KC":"#E31837","LAC":"#0080C6","LV":"#A5ACAF",
    "DAL":"#003594","NYG":"#0B2265","PHI":"#004C54","WAS":"#773141",
    "CHI":"#0B162A","DET":"#0076B6","GB":"#203731","MIN":"#4F2683",
    "ATL":"#A71930","CAR":"#0085CA","NO":"#D3BC8D","TB":"#D50A0A",
    "ARI":"#97233F","LAR":"#003594","SF":"#AA0000","SEA":"#002244"
  }')
)
update public.rec_teams as team
set primary_color = case
  when team.is_relocated then '#FFFFFF'
  else coalesce(
    (select color_catalog.primary_color from color_catalog where color_catalog.abbreviation = upper(team.abbreviation)),
    team.primary_color
  )
end
from public.rec_leagues as league
where league.id = team.league_id
  and league.game like 'madden_%';
