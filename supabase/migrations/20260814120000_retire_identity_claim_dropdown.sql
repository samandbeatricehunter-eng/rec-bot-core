-- Permanently close the grandfather Discord identity-claim dropdown.
-- New signups use email or Discord OAuth → optional promo → Stripe; additive Discord
-- linking is OAuth callback only. Keep the settings key for audit history.
update public.rec_app_settings
set
  value = jsonb_build_object(
    'closed', true,
    'auto_close_when_empty', true,
    'retired', true
  ),
  updated_at = now()
where key = 'identity_claim_dropdown';
