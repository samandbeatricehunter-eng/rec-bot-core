# /MENU STRUCTURE & BOTTLENECK ANALYSIS

## CURRENT MENU HIERARCHY

### PRIMARY MENU (User-facing)
```
/menu
├── Rosters                    [❌ DEAD END - Not implemented]
├── Manage My Team            [❌ DEAD END - Not implemented]
├── Standings & Stats         [❌ DEAD END - Not implemented]
├── REC Bank                  [❌ DEAD END - Not implemented]
├── Media Center              [❌ DEAD END - Not implemented]
├── Help / Rules              [❌ DEAD END - Not implemented]
└── Admin Panel (if admin)    [✅ IMPLEMENTED - See below]
```

### ADMIN PANEL (Commissioner-only)
```
Admin Panel
├── Import / Enter Data
│   ├── Import Franchise      [✅ IMPLEMENTED - Full EA flow]
│   ├── Import History        [❌ NEEDS VIEW]
│   └── Manual Data Entry     [❌ NOT IMPLEMENTED]
│
├── Advance Menu
│   ├── Advance Week          [✅ IMPLEMENTED - With GOTW approval]
│   ├── Catch-Up Advance      [✅ IMPLEMENTED]
│   ├── Set Week/Stage        [✅ IMPLEMENTED]
│   ├── Game Channel Mgmt     [✅ IMPLEMENTED - Recreate/plan]
│   ├── Weekly Challenges     [✅ IMPLEMENTED - Regenerate]
│   └── Challenge Audit       [✅ IMPLEMENTED]
│
├── Active Check              [✅ IMPLEMENTED - 24hr confirmation]
│
├── View / Edit Rules
│   ├── View Rules            [✅ IMPLEMENTED]
│   └── Edit Rules            [❌ NEEDS UPDATE ENDPOINTS]
│
├── User / Team Linking
│   ├── Link Users to Teams   [✅ IMPLEMENTED]
│   ├── View Linked Users     [✅ IMPLEMENTED]
│   ├── View Open Teams       [✅ IMPLEMENTED]
│   └── Create Custom Teams   [✅ IMPLEMENTED]
│
├── Economy Reviews
│   ├── View Pending Payouts  [❌ NEEDS IMPLEMENTATION]
│   ├── Review POTW           [❌ NEEDS IMPLEMENTATION]
│   ├── Review EOS Payouts    [❌ NEEDS IMPLEMENTATION]
│   ├── Clear EOS Batch       [✅ IMPLEMENTED]
│   └── Stream Payout Reviews [❌ NEEDS IMPLEMENTATION]
│
├── Server Setup              [✅ IMPLEMENTED - Channel/role routing]
│
├── League Setup              [✅ IMPLEMENTED - 32-option wizard]
│   └── Optional Team Linking [✅ IMPLEMENTED - Post-setup]
│
└── Back to Main Menu         [✅ IMPLEMENTED]
```

---

## DEAD ENDS (User Menu)

| Menu Item | Status | Impact | Fix Required |
|-----------|--------|--------|--------------|
| Rosters | ❌ Never built | Users can't view team rosters | Build roster viewer with player details, stats, salary cap |
| Manage My Team | ❌ Never built | Users can't manage players/purchases | Build team management UI (trades, purchases, roster moves) |
| Standings & Stats | ❌ Never built | Users can't see league standings | Build standings table, player stats, advanced analytics |
| REC Bank | ❌ Never built | Users can't move wallet ↔ savings | Build simple transfer UI with balance display |
| Media Center | ❌ Never built | Users can't vote on POTW/GOTW | Build nomination/voting system, historical archive |
| Help / Rules | ❌ Never built | Users can't access rules | Display league rules (already stored in DB) |

**User Menu Fix Effort:** ~40-50 hours (major feature implementation)

---

## ADMIN PANEL GAPS & NEEDS

| Section | Item | Status | Priority | Effort |
|---------|------|--------|----------|--------|
| Import | Import History | Display-only | Medium | 2h |
| Import | Manual Data Entry | Not started | Medium | 4h |
| Advance | Edit Rules (apply changes) | Schema done, handlers needed | High | 3h |
| Economy | Pending Payouts View | Not started | High | 3h |
| Economy | POTW Review UI | Not started | Medium | 2h |
| Economy | EOS Payout Reviews | Not started | High | 4h |
| Economy | Stream Payout Reviews | Not started | Medium | 2h |
| **Next Advance** | **Schedule UI** | **Not started** | **CRITICAL** | **3h** |
| **Challenges** | **Dynamic Pool** | **Not started** | **CRITICAL** | **6h** |
| **Badges** | **Season-end assign** | **Not started** | **HIGH** | **3h** |
| **Rankings** | **Power Rankings** | **Not started** | **HIGH** | **4h** |
| **Rankings** | **Strength of Schedule** | **Not started** | **MEDIUM** | **4h** |
| **Payouts** | **EOS Payouts** | **Not started** | **CRITICAL** | **6h** |

---

## CRITICAL BOTTLENECKS & EFFICIENCY ISSUES

### 1. **API PERFORMANCE - N+1 Query Problems**

**Issue:** Several endpoints make sequential queries instead of batching.

**Locations:**
- `getMenuProfile()` - Makes 3 parallel queries (good), but could batch challenges + GOTW
- `getGotwCandidates()` - Now batches power rankings (FIXED in v61be9d6), but H2H lookup still loops
- `buildAdvanceDmPayloads()` - Makes individual queries for each user's data

**Fix Priority:** HIGH
**Estimated Impact:** 20-30% faster advance flow

