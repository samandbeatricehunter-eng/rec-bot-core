alter table public.rec_award_nominees add column if not exists player_name text;
alter table public.rec_award_nominees enable row level security;
