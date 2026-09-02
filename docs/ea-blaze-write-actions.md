# EA Blaze write/action RPCs (Madden 27)

Commissioner-tool RPC command names on the same Blaze `Mobile_*` surface as the read-only
exports in `apps/api/src/modules/madden-ea/ea-client.ts` (see that file's header for the full
OAuth → Blaze session flow). These are **write** actions — they change real EA franchise state,
not just REC's database — and were provided directly by the user (2026-08-23); payload shapes
are not yet confirmed against a live session and need verification/adjustment once wired up and
tested against a real league.

| Action | Blaze commandName |
|---|---|
| Advance / sim response | `Mobile_Career_SubmitResponse` |
| Clear salary-cap penalties | `Mobile_UserAdmin_ClearCapPenalties` |
| Boot a league member | `Mobile_UserAdmin_BootUser` |
| Add in-game commissioner/admin | `Mobile_UserAdmin_AddAdmin` |
| Remove in-game commissioner/admin | `Mobile_UserAdmin_RemoveAdmin` |
| Force home win | `Mobile_GameSchedule_ForceHomeWin` |
| Force away win | `Mobile_GameSchedule_ForceAwayWin` |
| Clear forced result | `Mobile_GameSchedule_ForceNoWin` |
| Set member autopilot state | `Mobile_UserAdmin_ToggleAutoPilot` |

Not yet known: the exact `commandId` for each (existing read RPCs use fixed ids, e.g.
`Mobile_GetMyLeagues`=801, `Mobile_Career_GetLeagueHub`=811 — these write commands will have
their own ids EA expects). Confirmed via snallabot's public client (the same reference the
read-only side of this integration was built from): only those two read RPCs are documented
anywhere public — none of the ids above are published, so they cannot be hardcoded.

## Implementation (as of 2026-08-23)

Built end-to-end in `apps/api/src/modules/madden-ea/`:

- `ea-client.ts` — `EaClient.runAdminCommand(commandName, commandId, requestPayload)`, a thin
  generic wrapper over the existing `sendBlazeRpc`.
- `ea-connections.service.ts` — `EA_FRANCHISE_ACTIONS` (the 9 actions above, each tagged with a
  `target`: `none` | `schedule` | `user` | `team`), `runFranchiseAction(...)`, and
  `tryRunFranchiseAction(...)` (a never-throws wrapper for auto-hooks). Every call is logged to
  `rec_ea_franchise_actions` (league_id, action_key, trigger, command_id, request/response
  payload, ok, error — migration `20260923040000_ea_franchise_action_log.sql`).
- **Calibration, not hardcoding**: since no commandId is known, `runFranchiseAction` resolves it
  from the most recent *successful* (`ok=true`) row in `rec_ea_franchise_actions` for that
  league+action, or from an explicit override the caller passes. Until a commissioner has run an
  action once successfully (from the Tools panel below, supplying a commandId by hand), both
  manual and automatic calls for it are skipped — never guessed against a live franchise.
- Target resolution: `scheduleId` for the schedule-pair actions is parsed straight out of a
  REC-imported game's `external_game_id` (`ea:w{week}:{scheduleId}`, see
  `scheduleIdFromExternalGameId`). `userId` for the user/team-pair actions is resolved live per
  call from `getLeagueInfo(...).userAdminHubInfo.userInfoMap`, matched by `madden_team_id` — REC
  doesn't persist other members' Blaze user ids, only the connecting commissioner's own persona.

### Auto-hooks (fire once calibrated; never throw / never block the REC-side flow)

| Action | Fires from |
|---|---|
| `force_home_win` / `force_away_win` | `closeAdministrativeResult(..., "force_win", ...)` in `apps/api/src/modules/scheduling/matchup-scheduling.service.ts` (commissioner grants a Force Win) |
| `clear_forced_result` | same function, `"fair_sim"` branch (commissioner grants a Fair Sim / clears a prior Force Win) |
| `toggle_autopilot` | `resolveAutopilotRequest`'s `grant_autopilot` branch, same file |
| `add_admin` / `remove_admin` | `persistManagedRole` in `apps/api/src/modules/roles/roles.service.ts`, on any transition into/out of the `commissioner` authority |
| `boot_user` | `releaseMemberTeamLinksOnLeave` in `apps/api/src/modules/team-ownership/team-ownership.service.ts` (a linked member leaves the Discord server) |

`advance_sim` and `clear_cap_penalties` are deliberately **manual-only** — `advance_sim`
explicitly does not fire when a league advances on the REC site (per the user, 2026-08-23);
`clear_cap_penalties` has no REC-side trigger point yet, noted for later.

### Manual Tools panel

`apps/web/src/routes/league-mgmt/manage-league/FranchiseActionsModal.tsx`, wired into
`TroubleshootModal.tsx` under a new "EA Franchise Actions" `ToolGroup`. Lets a commissioner run
any of the 9 actions by hand — this is both the manual-only trigger for advance_sim/clear_cap_penalties
and the calibration tool for every action (commandId + an optional raw JSON "extra payload" field
for tuning request field names once a working commandId is found). Recent attempts are visible
inline from the audit table above.
