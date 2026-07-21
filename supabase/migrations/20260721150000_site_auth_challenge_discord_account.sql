alter table public.rec_site_identity_claim_challenges
  add column discord_account_id uuid
  references public.rec_discord_accounts(id) on delete cascade;

update public.rec_site_identity_claim_challenges challenge
set discord_account_id = account.id
from public.rec_discord_accounts account
where account.user_id = challenge.rec_user_id
  and challenge.discord_account_id is null;

alter table public.rec_site_identity_claim_challenges
  alter column discord_account_id set not null;
