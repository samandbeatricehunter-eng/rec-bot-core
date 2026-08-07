# Session Progress Log (2026-08-03 marathon session)

## CFB settings expansion — B2 backend wiring (2026-08-06, committed and pushed)
The site wizard already collected every new CFB setting and per-conference rule in the UI,
but the backend silently dropped them: `CreateUnclaimedLeagueSchema` stripped the unknown
keys, `buildConfigurationPayload` never mapped them, and `rec_conference_rules` was never
written. This pass wired the full path:
- Route schema (`setup.routes.ts`) now accepts `isOnline`, `crossPlayEnabled`,
  `requiredConsole`, `playerEditPermission`, `manualXpProgressionPenaltyPct`,
  `verbalCommitInfluencePct`, `userTransferChancePct`, `cpuTransferChancePct`,
  `transferPortalMaxPerTeam`, `minimumPlayClockSeconds`, `seasonExperience`, and
  `conferenceRules` (validated array shape).
- `setup.schemas.ts` (`CreateLeagueSchema`, Discord path) gained the same CFB fields +
  `conferenceRules`, and `coachXpSetting` was widened to include `simulation` (the DB check
  constraint already allowed it).
- `setup.service.ts`: `buildConfigurationPayload` + both Discord-side payloads now persist
  every new column; `createUnclaimedLeague` sets `is_online` on `rec_leagues`; new
  `upsertConferenceRules()` (delete + insert, undefined = untouched) called from
  `createUnclaimedLeague`, `updateSiteLeagueConfig`, `createLeagueForServer`, and
  `updateLeagueConfig` — so per-conference rules persist for both site-wizard and Discord
  flows.
- `getLeagueConfigAsDraft` surfaces the new CFB fields, `crossPlayEnabled`/`requiredConsole`,
  and a `conferenceRules` array.
- `settings-fields.ts` exposes all of them in the generic Settings renderer (Dynasty /
  Franchise category + cross-play/console under Rules & Policies).
- Track A (offseason display bug sweep) shipped earlier in `c8128cd`; B12/B13 (Madden
  start-method skip toggle + Gameplay/Team/Commissioner sections) and B10 (legend body types
  seeded via `20260806060000_assign_legend_body_types.sql`, displayed in
  `LegendPurchasePanel.tsx`) were already complete.

## Newly reported (2026-08-04 evening, session 3 — pick up here)
Session 3 shipped #19-24 from the backlog below (wagers team-total O/U + board
dedupe, GOTW reopen, moneyline favorite label, 4 settings bugs, EOS award
poll Discord/site vote unification, Stripe 7-day trials) — all committed and
pushed to main (`aab6602`..`9e34eef`). Mid-fix on the settings-bugs item, a
schema change went out ahead of its own migration and 500'd every "open a
league" request in production; caught live and fixed same-session
(`24132f2`) by applying the missing `ALTER TABLE`s directly. Flagging here in
case anything downstream still looks off from that ~10-minute window.

Then the user reported four more issues, none fixed yet — all investigated
enough to know the exact cause/file, not yet implemented:

- [x] **Quick Actions panel never actually replaced the My Team page's old buttons.** (shipped earlier session)

- [x] **Full Season Schedule modal missing Box Score/Highlight buttons for CPU games.**
  Root cause: `eligibleForActions` in `ScheduleWeekList` (`HubHome.tsx:321-323`)
  requires `week.confirmedMatchupType === "h2h"`, which excludes `"cpu"` games
  entirely (`TeamScheduleManualState["weeks"][number]["confirmedMatchupType"]`
  is `"h2h" | "cpu" | null` — `apps/web/src/types/api.ts:19`). User wants both
  upload buttons available for CPU games too, not just H2H. Fix is widening
  that condition to `(confirmedMatchupType === "h2h" || confirmedMatchupType === "cpu")`
  — but verify the API route the buttons call (`UploadBoxScoreModal`,
  `HighlightUploadModal`) doesn't itself reject CPU games server-side.

- [x] **Full Season Schedule (and Recruiting Board) modals poorly sized on desktop.**
  Root cause: the generic `.modal-panel` rule caps every modal at
  `max-width: 480px` (`apps/web/src/styles/surfaces.css:97`), with no
  per-modal override for either `.hub-my-schedule` (wraps
  `.hub-schedule-week-list`, opened from `HubHome.tsx:1919`) or the
  Recruiting Board modal. Compare to the overrides that already exist for
  other modals needing more room:
  `.modal-panel:has(.hub-media-modal) { max-width: 640px; }` and
  `.modal-panel:has(.roundtable-story) { max-width: min(900px, calc(100vw - 32px)); ... }`
  (`apps/web/src/styles/hub.css:343-344`). Needs a similar `:has()` override
  for both modals, sized appropriately for desktop, verified against mobile
  too (check `responsive.css` for whether these need their own mobile
  breakpoint rule, or whether removing the fixed cap is enough since the
  overlay already has `padding: var(--space-4)`).

