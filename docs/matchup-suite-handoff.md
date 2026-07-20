# Matchup-page Suite - Work Handoff

Continue building the REC "Matchup-page suite." pnpm monorepo: `apps/api` (Fastify),
`apps/bot` (discord.js), `apps/web` (React/Vite), `packages/shared`. Windows + PowerShell.
Work in small, targeted edits. Keep context lean: do NOT open/attach large or binary files
(`*.generated.ts`, `.woff2`/`.ttf`, big command-output dumps).

## Environment notes (save time)

- The `Write` tool writes UTF-16LE on this machine, which breaks `tsc` (TS1127 "Invalid
  character"). After creating ANY new file with `Write`, re-save it as UTF-8 without BOM,
  e.g. a PowerShell one-liner (run outside the restricted shell) that reads the file with
  `[System.IO.File]::ReadAllText(path,[Text.Encoding]::Unicode)` and writes it back with
  `[System.IO.File]::WriteAllText(path,text,(New-Object Text.UTF8Encoding($false)))`.
  Edits via `StrReplace` to existing UTF-8 files are fine.
- `node`/`pnpm`/`tsc` must run outside the restricted shell (request the elevated run when
  prompted); otherwise they return no exit status. `git`/`echo` run normally.
- PowerShell: chain with `;` not `&&`.
- Verify after each change: `pnpm --filter @rec/shared build`, then
  `pnpm --filter @rec/api exec tsc --noEmit` and `pnpm --filter @rec/web exec tsc --noEmit`.
- Supabase project id `kyooxpjsxvsatrariafq`; active dev league id
  `b7cca5ad-8f0a-4305-a4df-22f5f396874d`. Apply DB migrations via the Supabase MCP AND keep
  a matching `.sql` in `supabase/migrations/`; every new public table enables RLS.
- Only commit when asked; push to `main` when a coherent chunk is done.
- Leave the pre-existing no-op change in `apps/bot/src/index-timeout.ts` alone. A stray
  one-line `const [voting,setVoting]=useState(false)` may exist in `MatchupDetail.tsx` -
  use it for the GOTW work or remove it.

## Already done + pushed to main

1. Matchup Preview card: `apps/api/src/modules/hub/matchup-preview.service.ts` + route
   `/v1/hub/matchups/preview`; web `components/matchups/MatchupPreview.tsx`, `types/api.ts`
   (`MatchupPreview`), `rec-api-client.getMatchupPreview`, rendered in
   `routes/matchups/MatchupDetail.tsx`. Per-team season breakdown + win% + projected score
   (Pythagorean + log5 + home edge; projected score from offense/defense rates).
2. Custom `rec_teams.primary_color` set for 7 relocated teams (Reap U burnt orange, Hard
   Knox yellow, EG Boys dark blue, Garner College blue, Red Wolves red, AFE U Lions gold,
   UAF Nanooks light blue).
3. Universal per-league fonts: `styles/themes/cfb27.css` + `madden27.css` override
   `--font-sans` (Victory Slab for CFB, Gridiron for Madden).
4. Matchup action toolbar (`MatchupActions` in `MatchupDetail.tsx`): the two coaches see
   Box Score / Player Stats / Share Stream / Upload Highlight(s); everyone else sees the
   Wagers button. All are placeholders right now and need wiring.

## Decisions already made

- Prediction shows BOTH win% and a projected score line.
- Share Stream captures a RAW platform URL; embed Twitch + YouTube (+ Kick) inline, with a
  link-out fallback for other hosts.
- Box Score / Player Stats buttons open the EXISTING flows.
- Highlight overhaul = exactly Like / Dislike / POTY (remove Love, the poop reaction, AND
  the whole sideline-reaction bar + chassis). POTY still opens the category modal.
- Human-vs-CPU gets a clickable detail page with Matchup Preview + Box Score + Player Stats
  + Share Stream, but NO chat, no Wagers, no GOTW.

## Pending work (ordered)

1. Matchup Preview fix in `matchup-preview.service.ts`: dedupe duplicate `rec_game_results`
   rows by matchup-week (key `week_number + home_team_id + away_team_id`) before
   aggregating, and never project a tie (if the projected scores are equal, nudge the
   higher-win-probability side up by 1; break an exact 50/50 toward the home side).
2. On-page GOTW voting on the matchup detail page. `getHubMatchupDetail` already returns
   `detail.gotw`; `recApi.voteGameOfWeek` exists. Add a voting panel (two team buttons +
   vote counts + a percentage meter, disabled when `status !== "open"` or `!canVote`), then
   reload the detail.
3. Wire the toolbar buttons: Box Score + Player Stats -> existing flows; the Wagers button
   (spectators only) -> reuse the flow in `routes/hub/HubHome.tsx`
   (`openWager` / `placeWager` / `getWagerOptions`); Upload Highlight(s) stays a placeholder
   (highlight uploads run through Discord for now).
4. Share Stream submission + inline embed: capture a raw platform URL; embed the designated
   streamer's stream (league draft config `regular/postseasonStreamingSide` = home/away/
   both) OR the first poster if there is no designation / none for the active side; the
   other coach's stream shows as a link if they also posted. Backend: extend
   `streams.service.ts` / `rec_stream_compliance_logs` (`details.content` can hold the URL).
5. League rules display on the matchup page, matching the Discord game-channel embed. Reuse
   the logic in `apps/bot/src/flows/game-channel-pages.ts` `gameRulesLines()` (4th-down +
   streaming rules from league draft config); expose via a new API endpoint and render it
   read-only on the page.
6. Human-vs-CPU detail pages: make CPU cards clickable (`MatchupCard` currently renders CPU
   as a non-link `div`) and let `getHubMatchupDetail` accept human-vs-CPU (it currently
   400s on CPU), showing Preview + Box Score + Player Stats + Share Stream only (no chat,
   Wagers, or GOTW).
7. Matchup-page lifecycle on advance: extend the existing chat wipe
   (`advance-results.service.ts` deletes `rec_matchup_chat_messages` on advance, ~line 508)
   into a full teardown + recreate of matchup pages as the league advances.
8. Post-season + closing rules: all post-season games are GOTW with voting; voting AND the
   Wagers market close once a stream is posted. `closeGameMarketsAfterStream()` in
   `streams.service.ts` already closes the market + GOTW poll for a game - extend it for
   per-game post-season polls.
9. Highlight overhaul: in `routes/hub/HubHome.tsx` (~lines 1034-1063) and `hub.css`, remove
   the chassis + sideline-reaction bar and rebuild a clean Like / Dislike / POTY embed
   (POTY opens the category modal). This also clears most remaining `hub.css` gold literals.
10. Glow sweep part 2: replace the remaining structural gold literals in `hub.css`
    (`var(--gold)`, and hex like `#ffe071` / `#f0c85a` / `#d9a5xx`) by routing through the
    accent tokens.

Start with task 1, verify with the shared build + both typechecks, and push to main when a
coherent chunk is complete. Ask before large or destructive changes.
```
