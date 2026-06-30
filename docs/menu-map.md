# Bot Menu Map & Rebuild Backlog

Canonical runtime entry: `apps/bot/src/index-timeout.ts`. Current `/menu` UI is `buildLeagueMenuEmbed()` and `buildLeagueMenuRows()` in `apps/bot/src/ui/menu.ts`. Last reviewed 2026-06-19 after the platform trim.

Status: **[built]** = working workflow, **[placeholder]** = intentionally visible but not built, **[deferred]** = removed from navigation until a rebuild slice restores it.

## Current Tree

```text
/menu
├─ Teams                              [built]
│  ├─ NFC / AFC pages                 [built]
│  └─ Request Team                    [placeholder]
├─ Schedule                           [built partial]
│  ├─ My schedule                     [built]
│  ├─ Select Team                     [placeholder]
│  ├─ SOS                             [placeholder]
│  └─ History                         [placeholder]
├─ Help/Rules                         [built]
├─ My Wallet                          [built]
│  ├─ Transfer                        [built]
│  └─ Transactions                    [built]
├─ Purchase                           [placeholder]
├─ Wager                              [placeholder]
├─ Box Score & Scoring Summary        [placeholder]
├─ User Profiles                      [built]
└─ League Mgmt                        [built admin shell]
   ├─ Teams                           [built]
   ├─ Server Setup                    [built]
   ├─ Schedule                        [placeholder: import tooling rebuild]
   ├─ Advance                         [placeholder: Advance Wizard rebuild]
   ├─ Settings                        [built]
   ├─ First-Time Setup                [built]
   ├─ Delete League                   [built]
   ├─ Roles                           [placeholder]
   └─ Back to Menu                    [built]
```

## Deferred Rebuild Backlog

| Area | Current state | Planned direction |
|---|---|---|
| Wager | Placeholder button. | Wager coins on upcoming matchups and settle from game results. |
| Purchase / Store | Placeholder button and wallet copy. | Move into Manage My Franchise with purchase caps and enabled purchase types. |
| Box score / scoring screenshots | Placeholder button. | Upload screenshots to log results, scoring details, payouts, and story generation. |
| Team requests | Placeholder from Teams. | Let users request available teams for commissioner approval. |
| Schedule subfeatures | Select Team, SOS, History placeholders. | Add any-team schedule view, strength of schedule, and historical schedule views. |
| Advance Wizard | Admin placeholder. | Rebuild weekly advance, catch-up, FS/FW, POTW, GOTW, payouts, game channels, and DMs. |
| Imports | Admin placeholder. | Rebuild EA/MCA/manual import tooling before exposing schedule management again. |
| EOS / Awards / Active Check / Troubleshoot Advance | Removed from navigation. | Reintroduce one workflow at a time after the advance/import surface is stable. |
| Standings & Stats | Removed legacy department shell. | League standings, stat leaderboards, and power rankings. |
| Manage My Franchise | Removed legacy department shell. | Coach hub for team, lineup, contracts/cap, badges, and store. |
| REC Sports Network | Removed legacy department shell. | Streams, highlights, GOTW/GOTY/POTY galleries, and award results. |

## Trim Notes

- Removed the legacy HQ dropdown (`buildMainMenuRows`) and orphaned Commissioner Tools select tree.
- Removed orphaned UI modules for league week, EOS rows, weekly challenges, power rankings, score review IDs, and baseline import snapshots.
- Removed the Stream button from `/menu`; stream payout review now starts when a user posts a link in the configured streams channel.
- Kept small API compatibility routes for currently reachable flows: rosters/conferences, server route config, league week view/set, stream post/review.
- No destructive table-drop migration was added; schema cleanup should wait until the rebuilt feature surface is stable.
