# EA Madden CFM Import — Field Dictionary

Reference for the raw EA `careermode_get` export fields captured during import (see the
raw-field capture in `apps/api/src/modules/imports/raw-field-dictionary.service.ts` and the
live `/v1/imports/raw-field-dictionary` route). Every import stores the full raw payload in
`raw_payload`; the import commit additionally merges canonical REC stat keys via
`normalizeImportedStats`. Semantics below were validated against committed league data
(2026-06-12).

Each endpoint wraps its data array in an envelope: `success` (bool), `message` (string).

---

## Endpoints → fields

### CareerMode_GetLeagueTeams → `leagueTeamInfoList[]`
`teamId, cityName, nickName/displayName, abbrName, divName, ovrRating, offScheme, defScheme,
logoId, primaryColor, secondaryColor, injuryCount, userName` (userName present = human-controlled).

### CareerMode_GetStandings → `teamStandingInfoList[]`
- **Record:** `rank, prevRank` (power-ranking inputs — rise in standings shifts power ranking),
  `seed, playoffStatus`, `winLossStreak` (current streak incl. CPU games), `winPct`,
  `totalWins/Losses/Ties`, `homeWins/…`, `awayWins/…`, `divWins/…` (vs the 3 division rivals),
  `confWins/…` (vs conference).
- **Scoring/yards:** `ptsFor, ptsAgainst, netPts` (point differential — see caveat below),
  `ptsForRank, ptsAgainstRank, tODiff`, `offPassYds/offRushYds/offTotalYds`,
  `defPassYds/defRushYds/defTotalYds`, + `…Rank` for each.
- **Cap:** `capRoom, capSpent, capAvailable` (identity holds: `capRoom − capSpent = capAvailable`).
- **Identity:** `teamId, teamName, teamOvr, conferenceId/Name, divisionId/Name, seasonIndex,
  stageIndex, weekIndex, calendarYear`.

> ⚠️ `netPts` does **not** equal `ptsFor − ptsAgainst` in the standings export (verified: 3/320),
> and `ptsFor`/`ptsAgainst` look anomalously small. Use `netPts` directly; pull real scoring from
> weekly `team_stats` (`offPtsPerGame` / game scores), not standings `ptsFor`/`ptsAgainst`.

### CareerMode_GetSchedule → `gameScheduleInfoList[]`
`scheduleId, seasonIndex, stageIndex, weekIndex, homeTeamId, awayTeamId, homeScore, awayScore,
status` (2 = played), `isGameOfTheWeek` (GOTW boost — only apply when the flagged game is a user H2H).

### Weekly team stats → `teamStatInfoList[]`
Offense: `off1stDowns, off2PtAtt/Conv/ConvPct, off3rd/4thDownAtt/Conv/ConvPct,
offRedZones/RedZoneTDs/RedZoneFGs/RedZonePct, offPassYds/offPassTDs, offRushYds/offRushTDs,
offSacks` (sacks allowed), `offTotalYds/offTotalYdsGained, offPtsPerGame, offIntsLost, offFumLost`.
Defense: `defPassYds/defRushYds/defTotalYds, defSacks, defIntsRec, defFumRec, defForcedFum`
(≥ defFumRec), `defPtsPerGame, defRedZones/RedZoneTDs/RedZoneFGs/RedZonePct`.
Other: `penalties, penaltyYds, tODiff, tOGiveaways, tOTakeaways, totalWins/Losses/Ties, seed`.

### Weekly player stats — by category (identity on every row: `rosterId, teamId, statId, scheduleId, fullName, seasonIndex, stageIndex, weekIndex`)
- **Passing** `playerPassingStatInfoList[]`: `passAtt, passComp, passCompPct, passYds, passTDs, passInts, passSacks, passLongest, passerRating, passYdsPerAtt, passYdsPerGame, passPts`
- **Rushing** `playerRushingStatInfoList[]`: `rushAtt, rushYds, rushTDs, rushLongest, rushYdsPerAtt, rushYdsPerGame, rushBrokenTackles, rushYdsAfterContact, rush20PlusYds, rushFum, rushToPct, rushPts`
- **Receiving** `playerReceivingStatInfoList[]`: `recCatches, recYds, recTDs, recLongest, recYdsPerCatch, recYdsPerGame, recYacPerCatch, recYdsAfterCatch, recCatchPct, recDrops, recToPct, recPts`
- **Defense** `playerDefensiveStatInfoList[]`: `defTotalTackles, defSacks, defInts, defIntReturnYds, defDeflections, defForcedFum, defFumRec, defTDs, defSafeties, defCatchAllowed, defPts`
- **Kicking** `playerKickingStatInfoList[]`: `fGAtt, fGMade, fGCompPct, fGLongest, fG50PlusAtt, fG50PlusMade, xPAtt, xPMade, xPCompPct, kickoffAtt, kickoffTBs, kickPts`
- **Punting** `playerPuntingStatInfoList[]`: `puntAtt, puntYds, puntNetYds, puntYdsPerAtt, puntNetYdsPerAtt, puntLongest, puntsIn20, puntTBs, puntsBlocked`

