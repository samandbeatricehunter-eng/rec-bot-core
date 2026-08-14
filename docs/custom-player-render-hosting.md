# Custom-player render hosting (Cloudflare Images)

The 150 custom-player card renders (`cpr-001` … `cpr-150`) are ~348 MB of PNGs. They are
**not** shipped in the site deploy. They are converted to WebP (~23 MB total) and uploaded to
Cloudflare Images once, then served from `imagedelivery.net`. This keeps ~348 MB out of every
Railway build/upload and serves the images from Cloudflare's edge.

## One-time (or re-run) upload

Requires `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_HASH` in
`apps/api/.env` (the same Cloudflare Images credentials used for legend headshots).

```bash
# Preview conversion + sizing without uploading:
pnpm --filter @rec/api exec tsx scripts/upload-custom-player-renders.ts --dry-run

# Convert to WebP and upload all 150 (idempotent — existing ids are replaced):
pnpm --filter @rec/api exec tsx scripts/upload-custom-player-renders.ts
```

The script reads `apps/web/public/assets/custom-player-renders/cpr-XXX.png` (override with
`--dir <folder>`), uploads each with a stable custom image id equal to the render id, and
writes a local manifest to `apps/api/scripts/.custom-player-renders-upload.json` (gitignored).
Local PNGs are never modified or deleted.

## Env vars (set after uploading)

The delivery URL is deterministic: `https://imagedelivery.net/<account-hash>/cpr-XXX/public`.
Point both deployables at the delivery base (no trailing slash):

- **Site** (`apps/site`): `VITE_ASSET_BASE_URL=https://imagedelivery.net/<account-hash>`
  - Injected at runtime by `apps/site/server/serve.js` into `window.__REC_SITE_CONFIG__`, so a
    Railway env change takes effect without a rebuild.
- **API** (`apps/api`): `CUSTOM_PLAYER_RENDER_BASE_URL=https://imagedelivery.net/<account-hash>`
  - Used when writing `rec_players.photo_url` for a custom player.

Leave both unset/empty in local dev to serve the local `/assets/custom-player-renders/...`
files (regenerate them with `scripts/dev/generate-custom-player-renders.py`).

## How it resolves

`packages/shared/src/custom-player-renders.ts` (`customPlayerRenderBaseUrl` /
`customPlayerRenderImagePath`) resolves the base isomorphically — the site reads
`window.__REC_SITE_CONFIG__.VITE_ASSET_BASE_URL`, the API reads
`process.env.CUSTOM_PLAYER_RENDER_BASE_URL`. When the base is an `imagedelivery.net` host it
builds `{base}/{id}/public`; otherwise it falls back to the local static path. The
`player-silhouette.svg` fallback always stays on the bundle.

## Repo layout

`apps/web/public/assets/custom-player-renders/` is gitignored. The Vite plugin in
`apps/site/vite.config.ts` still copies `apps/web/public/assets` into the site build, but the
renders folder is no longer in the repo, so it is no longer copied or deployed.
