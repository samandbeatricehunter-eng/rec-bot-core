-- Diagnostic: Check if award nominees have proper row IDs populated
-- Shows recent awards, their nominee counts, and sample data

select 
  'AWARDS' as section,
  a.id as award_id,
  a.award_key,
  a.award_name,
  a.status,
  count(n.id) as nominee_count,
  count(case when n.id is not null then 1 end) as nominees_with_ids
from public.rec_awards a
left join public.rec_award_nominees n on n.award_id = a.id
where a.created_at > now() - interval '7 days'
  and a.status in ('voting', 'commissioner_review')
group by a.id, a.award_key, a.award_name, a.status
order by a.created_at desc
limit 15;

-- Sample nominees for the most recent award requiring voting
select 
  'NOMINEES' as section,
  n.id,
  n.award_id,
  n.user_id,
  n.team_name,
  n.display_label,
  n.vote_count,
  n.final_score,
  case when n.id is not null then 'YES' else 'NO' end as has_row_id
from public.rec_award_nominees n
where n.award_id = (
  select a.id
  from public.rec_awards a
  where a.status in ('voting', 'commissioner_review')
    and a.created_at > now() - interval '7 days'
  order by a.created_at desc
  limit 1
)
order by n.final_score desc, n.vote_count desc
limit 25;

-- Recent votes for diagnostic
select 
  'VOTES' as section,
  v.award_id,
  v.voter_user_id,
  v.nominee_user_id,
  v.nominee_key,
  count(*) as vote_count
from public.rec_award_votes v
where v.created_at > now() - interval '1 day'
group by v.award_id, v.voter_user_id, v.nominee_user_id, v.nominee_key
order by v.created_at desc
limit 20;
