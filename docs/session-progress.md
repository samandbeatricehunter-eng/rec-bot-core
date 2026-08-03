# Session Progress Log (2026-08-03 marathon session)

This file tracks the large backlog from the 2026-08-03 session so work can be
picked up at any point. Update the checkboxes as items land; add new items
under "Newly reported" as they come in mid-turn.

## Done this stretch (committed, pushed at 8e9d659)
- [x] Removed redundant "Open Commissioner Chat" button + dead overlay from CommandCenterDashboard.
- [x] Fixed Wagers page "Close Wagers" button hidden behind chat launcher FAB (moved to left corner).
- [x] Centered Wagers page headers/subheaders.
- [x] Added per-wager Edit/Cancel buttons to "My Wagers" list on HubHome.
- [x] #50 Moved mobile chat launcher FAB into header row next to bell (was covering bottom nav's last tab). CSS-only reposition in `apps/web/src/styles/hub.css` (media query max-width:700px); already league-only via AppShell mount condition.
- [x] #51 Hub scope now syncs to route in `apps/web/src/lib/hub-chrome-context.tsx` — landing on /home, /leagues, /comp, /account without a `section=league` query resets scope to main, fixing the switcher getting stuck on a league after browser-back or non-exitToMain navigation.
- [x] #52/#53 Highlight reel mobile swipe + playback controls (Spotlight + Highlight Reel) — fixed by background agent, pushed as commit 08f3b72. Missing `touch-action: pan-y` on apps/site's Spotlight card broke swipe; added a `useStreamPlayerControls` hook (Cloudflare Stream Player SDK) + custom control bar to both apps since the swipe-catcher overlay blocked native iframe controls.
- [ ] #54 (spotlight cron fix) still in progress in the background — touching apps/api/src/modules/site-home/site-home.service.ts.
- [x] #35 Commissioner cancel/refund for individual open wagers (peer + house). New `listOpenWagersForCommissioner`/`commissionerCancelWager` in `apps/api/src/modules/wagers/wagers.service.ts`, routes `POST /v1/wagers/open` + `/v1/wagers/commissioner-cancel` (co_commissioner-gated), new `WagerMaintenance.tsx` panel wired into League Mgmt → Settings → Maintenance tab.
- [x] #37 Advance Readiness Notify Home/Away/Both buttons now also post "SCHEDULE YOUR GAME ASAP" to the game's Discord channel (tagging the user(s), if a channel is tracked) and to the site's game chat for that matchup — `notifyScheduleGameAsap` in `apps/api/src/modules/league-week/advance-results.service.ts`, called from `notifyMissingBoxScore`. Existing push notification is unchanged/additive.
- [x] #35 Commissioner cancel/refund for individual open wagers (peer + house). New `listOpenWagersForCommissioner`/`commissionerCancelWager` in `apps/api/src/modules/wagers/wagers.service.ts`, routes `POST /v1/wagers/open` + `/v1/wagers/commissioner-cancel` (co_commissioner-gated), new `WagerMaintenance.tsx` panel wired into League Mgmt → Settings → Maintenance tab.

## In progress / pending (backlog from earlier messages)
- [ ] #36 Fix NDSU + Sacramento State missing from REC OG `rec_teams` baseline (170 skipped players).
- [ ] #37 Advance Readiness "Notify" buttons should tag users in Discord/site game chat: "SCHEDULE YOUR GAME ASAP".
- [ ] #38 "Provide Prompt" button on Media page (stats/context digest + roundtable personalities/assignments).
- [ ] #39 Playoff box score entry/upload in schedule editor (past + current week).
- [ ] #40 `/claim-league` step-by-step instructions surfaced during league creation (Discord toggle).
- [ ] #41 CFB roster-seed advisory + "roll every player forward one season" commissioner maintenance action.
- [ ] #42 Non-seeded-league purchase fallback: free-text name + position group + rating/tier input.
- [ ] #43 Research Madden 27 default roster + 2026-27 NFL schedule availability; seed if available.
- [ ] #44 Madden trade block system (mirror in-game UI; move View Roster to More, add Trades nav item).
- [ ] #45 Full repo audit: dead code, bugs, placeholders, unfinished pages.
- [ ] #46 Audit externally-added multi-player stat-split feature (`assignBoxScoreStatAllocations`) for backend/frontend parity.
- [ ] #47 Commissioner poll system (Media page) with Discord-native poll sync + double-vote elimination.
- [ ] #48 EOS payout progress bars on My Team page.
- [ ] #49 List all currently-wired EOS triggers/polls for user review.

## Newly reported (this message)
- [ ] #50 Mobile: chat launcher FAB covers the "More" tab of the bottom nav bar — move it to top of screen, left of the bell icon, and only show it while inside a league.
- [ ] #51 Mobile: hub/league switcher doesn't reset to "main hub" when user taps bottom-nav back to main hub while a league was open via the switcher.
- [ ] #52 Highlight reel: swipe to next/previous not working on mobile.
- [ ] #53 Highlight reel / Spotlight: no playback controls (pause, rewind, unmute).
- [ ] #54 Daily spotlight refresh cron job failing every morning — needs investigation + fix.

## Notes
- Trunk-based workflow: commit + push directly to main in small verified batches, `git fetch` before each push, typecheck before pushing.
- Do not revert the externally-added multi-player stat-split allocation feature in `AssignBoxScoreStatsModal.tsx` / `box-score-player-stats.service.ts`.
