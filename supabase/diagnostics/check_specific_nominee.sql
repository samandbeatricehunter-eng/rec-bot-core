-- Check if a specific nominee ID exists
-- Replace the UUID with the one that failed
select 
  'EXISTS_CHECK' as check_type,
  n.id,
  n.award_id,
  n.user_id,
  n.team_name,
  n.display_label,
  a.award_key,
  a.award_name,
  a.status as award_status
from public.rec_award_nominees n
join public.rec_awards a on a.id = n.award_id
where n.id = '799a6441-b26c-4fb5-886b-a15bb3d423ba'::uuid;

-- If no results above, check if the UUID exists anywhere
select 
  'UUID_SEARCH' as search_type,
  'rec_award_nominees' as table_name,
  count(*) as matching_rows
from public.rec_award_nominees
where id = '799a6441-b26c-4fb5-886b-a15bb3d423ba'::uuid
union all
select 
  'UUID_SEARCH' as search_type,
  'rec_award_votes' as table_name,
  count(*) as matching_rows
from public.rec_award_votes
where id = '799a6441-b26c-4fb5-886b-a15bb3d423ba'::uuid;

-- Show recent nominees to understand the data structure
select 
  'RECENT_NOMINEES' as section,
  n.id::text,
  n.award_id::text,
  n.user_id::text,
  a.award_name,
  a.status
from public.rec_award_nominees n
join public.rec_awards a on a.id = n.award_id
where a.created_at > now() - interval '1 day'
order by n.created_at desc
limit 50;
