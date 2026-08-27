# Stream OCR / autoclip production checklist

## Wired lifecycle

1. A confirmed Twitch/YouTube/TikTok session is posted to its matchup as before.
2. `postConfirmedSession` creates a durable `rec_stream_capture_jobs` row.
3. The 30-second worker resolves the public stream with `yt-dlp`, captures it with FFmpeg, and
   stops when the streaming provider reports the account offline.
4. The worker samples the recording every three seconds with the calibrated scorebug parser.
   A score increase creates a 30-second event clip (12 seconds before the detected change),
   uploads it to Cloudflare Stream, and stores its OCR context in `rec_stream_event_clips`.
5. League advance creates a `rec_weekly_recap_jobs` row for the completed week. The worker
   selects up to twelve detected clips, downloads their Cloudflare MP4s, joins them with the
   hardcoded intro/outro, applies the hardcoded overlay and music, and uploads the result.

## API service requirements

- Install `ffmpeg`/`ffprobe` and `yt-dlp` in the API runtime. On Railway Railpack set
  `RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg` and install `yt-dlp` as a Mise/package-layer tool or
  provide it in a custom Docker image. Override paths with `FFMPEG_BIN`, `FFPROBE_BIN`, and
  `STREAM_RESOLVER_BIN` if needed.
- Mount a persistent Railway volume and set `STREAM_OCR_WORK_DIR` to its mount path. A full live
  recording is retained there while OCR and clipping run; ephemeral storage can lose it on a
  redeploy.
- Keep the existing Cloudflare Stream variables configured.
- Add the four licensed/custom files described in `apps/api/assets/weekly-recap/README.md`.
- Run one private test stream and inspect `rec_stream_capture_jobs.last_error`, then verify at
  least one `rec_stream_event_clips` row and Cloudflare playback before announcing the feature.

Jobs use explicit `awaiting_configuration`, `awaiting_assets`, and retry states, so missing host
dependencies or media packages are visible in the database instead of silently dropping clips.
