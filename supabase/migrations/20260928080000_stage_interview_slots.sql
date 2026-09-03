-- Camp/offseason Media Day is a 3-question slate per advance, same as weekly Media Day.
-- Existing one-answer rows become slot 1 so members who already answered can finish 2 and 3.
alter table public.rec_immortality_stage_interview_answers
  add column if not exists slot integer not null default 1;

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.rec_immortality_stage_interview_answers'::regclass
    and contype = 'u';
  if cname is not null then
    execute format('alter table public.rec_immortality_stage_interview_answers drop constraint %I', cname);
  end if;
end $$;

alter table public.rec_immortality_stage_interview_answers
  add constraint rec_immortality_stage_interview_answers_slot_key
  unique (prospect_id, season, season_stage, advance_index, slot);

alter table public.rec_immortality_stage_interview_answers
  drop constraint if exists rec_immortality_stage_interview_answers_slot_range;
alter table public.rec_immortality_stage_interview_answers
  add constraint rec_immortality_stage_interview_answers_slot_range
  check (slot >= 1 and slot <= 3);
