-- Rise to Immortality: Season Trend correction. Clearing the hot-streak bar in season-trend.ts
-- no longer auto-promotes a prospect's development trait directly -- it grants an OPPORTUNITY,
-- an elevated challenge assigned to the prospect's very next game. Beating that specific
-- challenge is what actually earns the promotion (still routed to the commissioner inbox exactly
-- as before). This table tracks that one active opportunity per prospect. See
-- progression.service.ts's evaluateSeasonTrendPromotionsAfterAdvance (grants) and
-- xp-awards.service.ts's gradeProspectForWeek (resolves, using that week's already-issued Gold
-- weekly challenge evaluated against elevated stats).
create table if not exists public.rec_immortality_promotion_opportunities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.rec_immortality_prospects(id) on delete cascade,
  from_trait text not null,
  to_trait text not null,
  target_season_number int not null,
  target_week_number int not null,
  status text not null default 'pending' check (status in ('pending', 'met', 'missed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.rec_immortality_promotion_opportunities enable row level security;

create index if not exists rec_immortality_promotion_opportunities_prospect_idx
  on public.rec_immortality_promotion_opportunities (prospect_id, status);
