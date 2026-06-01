alter table public.rec_ea_accounts add column if not exists access_token text;
alter table public.rec_ea_accounts add column if not exists refresh_token text;
alter table public.rec_ea_accounts add column if not exists expires_at timestamptz;
alter table public.rec_ea_accounts add column if not exists raw_payload jsonb not null default '{}'::jsonb;

create index if not exists rec_ea_accounts_user_platform_idx
  on public.rec_ea_accounts(user_id, platform);
