# Bot Menu Map & Unbuilt-Shells Inventory

Map of the `/menu` interaction tree and the shells that are wired but not yet built
out. Status: **[built]** = working workflow · **[shell]** = connected placeholder
("coming soon" / "built next"). Routing lives in `apps/bot/src/index-timeout.ts`;
UI builders in `apps/bot/src/ui/`. Last reviewed 2026-06-18.

## Tree

```
/menu  (buildMainMenuRows · handleMainMenuSelect)
│
├─ Row 1 buttons
│  ├─ Transfer Funds                 [built]   (handlers/wallet.ts)
│  ├─ Place a Wager                  [shell]   coming soon (handlers/wallet.ts)
│  └─ Manage My Wallet               [built]
│     ├─ Transfer to Savings         [built]
│     ├─ Transfer from Savings       [built]
│     ├─ Pending Purchases           [built]
│     └─ Make a Purchase (store)     [shell]   coming soon (lives in Manage My Franchise)
│
├─ Row 2 department dropdown
│  ├─ Rosters                        [built]   (buildRostersMenuRows)
│  │  ├─ View Players by Team        [built]   (conference → team depth chart)  ← fixed 2026-06-18
│  │  ├─ View Players by Position    [shell]   coming soon
│  │  └─ View User Snapshots         [built]   (season/global stats, badges, awards, GOTW)
│  ├─ Manage My Franchise            [shell]   department shell
│  ├─ Standings & Stats              [shell]   department shell
│  ├─ REC Sports Network             [shell]   department shell
│  ├─ Rules / FAQ                    [shell]   department shell
│  └─ Admin Panel (admins only)      [built]
│     ├─ Advance Wizard              [built]   (guided weekly advance; catch-up; FS/FW)
│     │  └─ Import (EA Companion)    [built]   · MCA URL export receiver [shell] (not configured)
│     │  └─ Manual game entry        [shell]   Input Finals / Mark FS-FW disabled (needs matchup-entry API)
│     └─ Commissioner Tools          [built]
│        ├─ Manage League            [built]
│        │  ├─ User / Team Linking   [built]   (buildSimpleTeamLinkPanel)
│        │  ├─ Troubleshoot Advance  [built]   (GOTW / challenges / channels / DMs / week-stage / records)
│        │  │  ├─ Re-Generate POTW   [shell]   coming soon
│        │  │  └─ generic repair fallback [shell]
│        │  ├─ EOS Functions         [built]   (Run EOS Polls & Awards, Issue EOS Payouts)
│        │  ├─ Active Check          [built]
│        │  └─ Edit League Settings  [built]   (settings picker)
│        └─ Server / League Setup    [built]
│           ├─ Server Setup          [built]
│           ├─ League Setup Wizard   [built]
│           └─ Delete League Data    [built]   ← added 2026-06-18
```

## Unbuilt shells — inventory & intent

| Shell | Where | Planned direction |
|---|---|---|
| **Manage My Franchise** | main dropdown | Coach self-service: my team & lineup, contracts/cap snapshot, my badges, upgrade store. |
| **Standings & Stats** | main dropdown | Standings table + stat leaderboards + power rankings (uses `rec_season_user_records`, weekly stats). |
| **REC Sports Network** | main dropdown | Streams, highlights, POTW/GOTY galleries, award results. |
| **Rules / FAQ** | main dropdown | Player-facing rulebook reader + FAQ (admin rules panel already exists via `buildRulesPanel`). |
| **View Players by Position** | Rosters | Position-group filtered player browser (data is ready: `position`/`overall_rating`/`scheme`). |
| **Place a Wager** | Row-1 button | Wager coins on upcoming matchups; settle on advance from game results. |
| **Make a Purchase (store)** | Manage My Wallet | Buy upgrades/management tools; ties into Manage My Franchise. |
| **MCA URL receiver** | Advance Wizard → Import | Endpoint to receive & parse Madden Companion App exports (EA OAuth import is the working path). |
| **Manual game entry** | Advance Wizard → Manual | Enter finals + FS/FW per matchup (needs the matchup-entry API wired). |
| **Re-Generate POTW** | Troubleshoot Advance | Recompute Player of the Week. |
| **Troubleshoot repair fallback** | Troubleshoot Advance | Generic shell for not-yet-wired repair items. |

## Cleanup notes
- `adminUserTeamLinking` (a standalone Admin button) is a dead/duplicate stub — the working flow is Manage League → User / Team Linking. Remove or point it at the real panel.
- `apps/bot/src/index.ts` is a legacy duplicate of `index-timeout.ts`; `apps/bot/src/ui/economy-admin.ts` is orphaned. Delete in the modularization pass.

## Consistency notes (theme)
Standard lives in `menu-navigation-standard.md`. Conventions in use: select options carry a one-line `.setDescription` ending in a period; "Back to <parent>" for return options; slashes spaced ("Server / League Setup", "User / Team Linking", "Rules / FAQ"); shells say "coming soon" so users aren't surprised. Remaining gap: a few admin embeds predate the description convention.
