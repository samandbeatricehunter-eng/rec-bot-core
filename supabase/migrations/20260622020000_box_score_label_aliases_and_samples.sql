-- Learned OCR label aliases: garbled labels that a commissioner-approved parse
-- mapped to a canonical stat key, so future parses hit them exactly. Global
-- (OCR text is league-independent). RLS enabled per repo convention.
create table if not exists public.rec_ocr_label_aliases (
  id uuid primary key default gen_random_uuid(),
  raw_label text not null unique,
  canonical_key text not null,
  hit_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.rec_ocr_label_aliases enable row level security;

-- Raw OCR labels captured per submission (fuzzy matches only) so approval can
-- promote them into rec_ocr_label_aliases.
alter table public.rec_box_score_submissions
  add column if not exists parse_label_samples jsonb;
