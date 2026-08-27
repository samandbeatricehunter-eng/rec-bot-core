-- The capture pipeline previously retried a stream resolve/record failure forever, every 30s,
-- with no budget and no way to ever give up -- this adds the phased retry state the user asked
-- for: keep trying for 10 minutes (covers "the game hasn't started yet"), then a single 5-minute
-- cooldown, then one more try, then abandon. `phase` distinguishes the initial window (0) from
-- the post-cooldown final attempt (1); `phase_started_at` anchors each window's 10-minute budget;
-- `first_usable_frame_at` records the first frame where OCR actually read a live scorebug, so a
-- stream that resolves and records but never produces usable data still gets abandoned instead of
-- recording forever.
alter table public.rec_stream_capture_jobs
  add column if not exists phase smallint not null default 0,
  add column if not exists phase_started_at timestamptz not null default now(),
  add column if not exists first_usable_frame_at timestamptz,
  add column if not exists last_probe_at timestamptz,
  add column if not exists cooldown_until timestamptz;

alter table public.rec_stream_capture_jobs drop constraint if exists rec_stream_capture_jobs_status_check;
alter table public.rec_stream_capture_jobs add constraint rec_stream_capture_jobs_status_check
  check (status in ('pending','capturing','stop_requested','processing','completed','retry','failed','awaiting_configuration','cooldown'));

-- Per-clip value score (game-context-aware: late/close game-deciding moments score far higher
-- than a score in an already-decided blowout) so the weekly recap can select and allocate clip
-- time by actual dramatic value instead of just chronological order.
alter table public.rec_stream_event_clips add column if not exists value_score numeric not null default 0;
create index if not exists rec_stream_event_clips_value_idx on public.rec_stream_event_clips(game_id, value_score desc);