- [x] **Recruiting Board "Available Recruits" needs a position-group filter.**
  No filter UI exists at all today in
  `apps/web/src/components/hub/RecruitingBoardModal.tsx` — net-new: a
  dropdown (ALL or a specific position) filtering `listToShow` in the "pool"
  view (component reads `recruit.position` already, so this is a pure
  frontend filter, no API change needed).

- [x] **Recruiting Board: any member can change any OTHER user's logged recruit's status.**
  `RecruitingBoardModal.tsx:229-236` renders the status `<select>` for every
  recruit in the pool view unconditionally — the code comment even says this
  was intentional ("everyone sees and can log activity on it"), but the user
  now wants it restricted to the recruit's own submitter, or a commissioner
  acting through League Mgmt tools. Good news: the backend already tracks
  ownership — `rec_recruiting_profiles` has `submitted_by_user_id` and
  `submitted_by_discord_id` columns (verified live in prod), they're just not
  selected into the API response (`SELECT_COLUMNS` in
  `apps/api/src/modules/recruiting/recruiting.service.ts`) or exposed on the
  frontend `Recruit` type (`apps/web/src/types/api.ts:192-196`). Fix: add
  `submittedByUserId` to the API select + `Recruit` type, then gate the
  status `<select>` in the pool view to
  `recruit.submittedByUserId === viewerUserId || hub.canManageLeague`
  (viewer's own user id needs to reach this component — check what
  `HubResponse`/auth context already exposes before adding a new prop).

