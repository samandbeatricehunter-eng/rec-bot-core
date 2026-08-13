# LEAGUE SETUP WORKFLOW - CRITICAL FIXES

**Date:** 2026-06-09  
**Issue:** League setup workflow had missing prompts and logic bugs  
**Status:** ✅ FIXED | Typecheck: PASSING

---

## ISSUES FIXED

### ❌ Issue 1: Play Call Cooldown Prompts Missing
**Problem:** Users were never asked for offensive/defensive cooldown values
**Root Cause:** Buggy conditional logic in `getNextLeagueSetupStep()` was skipping cooldown steps if limits were disabled
**Before:** `if (step === "offensive_limits_enabled" && !draft.offensivePlayCallLimitsEnabled) return "defensive_limits_enabled";`
**After:** Removed skip logic; always ask for cooldown values (they can be defaults if limits are off)
**Result:** ✅ Offensive cooldown and defensive cooldown prompts now always appear

### ❌ Issue 2: Role Assignment Not in League Setup
**Problem:** No prompts for commissioner role or committee role during league setup
**Root Cause:** Steps never added to setup workflow
**Fix:** Added two new steps:
  - `commissioner_role` - Select or create commissioner role
  - `committee_role` - Select or create competitive committee role
**Stored:** In `draft.commissionerRoleId` and `draft.compCommitteeRoleId`
**Result:** ✅ Role assignment now part of league setup

### ❌ Issue 3: Only One 4th Down Policy (should have separate regular/playoff)
**Problem:** Single "fourth_down" step applied to both regular season and playoff
**Root Cause:** Only one `fourthDownRuleType` field instead of separate settings
**Fix:** Split into two rules:
  - `fourthDownRuleTypeRegular` - for weeks 1-17
  - `fourthDownRuleTypePlayoff` - for weeks 18-21
**New Steps:**
  - `fourth_down_regular` - Set regular season 4th down rules
  - `fourth_down_playoff` - Set playoff 4th down rules
**Result:** ✅ Different 4th down policies can be configured for each season phase

---

## IMPLEMENTATION DETAILS

### Files Changed
- `apps/bot/src/ui/league-setup.ts` (92 lines added/modified)
- `apps/bot/src/index.ts` (handler updated)
- `apps/bot/src/index-timeout.ts` (handler updated)

### New Steps in Setup Order
League setup now prompts in this order (all new prompts included):

1. League Type
2. Import Mode
3. Feature Toggles
4. Draft Class Type
5. Regular Season Streaming
6. Postseason Streaming
7. Streaming Side
8. **4th Down Rules - Regular Season** ← NEW
9. **4th Down Rules - Playoff** ← NEW
10. Position Changes
11. Trade Approval
12. CPU Rules
13. Difficulty
14. Quarter Length
15. Accelerated Clock - Enabled
16. Accelerated Clock - Seconds
17. Salary Cap
18. Trade Deadline
19. Abilities
20. Wear & Tear
21. Injury Policy
22. Offensive Limits - Enabled
23. Offensive Play Call Limit
24. **Offensive Play Call Cooldown** ← NOW ALWAYS SHOWN (was skipped)
25. Defensive Limits - Enabled
26. Defensive Play Call Limit
27. **Defensive Play Call Cooldown** ← NOW ALWAYS SHOWN (was skipped)
28. **Commissioner Role** ← NEW
29. **Competitive Committee Role** ← NEW
30. Review & Save

### Type Updates
```typescript
// Before:
fourthDownRuleType: "none" | "standard_rec" | "custom"

// After:
fourthDownRuleTypeRegular: "none" | "standard_rec" | "custom"
fourthDownRuleTypePlayoff: "none" | "standard_rec" | "custom"

// New fields:
commissionerRoleId?: string | null
compCommitteeRoleId?: string | null
```

---

## REMAINING ISSUES

### ⚠️ Issue: Team/User Linking Not Tested
**Status:** Not yet verified in workflow  
**Current Implementation:** Separate button from league setup
**Action:** Test the team linking workflow to verify it works end-to-end

**Expected Flow:**
1. League Setup completed
2. Go to Admin Panel > User / Team Linking
3. Select "Link Users to Teams"
4. Assign users to team roles
5. Verify display shows linked teams

**Needs Testing:** Does the linking button appear? Does it work? Does it persist?

---

## VERIFICATION CHECKLIST

Before considering league setup complete:
- [ ] League setup wizard runs through all steps
- [ ] Offensive cooldown prompt appears (step 24)
- [ ] Defensive cooldown prompt appears (step 27)
- [ ] Commissioner role prompt appears (step 28)
- [ ] Committee role prompt appears (step 29)
- [ ] 4th down rules show separate regular season and playoff options
- [ ] Review window shows both 4th down rules correctly
- [ ] League saves with all values stored correctly
- [ ] Test team/user linking workflow separately

---

## CODE QUALITY

**Typecheck:** ✅ All passing (packages/shared, apps/bot, apps/api)
**Comments:** Added JSDoc to `buildFourthDownWindow()` and `buildRoleWindow()` explaining their purpose
**No Bloat:** Minimal additions, only what was necessary for fixes

---

## NEXT STEPS

1. Test league setup in server with these changes
2. Verify team/user linking works separately (if not, file separate ticket)
3. If role selection needs Discord role select menu UI, that will require additional work
4. If team linking needs UI refinement, file separate ticket

---

## COMMIT HASH

`c24a5ee` - "Fix league setup workflow: add cooldown prompts, role assignment, separate playoff 4th down policy"
