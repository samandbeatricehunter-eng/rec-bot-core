-- Show what nominee IDs actually exist in the database for recent awards
select 
  'RECENT_DATA' as info,
  a.id as award_id,
  a.award_key,
  a.award_name,
  a.status,
  count(n.id) as nominee_count,
  string_agg(distinct n.id::text, ', ' order by n.id::text) as first_5_nominee_ids
from public.rec_awards a
left join public.rec_award_nominees n on n.award_id = a.id
where a.created_at > now() - interval '1 day'
  and a.status in ('voting', 'commissioner_review')
group by a.id, a.award_key, a.award_name, a.status
order by a.created_at desc
limit 10;

-- Get one award's nominees to see structure
select 
  'AWARD_NOMINEES' as section,
  n.id,
  n.award_id,
  n.user_id,
  n.display_label,
  n.vote_count
from public.rec_award_nominees n
where n.award_id = (
  select a.id from public.rec_awards a 
  where a.created_at > now() - interval '1 day'
  order by a.created_at desc limit 1
)
limit 5;
