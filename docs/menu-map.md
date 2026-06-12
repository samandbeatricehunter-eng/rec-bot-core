# Bot Menu Map & Unbuilt-Shells Inventory

Map of the `/menu` interaction tree and the shells that are wired but not yet built
out. Status: **[built]** = working workflow · **[shell]** = connected placeholder
("built next" / "coming soon"). Routing lives in `apps/bot/src/index-timeout.ts`
(the runtime entry; `index.ts` is a legacy duplicate slated for removal); UI builders
in `apps/bot/src/ui/`.

## Tree

```
/menu  (buildMainMenuRows · handleMainMenuSelect)
├─ Rosters                         [built]   (buildRostersMenuRows)
│  ├─ View Rosters by Team         [built]   (conference → team depth chart)
│  ├─ View Players by Position     [shell]   "coming soon" (index-timeout.ts:500)
│  └─ View User Snapshots          [built]   (season/global stats, badges, awards, GOTW)
├─ Manage My Team                  [shell]   department shell (handleMainMenuSelect:475)
├─ Standings & Stats               [shell]   department shell
├─ REC Bank                        [built]   (renderRecBankFromSelect)
│  ├─ Transfer to Savings          [built]
│  ├─ Transfer from Savings        [built]
│  └─ Place a Wager                [shell]   wager workflow placeholder (index-timeout.ts:419)
├─ Media Center                    [shell]   department shell
├─ Help / Rules                    [shell]   department shell
└─ Admin Panel (admins only)       [built]
   ├─ Import / Enter Data          [built]   (renderImportPanel)
   └─ Commissioner Tools           [built]
      ├─ Advance Menu              [built]
      │  ├─ Advance Current Week   [built]
      │  ├─ Run EOS Polls & Awards [built]
      │  ├─ Issue EOS Payouts      [built]
      │  └─ Troubleshoot Advance   [built]
      │     ├─ GOTW / challenges / channels / DMs / week-stage  [built]
      │     ├─ Re-Generate POTW    [shell]   "coming soon" (index-timeout.ts:1139)
      │     └─ (generic repair action fallback)  [shell] (index-timeout.ts:1254)
      ├─ Manage League             [built]
      │  ├─ Active Check           [built]
      │  ├─ View / Edit Rules      [built]   (buildRulesPanel)
      │  ├─ User / Team Linking    [built]   (buildSimpleTeamLinkPanel)
      │  └─ Edit League Settings   [built]   (settings picker)
      ├─ Server Setup              [built]
      └─ League Setup Wizard       [built]   (full wizard)
```

## Unbuilt shells — inventory & intent

| Shell | Location | Planned direction |
|---|---|---|
| **Manage My Team** | `handleMainMenuSelect` department shell | Coach self-service: view/set my lineup info, my team links, my contract/cap snapshot, my badges. |
| **Standings & Stats** | department shell | League standings table + leaderboards (uses `rec_season_user_records`, weekly stats, power rankings). Now unblocked by the canonical stat backfill. |
| **Media Center** | department shell | Streams, highlights, POTW/GOTY galleries, award results. |
| **Help / Rules** | department shell | Player-facing rule base reader + command help. (Rules panel exists on the admin side via `buildRulesPanel`.) |
| **View Players by Position** | `index-timeout.ts:500` | Position-group filtered player browser (now easy with the promoted `position`/`overall_rating`/`scheme` columns). |
| **Place a Wager** | `index-timeout.ts:419` | Wager coins on upcoming matchups; settle on advance via game results. |
| **Re-Generate POTW** | `index-timeout.ts:1139` | Troubleshoot tool to recompute Player of the Week. |
| **Troubleshoot repair fallback** | `index-timeout.ts:1254` | Generic repair-action shell for not-yet-wired repair items. |

## Cleanup notes
- `apps/bot/src/index.ts` is a **legacy duplicate** of the runtime entry `index-timeout.ts` (~1500 lines of parallel handlers). It is compiled but not run. Delete in the modularization pass.
- `apps/bot/src/ui/economy-admin.ts` + its handlers are now **orphaned** (Economy Reviews was removed from the menu). Delete in the modularization pass.
