# Weekly recap production assets

The recap renderer intentionally uses one code-owned package for every league. Add these before
enabling production recap publishing:

- `intro.mp4` — 1920×1080 H.264 intro. Compressed on the way in (source exports can be far
  larger than needed at the same visual quality) -- re-compress with something like
  `ffmpeg -i src.mp4 -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -c:a aac -b:a 128k
  -movflags +faststart intro.mp4` if replacing it.
- `overlay.png` — transparent 1920×1080 PNG
- `music/` — one or more licensed tracks (`.mp3`/`.m4a`/`.wav`). One is picked at random for each
  recap; the render normalizes loudness (`loudnorm`) and fades it out over the last 3 seconds
  itself, so tracks don't need pre-processing beyond being a reasonable length.

No outro -- the recap ends on the last highlight clip. The worker reports `awaiting_assets` in
`rec_weekly_recap_jobs` until intro.mp4, overlay.png, and at least one music track all exist.