### CareerMode_GetTeamRoster → `rosterInfoList[]` (156 fields) / CareerMode_GetFreeAgents (136, same schema)
- **Bio:** `firstName, lastName, position, jerseyNum, age, height, weight, college, homeTown,
  homeState, birthDay/Month/Year, rookieYear, yearsPro, rosterId, teamId, portraitId, presentationId, runStyle`
- **Overalls/grades:** `playerBestOvr` (true best), `playerSchemeOvr` (in ideal scheme),
  `teamSchemeOvr` (this player's OVR under the team's current scheme — varies per player),
  `intangibleGrade, physicalGrade, productionGrade, sizeGrade, durabilityGrade, legacyScore,
  experiencePoints, skillPoints, devTrait, reSignStatus`
- **Contract/cap:** `capHit, capReleaseNetSavings, capReleasePenalty, contractBonus, contractSalary,
  contractLength, contractYearsLeft, desiredBonus/Length/Salary, draftRound, draftPick`
  (note: `capHit − capReleasePenalty = capReleaseNetSavings` holds only ~48% — not an identity;
  use EA's `capReleaseNetSavings` directly).
- **Status:** `isActive, isFreeAgent, isOnIR, isOnPracticeSquad, injuryRating, injuryType, injuryLength`
- **Ratings:** full Madden attribute set — athletic (`speedRating, accelRating, agilityRating,
  strengthRating, jumpRating, staminaRating, toughRating, changeOfDirectionRating, awareRating`),
  ball-carrier, receiving, passing, blocking, defense, kicking groups (see live dictionary for all).
- **Abilities:** `signatureSlotList[]` → `locked, isEmpty, ovrThreshold` (OVR slot unlocks at),
  nested `signatureAbility{ rank, signatureTitle, signatureDescription, signatureLogoId, isPassive,
  isUnlocked }`. X-Factor is distinguishable from Superstar abilities: only the X-Factor has
  populated `signatureActivationDescription` / `signatureDeactivationDescription`. The fields
  `abilityGUID, activationId, deactivationId, marketplaceAbilityAlias, unlockRequirement,
  startActivated, activationEnabled, deactivationEnabled` are MUT/marketplace fields and are
  **blank in franchise export** — ignore.
- `rosterGoalList[]` — **always empty** in export.

---

## Decoded enums

### devTrait
`0 = Normal · 1 = Star · 2 = Superstar · 3 = X-Factor` (verified by league distribution: 3703/1135/282/117).

### Schemes (single shared enum split by side)
`offScheme` uses **0–10** (11 offensive schemes); `defScheme` uses **11–20** (10 defensive). The
player-level `scheme` field uses the same combined enum and is the player's best-fit scheme.
Integer→name order is **not** published publicly (names below are alphabetical, not enum order) —
anchor empirically from known in-game team schemes.

- **Offensive (0–10):** Air Raid · Multiple Power Run · Multiple Zone Run · Pistol · Run And Shoot ·
  Spread · Vertical Power Run · Vertical Zone Run · West Coast Power Run · West Coast Spread · West Coast Zone Run
- **Defensive (11–20):** 3-4 Storm · 3-4 Under · 4-3 Cover 3 · 4-3 Quarters · 4-3 Under · 46 Defense ·
  Base 3-4 · Base 4-3 · Disguise 3-4 · Tampa 2

### reSignStatus (contract/re-sign eligibility, NOT a boolean)
`24 = default` (under contract w/ years left, or a free agent) · `1 / 2 = final contract year, due to
re-sign` (2 is common) · `22 = extension-eligible (≈2 yrs left)`. Rule of thumb: `reSignStatus IN (1,2)`
≈ "must be re-signed this offseason or hits free agency."

---

## Dead / unused fields (don't map)
- The ~23 `*Trait` fields on rosters (`bigHitTrait, clutchTrait, …, yACCatchTrait`) are **0 for the
  entire league** — not populated by the Madden 26 export.
- `rosterGoalList[]` — always empty.
- signatureAbility marketplace/activation fields (see Abilities above) — blank in franchise.

## Validated integrity identities
- ✅ `capRoom − capSpent = capAvailable` (standings) — 320/320.
- ❌ `netPts = ptsFor − ptsAgainst` (standings) — only 3/320; use `netPts` directly.
- ❌ `capHit − capReleasePenalty = capReleaseNetSavings` (roster) — only ~48%; use EA value directly.

## Storage note
Stored stat rows historically carry only raw EA keys; `readStat()` resolves raw→canonical aliases at
read time. The canonical stat module (`@rec/shared`) is the single source of truth — never read raw
EA keys directly in new code; use `readStat`/`canonicalKey`.
