# Weekly recap production assets

The recap renderer intentionally uses one code-owned package for every league. Add these exact
files before enabling production recap publishing:

- `intro.mp4` — 1920×1080 H.264 intro
- `outro.mp4` — 1920×1080 H.264 outro
- `overlay.png` — transparent 1920×1080 PNG
- `music.mp3` — licensed recap bed

The worker reports `awaiting_assets` in `rec_weekly_recap_jobs` until all four exist. Keep the
filenames stable; replacing their contents changes the package without a schema/config change.
