# COMPLETE /MENU STRUCTURE ANALYSIS

---

## USER MAIN MENU (`/menu`)

**Current Status:** Mostly unimplemented user features; Admin Panel working

```
/menu
├── [ℹ️ USER PROFILE SECTION]
│   ├── Display Name
│   ├── Team Assignment (if linked)
│   ├── Season Record (W-L)
│   ├── Global Record (career stats)
│   ├── Badges (displays all earned badges)
│   ├── GOTW Voting Record (global accuracy %)
│   └── Current Challenges (this week's goals)
│
├── 🔴 Rosters - NOT IMPLEMENTED
│   │   └─ Would show: Team roster, player ratings, contract status
│   │
├── 🔴 Manage My Team - NOT IMPLEMENTED
│   │   └─ Would show: Team management, player trades, purchases
│   │
├── 🔴 Standings & Stats - NOT IMPLEMENTED
│   │   ├─ League standings table (sort by W-L, PF, PA, PD)
│   │   ├─ Power rankings (calculated, not yet displayed)
│   │   ├─ Player stats leaderboards
│   │   └─ Historical season comparisons
│   │
├── 🔴 REC Bank - NOT IMPLEMENTED
│   │   ├─ Wallet balance display
│   │   ├─ Transfer coins to savings
│   │   ├─ Transaction history
│   │   └─ Pending payouts
│   │
├── 🔴 Media Center - NOT IMPLEMENTED
│   │   ├─ GOTW voting interface
│   │   ├─ POTW nominations/voting
│   │   ├─ Highlight archive
│   │   ├─ Stream links
│   │   └─ Community polls
│   │
├── 🔴 Help / Rules - NOT IMPLEMENTED
│   │   ├─ Display league rules (stored in DB)
│   │   ├─ Economy guide
│   │   ├─ Badge explanations
│   │   └─ FAQ
│   │
└── ✅ Admin Panel (conditional: if user is commissioner)
    └─ [See ADMIN PANEL section below]
```

---

## ADMIN PANEL (`/menu` → Admin Panel)

**Current Status:** Mostly implemented; some sections need views/handlers

```
Admin Panel Main Menu
│
├── ✅ Import / Enter Data
│   ├── ✅ Import Franchise (full EA flow)
│   │   └─ Steps: Login → Discover → Select → Scope → Week → Endpoint → Preview → Commit → Approve
│   ├── ⚠️ Import History (display-only, needs UI)
│   │   └─ Shows: Past imports, dates, game counts, status
│   └── 🔴 Manual Data Entry (not implemented)
│       └─ Would allow: Direct score entry, manual game creation
│
├── ✅ Advance Menu
│   ├── ✅ Advance Week (with GOTW approval flow)
│   │   └─ Triggers: Records, payouts, challenges, badges, GOTW selection
│   ├── ✅ Catch-Up Advance (skips DMs/game channels)
│   │   └─ For: Backfilling missed weeks
│   ├── ✅ Set Week/Stage
│   │   └─ Manual: Adjust current week or season stage
│   ├── ✅ Game Channel Management
│   │   ├─ Recreate Game Channels (creates/updates weekly matchup threads)
│   │   └─ Plan Next Advance (schedule next week's advance time)
│   │       └─ Would show: Date picker + time picker + timezone
│   ├── ✅ Weekly Challenges
│   │   └─ Regenerate (create new challenge set for upcoming week)
│   ├── ✅ Challenge Audit (debug view)
│   │   └─ Shows: Active challenges, completion status, payouts
│   └── ⚠️ Dynamic Challenges Pool (planned but not implemented)
│       └─ Would show: Opponent-based & player-specific challenge options
│
├── ✅ Active Check
│   └─ 24-hour confirmation that players are still active
│       └─ Shows: Responses, missed users, penalty tracking
│
├── ⚠️ View / Edit Rules (needs update endpoint wiring)
│   ├── ✅ View Rules (fetches from DB)
│   └── 🔴 Edit Rules (handlers missing in index.ts)
│
├── ✅ User / Team Linking
│   ├── ✅ Link Users to Teams (UI modal with selections)
│   ├── ✅ View Linked Users (shows current links)
│   ├── ✅ View Open Teams (unlinked teams)
│   └── ✅ Create Custom Teams (manual team creation)
│
├── ⚠️ Economy Reviews (needs UI implementation)
│   ├── 🔴 View Pending Payouts (not implemented)
│   │   └─ Would show: Weekly payouts, POTW pending, EOS pending
│   ├── 🔴 Review POTW (not implemented)
│   │   └─ Would show: POTW winner, stats breakdown, payout status
│   ├── 🔴 Review EOS Payouts (not implemented)
│   │   └─ Would show: End-of-season payout details, power ranking-based payouts
│   ├── ✅ Clear EOS Batch (clears pending EOS payouts)
│   └── 🔴 Stream Payout Reviews (not implemented)
│       └─ Would show: Stream compliance, pending stream payouts
│
├── ✅ Server Setup
│   └─ Channel routing and role setup (one-time setup)
│
├── ✅ League Setup
│   ├─ 32-team setup wizard with configuration
│   ├─ Economy rules selection
│   ├─ Feature toggles
│   └─ Optional team linking post-setup
│
└── ✅ Back to Main Menu
```

