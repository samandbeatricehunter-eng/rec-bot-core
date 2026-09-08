-- Restore RTI created-player portraits after EA identity adoption. Import restore-by-EA-ID
-- stamps the replaced Madden player's baseline photo onto rec_players.photo_url; the photo
-- the member chose or uploaded lives on rec_immortality_prospects.headshot_url.
update rec_players p
   set photo_url = pr.headshot_url, updated_at = now()
  from rec_immortality_prospects pr
 where pr.player_id = p.id
   and p.photo_url is distinct from pr.headshot_url;
