# Stream OCR / autoclip production checklist

## Wired lifecycle

1. A confirmed Twitch/YouTube/TikTok session is posted to its matchup as before.
2. `postConfirmedSession` creates a durable `rec_stream_capture_jobs` row (`phase 0`,
   `phase_started_at = now()`).
3. The 30-second worker resolves the public stream with `yt-dlp` and captures it with FFmpeg.
   A resolve failure, or a successful recording that never yields a usable scorebug frame,
   counts against a 10-minute budget measured from `phase_started_at` (covers "the game hasn't
   kicked off yet"). Running out of that budget on the first attempt (`phase 0`) parks the job in
   `cooldown` for 5 minutes, then gives it exactly one more 10-minute attempt (`phase 1`) before
   marking it `failed` for good. `runStreamingSweep`'s offline detection calls
   `requestStreamAutoclipStop`, which stops an active recording and updates the site's live status
   the same way it already does for the stream-confirmed post itself.
4. While `capturing`, a lightweight probe grabs one live frame roughly once a minute (straight
   from the stream, not the in-progress recording file) to confirm OCR is actually reading a
   scorebug; once confirmed, the recording runs uninterrupted until the stream ends.
5. The worker samples the finished recording every three seconds with the calibrated scorebug
   parser. A score increase creates a 30-second event clip (12 seconds before the detected
   change), scores it with `computeClipValue` (points scored, lead change/tying play, closeness,
   and a late-game clutch bonus that only applies when the game is still actually in doubt --
   see `stream-autoclip.service.ts`), uploads it to Cloudflare Stream, and stores its OCR context
   plus `value_score` in `rec_stream_event_clips`.
6. League advance creates a `rec_weekly_recap_jobs` row for the completed week. The worker picks
   up to twelve clips via `selectRecapClips`: each game's importance is its single best clip, and
   games are filled in importance order (up to 3 clips each) until the budget is spent -- so a
   dramatic nailbiter can contribute more clips than a blowout with one early lead change, and a
   blowout with no late drama may contribute nothing. Selected clips are downloaded from
   Cloudflare, joined with the hardcoded intro/outro, overlay, and music, and uploaded as the
   final recap.

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