---

## IMPLEMENTATION STATUS SUMMARY

### ✅ COMPLETE (Ready for launch)
- Import Franchise (full EA flow)
- Advance Week automation
- Game Channel creation/management
- Weekly Challenges (generation + audit)
- Active Check
- Team Linking (full CRUD)
- Server/League Setup

### ⚠️ PARTIAL (Core logic exists, UI missing)
- Import History (needs display view)
- Edit Rules (needs handler wiring)
- Economy Reviews (all 4 sections need UI)
- Plan Next Advance (scheduling UI missing)

### 🔴 NOT STARTED (0% complete)
- Manual Data Entry
- Dynamic Challenges Pool
- User menu: Rosters, Standings, Bank, Media, Help/Rules (5 sections)

---

## DEAD ENDS & BOTTLENECKS ANALYSIS

### 1. USER MENU - COMPLETELY MISSING (40-50 hours of work)

**Dead Ends:**
- Rosters → No player display UI
- Manage My Team → No team management UI
- Standings & Stats → No standings table UI
- REC Bank → No wallet/transaction UI
- Media Center → No voting/archive UI
- Help / Rules → No rules display UI

**Impact:** Users can't see league standings, manage rosters, view media, or access economy info through `/menu`.

**Why This Matters:** Without these, players rely on external tools or Discord channels to see:
- Who's winning
- Team rosters
- League standings
- Wallet balances
- Historical performance

**Recommendation:** 
- Post-launch priority after import/advance are verified stable
- Estimated 6-8 weeks to build all 5 sections
- Start with Standings & Stats (highest demand)
- Then Rosters
- Then REC Bank
- Media Center can wait (voting via DMs works)

---

### 2. ADMIN PANEL GAPS

#### Import History - Missing View
**Current State:** History is stored in DB, not displayed
**Needed:** Modal/embed showing past imports with:
- Date
- Number of games imported
- Success/failure status
- Download/reimport option

**Effort:** 2 hours

#### Edit Rules - Missing Handler
**Current State:** UI exists (toggles, selects), but routing doesn't wire to update endpoint
**Needed:** 
- Add handler in `apps/bot/src/index.ts` to catch rule update interactions
- Wire to `setLeagueRules()` API endpoint
- Show confirmation in Discord

**Effort:** 1.5 hours

#### Economy Reviews - 4 sections missing UI
**Current State:** Logic exists in services, no UI to view pending payouts
**Sections:**
1. Pending Payouts - Show weekly coin payouts awaiting distribution
2. POTW Review - Show POTW winner, stats, pending payout
3. EOS Payout Review - Show power-ranking-based payouts
4. Stream Payout Review - Show stream compliance status

**Needed:** Each section needs:
- Data fetch from API
- Formatted embed showing summary + breakdown
- Approval/denial buttons
- Confirmation message

**Effort:** 6-8 hours total (1.5-2 hours per section)

---

### 3. ADVANCE FLOW - MISSING FEATURES

#### Plan Next Advance - Scheduling UI Missing
**Current State:** No UI to set next advance time
**Needed:** 
- Date picker (next 7 days)
- Hour selector (0-23)
- Timezone selector (EST, CST, PST, AKST)
- Show formatted datetime in multiple zones

**Implementation:** 
- Modal with date/time/tz selectors
- Send to API to update `rec_leagues.next_advance_at`
- Show confirmation with times in all zones

**Effort:** 2-3 hours

#### Dynamic Challenges Pool - Not Started
**Current State:** Pool exists, but assignments are static
**Needed:** 
- Opponent-based challenges (vary by matchup strength)
- Player-specific challenges (based on role/performance)
- Rebalancing per week based on meta

**Effort:** 4-6 hours

---

### 4. MENU DISPLAY ISSUES

#### Incomplete Sentence in Spec
The user's message was cut off: "also, for any menu displays and data that doesm..."

**Assumption:** This was about ensuring menu displays are:
- Modular/reusable
- Well-documented
- Properly typed
- Not bloated

**Solution:** All menu embeds should use factory functions for:
- Team picker dropdowns
- Player picker dropdowns
- Button row builders
- Embed builders (title, footer, description templates)

