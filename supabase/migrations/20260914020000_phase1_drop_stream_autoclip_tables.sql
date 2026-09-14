-- Phase 1 cleanup: the stream scorebug OCR/autoclip capture pipeline
-- (stream-autoclip.service.ts, yt-dlp/ffmpeg capture, Railway stream-ocr-resolver build step)
-- is fully removed from application code. These three tables existed only to support that
-- pipeline (capture jobs, extracted event clips, and its weekly-recap job queue) -- confirmed
-- via source search that no remaining code references any of them. Ordinary stream
-- sharing/compliance/payout tables (rec_streaming_accounts, rec_streaming_sessions,
-- rec_stream_compliance_logs, rec_stream_payout_reviews, rec_stream_views,
-- rec_stream_reactions) are untouched -- they're used broadly, not autoclip-exclusive
-- (verified via source search before this migration). No external FKs reference the three
-- dropped tables either (verified via information_schema first).
drop table if exists public.rec_stream_capture_jobs cascade;
drop table if exists public.rec_stream_event_clips cascade;
drop table if exists public.rec_weekly_recap_jobs cascade;