- [x] **Spotlight/Highlight Reel playback controls (pause, rewind, mute) still don't do anything.**
  User confirmed this is still broken after the session-2 fix referenced
  above (`useStreamPlayerControls` hook + custom control bar, commit
  `08f3b72`, item #52/#53 below) — that fix either didn't ship correctly or
  doesn't cover all the surfaces the buttons appear on. Needs a fresh look
  at `apps/web/src/routes/hub/HubHome.tsx` and the equivalent in `apps/site`
  (the swipe-catcher overlay + Cloudflare Stream Player SDK wiring) — check
  whether the SDK player object is actually attached/ready before the button
  handlers fire, and whether apps/site has its own separate (possibly
  divergent) copy of this control bar that the web fix didn't reach.


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
- [x] #36 Fixed NDSU + Sacramento State missing from REC OG (`rec_leagues.id = b7cca5ad-8f0a-4305-a4df-22f5f396874d`). Root cause matched the user's own diagnosis exactly: `rec_teams` for REC OG predated those two teams being added to `CFB_27_TEAMS`, so `applyCfbBaselineToLeague` (matches by abbreviation) silently skipped them. Fixed directly against production via Supabase MCP: inserted the 2 missing `rec_teams` rows (NDSU, SAC — Independents), stamped their `madden_team_id` from the baseline dataset (`10d62a36-3981-43bc-a9a4-a0b887d1b1ba`), then inserted their 170 previously-skipped baseline players (85 each), replicating `applyCfbBaselineToLeague`'s exact logic/JSON shape. Verified: 85 NDSU + 85 SAC players now in `rec_players`. This was a one-time data fix, not a code change — no commit for this item.
- [x] #40 /claim-league instructions during league creation. Found the backend for this (`POST /v1/subscriptions/leagues/:id/bot/enable`, `/bot/invite-url`) was already built and server-owner enforcement for `/claim-league` already existed in `apps/bot/src/flows/claim-league.ts` — but there was NO UI anywhere calling it (`enableLeagueBot`/`getBotInviteUrl` in `apps/site/src/lib/site-api.ts` were 100% dead code). Added a `ConnectDiscordCard` to the "My Leagues" list in `apps/site/src/routes/Leagues.tsx`, shown to a league's head commissioner when `discordBotEnabled` is false: a "Connect a Discord Server" button that gets an invite link + token, then shows the invite link and step-by-step `/claim-league` instructions (server-owner-only warning included).
- [x] #38 "Provide Prompt" button on the Media page. New `buildArticlePromptDigest` in `apps/api/src/modules/hub/article-prompt.service.ts` (route `POST /v1/hub/publishing/article-prompt`) builds a copy/paste text prompt from a commissioner-picked week range: completed results, top-10 power rankings, and the existing 4-voice roundtable cast (`ANALYST_META` in `roundtable-take-bank.ts`) each with a suggested writing assignment. New card in `PublishingHome.tsx` with week-range inputs, "Provide Prompt" button, and a copy-to-clipboard textarea — for commissioners to hand to an external AI tool and paste the result back into Headline/Article.
- [x] #39 Playoff box score entry/upload in the team schedule editor. Root cause: `TeamScheduleForm.tsx`'s `showConfirmedView` required a result or box-score submission to already exist before showing Upload/Enter Results — regular-season games get a placeholder result row from the normal schedule pipeline so this was invisible there, but playoff/bowl games declared manually through this screen never got one, so the actions could never appear. Now gated on `week.alreadyConfirmed` alone.
- [x] #54 Daily spotlight refresh cron fix landed via background agent (commit 8c05585) — root cause was an unguarded prune-highlights query inside `refreshSpotlightReel()` that could throw and abort the whole reel recompute; now `.catch()`-wrapped, plus a duplicate prune call removed and a 45s wall-clock budget added to the per-row liveness sweep. Caveat flagged by that agent: if the reel is still stale tomorrow, check whether `REC_INTERNAL_API_KEY` was only rotated on one side (site's `docs/SECURITY_AUDIT_2026-07-28.md` recommended a rotation right before the failure window).
- [x] #35 Commissioner cancel/refund for individual open wagers (peer + house). New `listOpenWagersForCommissioner`/`commissionerCancelWager` in `apps/api/src/modules/wagers/wagers.service.ts`, routes `POST /v1/wagers/open` + `/v1/wagers/commissioner-cancel` (co_commissioner-gated), new `WagerMaintenance.tsx` panel wired into League Mgmt → Settings → Maintenance tab.

- [x] #49 EOS trigger inventory — all currently wired end-of-season automations, fired from `completeAdvanceWeek` in `apps/api/src/modules/league-week/advance-results.service.ts`, keyed to two boundaries: "postseason ends" (advancing OUT of the terminal stage, e.g. Super Bowl/National Championship, INTO the first offseason stage) and "offseason voting window closes" (advancing OUT of that first offseason stage):
  - GOTW (Game of the Week) polls: auto-assigned every week for bowl/CFP/H2H games (`autoAssignGotwForWeek`), commissioner-selected poll created if a GOTW game was picked (`createGotwPoll`), settled when that game's result posts (`settleGotwPollsForGame`) — this one is weekly, not season-end.
  - EOS stat payouts: `autoPrepareEosPayouts` — postseason-end boundary, drafts the Pending Payouts ledger for commissioner review.
  - EOS Awards: `autoPrepareEosAwards` — postseason-end boundary, auto-issues Best Passing/Rushing/Defense outright and opens 3 web voting polls (MVP, Best User Skills, Most Heart); `closeAndSettleEosAwardVoting` — closes those 3 polls and posts result headlines when the league leaves the first offseason stage.
  - Season-total badges: `issueSeasonTotalBadges` — fires when the regular season ends (advancing into any playoff stage), not the postseason-end boundary.
  - Defense Nickname retirement (CFB only): `retireStaleDefenseNicknames` — postseason-end boundary.
  - Play of the Year: `settleSeasonHighlightAwards` — postseason-end boundary, tallies highlight reactions, drafts a pending payout per category winner.
  - Game of the Year: `settleGameOfTheYear` — postseason-end boundary, tallies H2H game "like" reactions, drafts a pending review for ties.
  - Season highlight cleanup: `cleanupSeasonHighlights` — postseason-end boundary, runs after Play of the Year settles; hard-deletes every non-winning highlight, keeps POTY winners.
  - Wager grace-period refunds: `resolveWagersOnAdvance` — runs on every advance (not season-end-only), refunds anything past its 1-week box-score grace period.
  No separate cron/scheduler exists for any of these — they are all synchronous steps inside the advance-week flow itself, so nothing fires unless a commissioner (or the automated advance timer) actually advances the league through that boundary.

## Done this stretch (session 2 — different machine, 2026-08-03/04)
- [x] Mobile chat launcher FAB was unreachable above the header after the #50 fix — moved back to bottom-right, lifted clear of the bottom nav + (when embedded in apps/site) the ticker via a derived `bottom` offset, z-index bumped to 90. `apps/web/src/styles/hub.css`.
- [x] #45 Full repo audit (background agent). RLS: clean, every 2026-08-03 `create table` has its `enable row level security`. No new bugs/dead code in the session's own additions. Two pre-existing, already self-documented stubs found (not from this session): `apps/madden-connector/src/token-vault/index.ts` (in-memory only, TODO Supabase persistence — check if `madden-connector` is even wired into any app before investing further) and `apps/api/src/modules/schedule/schedule-prefill-parser.ts` (intentional no-op stub).
- [x] #46 Audited the multi-player stat-split feature (background agent) and fixed what it found: **no duplicate-submission guard** on `assignBoxScoreStatAllocations` (`apps/api/src/modules/box-score/box-score-player-stats.service.ts`) — a modal reload/retry could double-count a player's passing/rushing stats since the "already assigned" flag only lived in local React state. Added a label-set-overlap check against existing `rec_game_performance_tags` rows before insert (409 on repeat). Also fixed `apps/api/src/db/schema.ts`'s `recGamePerformanceTags` missing the `roster_player_id` column (Drizzle schema had drifted from the live migration). Left as a non-urgent finding: the single-player assign path (`assignBoxScoreStatsToPlayer`, its route, and its client method) is dead code superseded by the multi-player version — not removed since it's low-risk to leave.
- [x] #48 EOS payout progress bars on My Team page. New `computeTierProgress` helper in `packages/shared/src/economy.ts` (progress toward the next tier, anchored between the current tier's threshold — or a derived floor if no tier reached yet — and the next tier's threshold). New `getMyEosPayoutProgress` in `apps/api/src/modules/league-week/eos-payouts.service.ts` + member-gated route `POST /v1/league-week/eos-payouts/my-progress`. New "EOS Payout Progress" panel on Hub → My Team (`apps/web/src/routes/hub/HubHome.tsx`), always-on (not postseason-gated) so coaches can see what they need to hit before the ledger locks in.
- [x] #47 Commissioner poll system on the Media page. New `rec_commissioner_polls` table (migration `20260804000000_commissioner_polls.sql`, applied to remote). New Discord REST helpers `getDiscordPollResults`/`expireDiscordPoll` in `apps/api/src/lib/discord-guild.ts` (native Discord polls, read straight off the message's embedded `poll.results.answer_counts` — no per-voter fetch needed). New `apps/api/src/modules/polls/commissioner-polls.service.ts` + `polls.routes.ts` (`/v1/polls/create|list|close|cancel`), commissioner-gated create/close/cancel, member-gated list. "Double-vote elimination" = Discord's own native single-select poll guarantee (`allow_multiselect: false`), not custom logic. New "Commissioner Polls" card on `apps/web/src/routes/league-mgmt/publishing/PublishingHome.tsx` — question + up to 10 options, posts to the league's voting-polls channel, live vote bars, close/cancel.

## In progress / pending (backlog from earlier messages)
- [x] #41 CFB roster-seed advisory + "roll every player forward one season" commissioner maintenance action. New `getCfbRosterSeedStatus` + `rollForwardCfbRosterOneSeason` in `apps/api/src/modules/cfb-baseline/cfb-baseline.service.ts`; new guild-scoped routes `POST /v1/cfb-baseline/league-status` (member), `/apply` (commissioner, auto-selects the approved+active dataset), `/roll-forward` (commissioner, FR→SO→JR→SR + seniors graduate). New `CfbRosterMaintenance.tsx` card on Settings → Maintenance. NOTE: the pre-existing `POST /v1/cfb-baseline/apply-to-league` route passes a league UUID to `resolveGuildId` (broken for site sessions — guild membership check runs against a UUID) — the new `/apply` route is the correct guild-scoped path; the old route was left as-is since nothing in the web app calls it.
- [x] #42 Non-seeded-league purchase fallback: free-text name + position group + rating/tier input. The custom-player wizard's replacement-player step is now optional when a team's roster is empty (unseeded league) — the config exposes `replacementRequired`, the wizard hides the "Replace active player" select and submits `replacementPlayerId: null`, `submitCustomPlayer` only accepts a null replacement when the team has zero active/transferred-in players, and `apply_custom_player_build` is made null-safe (skips the active-replacement check + delete when `replacement_player_id` is null) via migration `supabase/migrations/20260804120000_custom_player_no_replacement.sql` (applied to remote 2026-08-04).
- [x] #43 Research Madden 27 default roster + 2026-27 NFL schedule availability; seed if available. Schedule half DONE: `packages/shared/src/nfl-schedule-2026.ts` (272 games, 18 weeks), wired for `madden_27` via `getDefaultNflScheduleForGame`. Madden 27 roster seeding DEFERRED — no `rec_madden_roster_datasets`-style infrastructure exists (CFB-only today) and web research was unavailable (search transport errors), so real-roster sourcing is blocked; revisit when research is reachable.
- [x] #44 Madden trade block system. `apps/api/src/modules/trades/` (routes + service) + `apps/web/src/routes/hub/TradeCenterHome.tsx` — full UI, nav wiring, teams endpoint (commits `da0e970`, `9ddeed0`).

(#50-54 above are all shipped — see "Done this stretch" sections; the unchecked copies that were here were stale duplicates, removed 2026-08-05.)

## Account-linking incident (2026-08-05)
User's phone-app session hit "Continue with Discord" while already signed in with email/password. That flow was a full re-auth (`signInWithOAuth`), not an additive link — since the Discord account's email didn't match the existing account's email, Supabase spun up a brand-new, empty auth identity and the browser session switched onto it, which read as "Discord got disconnected." The user's real account (`MrSixOnTheSticks` / `samuelpatrickhunter`) was never touched — its Discord link has been correctly attached since 2026-05-31. Root-caused and fixed on the other machine's session in parallel: `apps/site/src/lib/auth-context.tsx` now has an additive `linkDiscord` (`supabase.auth.linkIdentity`) plus a real "Link Discord" button on `AccountHub.tsx` — confirmed present after pulling. The stray empty auth-identity row created by the incident (email `samuelpatrickhunter@gmail.com`, no `rec_users` row) is still sitting in Supabase Auth, harmless but unused — a direct SQL delete on `auth.users` was blocked by this environment's safety classifier, so it needs cleanup from the Supabase dashboard by someone with access, or via `supabase.auth.admin.deleteUser` through the Admin API. Told the user to log back in with email/password (`samuelpatrickhunter@icloud.com`) in the meantime, which is unaffected.

## EOS payout selectivity pass (2026-08-03)
- [x] Retuned "This Defense Needs a Name" (`defense_identity_score`) to a 0-100 composite with capped per-game terms (red-zone, takeaways, 3rd/4th-down allowed rates); missing attempts data now skips the term instead of reading as 0% allowed. Verified vs production REC OG: 2/12 teams qualify (Red Wolves 82.78, Tigers 80) vs 12/12 before.
- [x] Fixed `red_zone_td_rate_allowed` missing-data-as-perfect bug in `evalTeamStat` (`apps/api/src/modules/league-week/eos-payouts.service.ts`): all-null red-zone data now returns Infinity (cannot qualify) instead of 0 (was S tier).
- [x] New read-only audit script `apps/api/scripts/eos-categories-audit.ts` evaluating every team-scope EOS category against real production data (uses prod `evalTeamStat` + `evaluatePayoutTier`, filters to regular-season weeks like the real EOS batch).
- [x] Converted all cumulative-total categories to per-game rates (user-approved) so teams stay comparable while box scores upload at uneven rates: `team_interceptions`, `total_yards_allowed`, `turnover_differential`, `total_offense_yards`, `total_penalties`, `rb_workhorse_score` in `evalTeamStat`. Missing-data guards: all-zero yards-allowed and all-zero penalties return Infinity (cannot qualify) rather than reading as flawless.
- [x] Retuned all tier ladders in `packages/shared/src/economy.ts` against the audit spread (2026-08-03). Final REC OG distribution: PPG 7/12, opp PPG 5/12, INTs 5/12, yards allowed 8/12, turnover diff 6/12, total offense 8/12, off RZ 6/12, def RZ 8/12, ToP 2/12 (data-limited), penalties 6/12, RZ finish 9/12 (small-sample noise, S bar now 90), RB workhorse 2/12, defense 2/12.
- [x] Guarded `getMyEosPayoutProgress` so Infinity (missing-data sentinel) never reaches the hub progress-bar UI — emits 0 instead. Payout items never store Infinity (`buildTeamStatItems` skips tierless values).
- [x] Shared rebuilt + `@rec/api` typecheck clean. Audit re-run confirms distributions above.

## Notes
- Trunk-based workflow: commit + push directly to main in small verified batches, `git fetch` before each push, typecheck before pushing.
- Do not revert the externally-added multi-player stat-split allocation feature in `AssignBoxScoreStatsModal.tsx` / `box-score-player-stats.service.ts`.