**Quick Wins:**
```typescript
// BEFORE: Sequential queries in buildAdvanceDmPayloads
for (const game of games) {
  const challenges = await supabase.from("rec_weekly_challenges")
    .select("*").eq("user_id", user.id)
  // Makes N queries
}

// AFTER: Single bulk query
const allChallenges = await supabase.from("rec_weekly_challenges")
  .select("*").in("user_id", userIds)
const challengesByUser = new Map(allChallenges.map(c => [c.user_id, c]))
// Reuse for all users
```

---

### 2. **ADVANCE FLOW SEQUENCE INEFFICIENCY**

**Current Flow:**
```
applyRecords → issuePayouts → settleVotes → evaluateChalls → calcPotw 
→ issuePotw → streamCompliance → generateChalls → assignBadges → GOTW candidates
→ getGameChannelPlans → buildDmPayloads
```

**Issues:**
- `generateWeeklyChallenges` creates for new week
- `buildDmPayloads` loads those challenges again (duplicate query)
- `buildDmPayloads` also loads game channels, awards, etc. (multiple individual lookups)

**Fix:** Pre-load all data once, pass through pipeline

---

### 3. **DISCORD INTERACTION LATENCY**

**Issue:** Advance flow can take 30-60 seconds for large leagues (50+ users)

**Current Bottlenecks:**
- Supabase query latency (fixed by batching)
- Discord API rate limits on DM sending (sequential, not parallel)
- Game channel creation (sequential Discord API calls)

**Fix:**
- Batch Discord API calls where possible
- Use Promise.all() for parallel DMs
- Pre-allocate game channel IDs before creation

---

### 4. **RULES EDITING - INCOMPLETE**

**Issue:** Rules are fetched and displayed, but editing has no handler

**Need:**
- Update endpoint exists (line 249 in setup.service.ts)
- UI has selectors (league-setup.ts)
- But no handler in index.ts to route rule updates

---

### 5. **ECONOMY REVIEWS - NO UI VISIBILITY**

**Current State:**
- `buildEconomyAdminPanel()` exists but has limited functionality
- No views for:
  - Pending payouts (what's queued?)
  - POTW review (which awards were issued?)
  - EOS batch status (what stage is it in?)
  - Stream payouts (what's awaiting review?)

---

## PRIORITY IMPLEMENTATION ROADMAP

### **PHASE A: CRITICAL (Foundation)**
1. **Next Advance Scheduling UI** (3h) - Button → 7-day picker → Hour selector → Timezone
2. **Strength of Schedule** (4h) - Reuse GOTW scoring, cache for power rankings
3. **Power Rankings** (4h) - Calculated from season records, cached, displayed
4. **End-of-Season Payouts** (6h) - Triggered at superbowl→offseason, uses power rankings

### **PHASE B: HIGH (Quality)**
5. **Dynamic Challenges Pool** (6h) - Opponent-based, player-specific, import-verified
6. **Season-End Badge Assignment** (3h) - Auto-trigger at stage change
7. **Economy Reviews UI** (6h) - Pending payouts, POTW, EOS, streams visibility

### **PHASE C: MEDIUM (Usability)**
8. **User Menu Implementation** (40-50h) - Rosters, standings, bank, media, rules, help
9. **API Performance Optimization** (8-10h) - Batch queries, eliminate N+1
10. **Advance Flow Optimization** (4-6h) - Pre-load, parallel execution

---

## BADGE SYSTEM - COMPLETE DEFINITION

### Weekly Badges (Auto-assign each advance)
- **Hot Streak**: 3+ consecutive wins (Gold)
- **Unstoppable**: 500+ points in a week (Gold)
- **Defensive Wall**: Opponent <10 points (Silver)
- **Grind**: Won by ≤7 points (Bronze)
- **Shutout King**: Opponent 0 points (Platinum)
- **Challenge Master**: All 3 challenge tiers (Gold)
- **Perfect Week**: Win + all 3 tiers (Platinum)

### Season-End Badges (Auto-assign at stage transition)
- **🏆 Champion**: 1st place final standings (Platinum)
- **🥈 Runner-Up**: Made SB finals (Gold)
- **Finals Appearance**: Made playoff finals (Gold)
- **Playoff Clinch**: Made playoffs (Silver)
- **Scoring Machine**: Most points season (Gold)
- **Fort Knox**: Lowest points allowed (Gold)
- **Comeback King**: Won final game after 3+ loss streak (Silver)
- **Iron Man**: Played all games (Bronze)

### Additional Badges to Consider
- **MVP**: Best W-L record (Platinum)
- **Clutch King**: Most wins in close games (Gold)
- **Consistency**: Lowest variance (Silver)
- **Rising Star**: Biggest mid/late season improvement (Gold)
- **Defensive Ace**: Best avg opponent score (Silver)

---

## CRITICAL NEXT STEPS

### Immediate (Next 2-4 hours):
1. ✅ GOTW voting global (DONE)
2. ⏳ Next Advance Scheduling UI
3. ⏳ Strength of Schedule calculation
4. ⏳ Power Rankings display

### Short-term (Next 4-8 hours):
5. ⏳ End-of-Season Payouts system
6. ⏳ Dynamic Challenges Pool
7. ⏳ Season-End Badge Assignment

### Medium-term (After launch verification):
8. ⏳ Economy Reviews UI
9. ⏳ API Performance Optimization
10. ⏳ User Menu Implementation

---

## RECOMMENDATION

**Focus first on PHASE A (next 15 hours)** - these are launch-critical and enable the bot to complete full season cycles properly. Then tackle PHASE B (economy/badge visibility) before user-facing features in PHASE C.

Current estimate: **35-40 hours** to complete all critical and high-priority items.

Given deadline context, suggest: **PHASE A + Season-End Badge Assignment = 13 hours** for complete season automation, then test before considering PHASE C user features.
