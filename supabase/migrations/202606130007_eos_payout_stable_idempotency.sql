create unique index if not exists rec_dollar_ledger_eos_payout_idempotency_key
  on public.rec_dollar_ledger ((source_reference->>'idempotencyKey'))
  where transaction_type = 'eos_payout'
    and source_reference ? 'idempotencyKey';
