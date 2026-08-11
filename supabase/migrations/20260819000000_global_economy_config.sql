create table if not exists public.rec_global_economy_config (
  config_key text primary key check (config_key = 'global'),
  config jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_by_user_id uuid null references public.rec_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rec_global_economy_config enable row level security;
revoke all on table public.rec_global_economy_config from anon, authenticated;

comment on table public.rec_global_economy_config is
  'Singleton, service-role-only source of truth for global REC prices, payouts, caps, awards, and EOS thresholds.';

insert into public.rec_global_economy_config (config_key, config, version)
values ('global', '{"version":1,"store":{"ageReset":1000,"playerTrait":500,"legend":5000,"devUpgradeStep":500,"devUpgradeTopStep":1500,"contractReduction":500,"contractExtension":500,"coreAttributePoint":200,"nonCoreAttributePoint":100,"customPlayerBronze":250,"customPlayerSilver":750,"customPlayerGold":1000,"customPlayerTier1":500,"customPlayerTier2":750,"customPlayerTier3":1000,"customPlayerTier4":1500,"customPlayerTier5":2000},"submissions":{"boxScoreWin":100,"boxScoreLoss":50,"badgeBonus":10,"highlight":25,"highlightSeasonAward":500,"gameOfYear":250,"highlightWeeklyPaidLimit":2,"highlightWeeklyUploadLimit":2,"stream":50,"article":100,"interview":50,"gotwCorrectVote":25,"potw":10,"weeklyChallengeS":50,"weeklyChallengeA":25,"weeklyChallengeB":10},"wagers":{"houseWeeklyMaximum":1000,"peerWeeklyMaximum":5000},"awards":{"bestPassing":200,"bestRushing":200,"bestDefense":200,"mvp":1000,"mostSkilled":350,"mostHeart":500},"eos":[]}'::jsonb, 1)
on conflict (config_key) do update
set config = jsonb_set(rec_global_economy_config.config, '{store,legend}', '5000'::jsonb, true),
    version = greatest(rec_global_economy_config.version, 1),
    updated_at = now();
