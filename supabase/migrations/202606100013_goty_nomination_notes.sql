alter table public.rec_goty_nominations
  add column if not exists nomination_notes text;
