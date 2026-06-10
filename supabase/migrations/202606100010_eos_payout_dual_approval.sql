-- Add user_approved_at to track recipient's approval separately from commissioner approval.
-- approved_at / approved_by_user_id = commissioner approval (existing columns).
-- user_approved_at = recipient clicked "Approve" in their DM.
-- Payout is issued only when both are set.

alter table public.rec_eos_payout_items
  add column if not exists user_approved_at timestamptz,
  add column if not exists commissioner_user_id uuid references public.rec_users(id);
