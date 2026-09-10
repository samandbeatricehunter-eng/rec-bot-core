-- Trade committee rebuild, step 1: add the "not_allowed" policy value so a league can turn
-- trades off entirely. Must land in its own migration/transaction -- a newly added enum value
-- can't be referenced by name in the same transaction that adds it.
alter type public.rec_trade_approval_policy add value if not exists 'not_allowed';
