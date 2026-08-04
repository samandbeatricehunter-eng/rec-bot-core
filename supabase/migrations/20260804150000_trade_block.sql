-- Trade Center backlog — trade block channel + player trade-block listing (Madden only).
alter table public.rec_server_routes add column if not exists trade_block_channel_id text;

alter table public.rec_players add column if not exists on_trade_block boolean not null default false;
alter table public.rec_players add column if not exists trade_block_note text;
alter table public.rec_players add column if not exists trade_block_listed_at timestamptz;

create index if not exists rec_players_trade_block_idx on public.rec_players (league_id, on_trade_block) where on_trade_block;
