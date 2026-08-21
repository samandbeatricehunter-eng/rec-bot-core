-- Legend season caps belong to the team. Older legend purchases stored the team only in
-- details.purchasingTeamId and left rec_purchases.team_id null, so a coach change made the
-- new owner look like they had unused cap. Backfill the column for existing legend rows.
update public.rec_purchases
set team_id = (details->>'purchasingTeamId')::uuid
where purchase_type = 'legend'
  and team_id is null
  and details->>'purchasingTeamId' ~ '^[0-9a-fA-F-]{36}$';