**Recommendation:** Create `apps/bot/src/ui/components/` folder with reusable builders

---

## PRIORITY ROADMAP

### LAUNCH READINESS (Today - next 4 hours)
1. ✅ Badge system (done)
2. ✅ Game channel tagging (done)
3. ✅ POTW stats fix (done)
4. ⏳ Verify import → advance → payouts flow (dry-run test)
5. ⏳ Verify game channel idempotency
6. ⏳ Fix Edit Rules wiring (1.5 hours)

### POST-LAUNCH WEEK 1
1. Import History view (2 hours)
2. Plan Next Advance UI (2-3 hours)
3. Economy Reviews UI (6-8 hours)
4. Strength of schedule caching (2 hours)
5. Power rankings display (2 hours)

### POST-LAUNCH WEEK 2-3
1. Records leaderboard in /menu (3-4 hours)
2. Standings & Stats UI (8-10 hours) ← Start here for user features
3. Dynamic Challenges Pool (4-6 hours)

### POST-LAUNCH WEEK 4-6
1. Rosters display (4-6 hours)
2. REC Bank UI (3-4 hours)
3. Help / Rules display (2 hours)
4. Manage My Team (6-8 hours)
5. Media Center (4-6 hours)

---

## MENU MODULARIZATION RECOMMENDATIONS

### Create Reusable Components

**File Structure:**
```
apps/bot/src/ui/components/
├── builders/
│   ├── dropdownBuilder.ts      // Team/Player/User pickers
│   ├── buttonBuilder.ts        // Standard button rows
│   ├── embedBuilder.ts         // Common embed templates
│   ├── leaderboardBuilder.ts   // Standings/stats tables
│   └── badgeDisplayBuilder.ts  // Badge formatting
├── pages/
│   ├── standingsPage.ts        // Standings table formatting
│   ├── rosterPage.ts           // Roster display
│   ├── walletPage.ts           // Wallet summary
│   └── mediaPage.ts            // Media hub
└── modals/
    ├── teamPickerModal.ts
    ├── playerPickerModal.ts
    └── dateTimePickerModal.ts
```

### Example Reusable Builders

```typescript
// dropdownBuilder.ts - Used by team linking, rosters, etc.
export function buildTeamDropdown(leagueId: string, excludeLinked?: boolean) {
  // Returns stringSelectMenuBuilder pre-configured
}

// leaderboardBuilder.ts - Used by standings, power rankings, records
export function buildLeaderboard(title, rows, maxRows = 10) {
  // Returns formatted embed with table rows
  // Handles: ranking numbers, truncation, sorting
}

// badgeDisplayBuilder.ts - Used in profiles, leaderboards
export function formatBadgeList(badges, format = 'emoji') {
  // Returns formatted badge string
  // Handles: badge icons, tier display, tooltips
}
```

### Benefits
- Consistency across all menus
- Easier maintenance (change once, updates everywhere)
- Faster feature development (reuse existing builders)
- Less bloated code (DRY principle)
- Easier testing (isolated components)

---

## QUESTIONS FOR CLARIFICATION

1. **User Menu Priority:** Which should be built first? (Recommend: Standings)
2. **Media Center:** Should voting be Discord-native or stay DM-based?
3. **REC Bank:** Should show savings account separate from spending wallet?
4. **Help/Rules:** Should rules be editable by commissioner, or read-only?
5. **Records Display:** Should appear in /menu as dedicated section or integrated into Standings?

---

## ESTIMATED TIME BREAKDOWN

| Feature | Hours | Priority | Launch? |
|---------|-------|----------|---------|
| Badge System | 8 | Critical | ✅ Done |
| Import Flow | 2 | Critical | ⏳ Verify |
| Advance Flow | 2 | Critical | ⏳ Verify |
| Game Channels | 1 | Critical | ⏳ Verify |
| Fix Edit Rules | 1.5 | High | ⏳ Before launch |
| Import History | 2 | Medium | Post-launch |
| Plan Next Advance | 2.5 | Medium | Post-launch |
| Economy Reviews | 7 | High | Post-launch |
| Standings UI | 10 | High | Post-launch (Week 1) |
| Power Rankings | 2 | Medium | Post-launch |
| Dynamic Challenges | 5 | Medium | Post-launch |
| Rosters | 6 | Medium | Post-launch |
| Bank UI | 4 | Low | Post-launch |
| Media Center | 5 | Low | Post-launch |
| **TOTAL** | **~58** | | |

**Critical path to launch:** 6-8 hours (import→advance→payouts verification + Edit Rules fix)
**Full user-facing features:** 6-8 weeks of development
