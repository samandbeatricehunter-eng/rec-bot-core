# XP / Competitive Balance / Universal Record Book Amendments

## 1. Competitive Balance Development — locked cap

REC should provide a small development catch-up mechanism for genuinely weaker user franchises without making losing strategically desirable.

### Eligibility bands
Use a frozen Competitive Strength Index based only on canonical league data:
- record / winning percentage
- point differential
- strength of schedule
- power-ranking context
- roster strength
- recent performance

Do not use record alone.

### Bonus
- Bottom 25% of eligible user franchises: +20% to qualifying earned Franchise Progress Points
- 25th–40th percentile: +10%
- Top 60%: no bonus

### Qualifying FPP sources
Apply only to developmental participation:
- weekly challenge FPP
- defended Media Day commitment FPP

Do not multiply:
- wins
- playoffs
- championships
- upset awards
- annual awards
- Player XP
- XP conversions

### Seasonal catch-up cap
**Maximum competitive-balance bonus: 18,000 FPP = 3.00 Franchise XP per user per season.**

This is the hard cap.

Recalculate band every four advances. Freeze each period's band before games are played.

The bonus follows the user, because Franchise progression belongs to the user within that league.

---

## 2. Universal Record Book

Generalize the existing RTI NFL baseline record-book system so both RTI and non-RTI Madden leagues use the same baseline Top 5 datasets and the same evaluation engine.

Scopes:
- single game
- single season
- career

The starting Top 5 is the NFL baseline. REC performances can replace entries.

### Entry rules
- New performance must be strictly greater than current #5 to enter.
- Ties do not displace an existing entry.
- A true record break requires strictly greater than current #1.
- Final Top 5 is sorted descending and retains only five entries.

### Season 1 migration
For existing M27 OG REC:
1. seed NFL baseline;
2. replay completed Season 1 canonical imports chronologically;
3. merge qualifying REC performances;
4. persist final Top 5;
5. mark historical season/week/team/game;
6. rebuild site cache;
7. edit Discord record-board messages;
8. post one migration-summary announcement rather than retroactively spamming every historical break.

Future live record events update immediately.

---

## 3. Media behavior for Record Book

**Every REC entry into the Top 5 must generate a Media event.**

Rank #2–#5:
- update DB
- update site cache
- update Discord board
- create guaranteed `record_watch` / record-book Media event
- queue at least one contextual media/social reaction

Rank #1:
- all above
- dedicated Discord record-break announcement
- stronger Media importance
- record-break Player XP / Franchise recognition rules where applicable

Media mention is not optional.

---

## 4. Site cache

Add a site-facing Record Book cache.

Recommended cache key:
`league_id + scope`

Payload includes all categories / Top 5 entries for that scope.

On affected record change:
- update authoritative DB rows
- rebuild only affected cache scope/category
- update Discord tracked messages
- invalidate/revalidate Record Book site query

Do not recalculate historical leaders on every page request.

---

## 5. Remove legacy box-score dependencies

REC's canonical statistical source is the import pipeline.

Anything in code, comments, tests, services, docs, or UI that treats legacy/manual "box scores" as the authoritative source is targeted for deletion or migration.

Record evaluation, Player XP evaluation, awards, Media, challenges, standings/statistics, and all derived systems must consume canonical imported data/read models.

Current stale language in the RTI record service stating that solo tackles has no distinct "box-score" field must be removed.

### Tackles
The current imported player-stat payload contains `tackles`.

It does not currently expose a separate `tackles_solo` key in stored weekly imports.

Therefore:
- remove `tackles_combined` from all record scopes, types, labels, baseline arrays, DB seeds, UI, Discord, Media, tests;
- do not continue a fake distinction between combined and solo based on legacy box-score assumptions;
- create a single active REC record category backed by the canonical imported `tackles` field **only after its EA semantic meaning is confirmed**;
- until confirmed, do not label imported `tackles` as "Solo Tackles".

The important implementation rule is: record categories must map to what the import actually means, not old box-score terminology.

---

## 6. Season 1 clarification

### Single-season interceptions
The best user performances were:
- Deion Sanders — 11
- Ted Hendricks — 11

The NFL baseline Top 5 is:
1. 14
2. 13
3. 13
4. 13
5. 12

So **11 does not enter the Top 5**.

### Single-season sacks
Season 1 high:
- Myles Garrett — 20.5

NFL fifth-place baseline:
- 22

So 20.5 does not enter the final Top 5.

### Single-season receptions
Season 1 high:
- Michael Pittman — 110

NFL fifth-place baseline:
- 136

So 110 does not enter.

### Single-game sacks
This is different:
- Will McDonald IV — 11 sacks

NFL baseline #1:
- Derrick Thomas — 7

So **11 absolutely breaks the single-game sack record and becomes #1**.

---

## 7. Known Season 1 Top-5 replacements

Season 1 historical migration should honor at minimum the already-verified categories:

### Single game
- Passing TD: Cam Newton 15, Joe Milton 11
- Passing yards: Cam Newton 1027; Joe Milton 844; Cam Newton 566; Joe Milton 562; Cam Newton 556
- Receptions: Dont'e Thornton Jr 24
- Receiving yards: Dont'e Thornton Jr 896; Calvin Johnson 420; Chase Hunter 377; Calvin Johnson 376
- Receiving TD: Dont'e Thornton Jr 13; Calvin Johnson 6
- Rushing yards: OJ Simpson 389, 358, 351, 332; Herschel Walker 342
- Rushing TD: Herschel Walker 6; OJ Simpson 6 enter the merged board under the strict #5 displacement rule
- Sacks: Will McDonald IV 11; Odafe Oweh 7.5

### Single season
- Passing TD: Joe Milton 67; C.J. Stroud 59; Cam Newton 58
- Passing yards: Joe Milton 6227; Cam Newton 6010; Dak Prescott 5603
- Receiving TD: Calvin Johnson 36; Rob Gronkowski 22 enters merged Top 5 under tie ordering rules
- Receiving yards: Calvin Johnson 2845
- Rushing TD: Tyjae Spears 29
- Rushing yards: Tyjae Spears 2455

Career baseline remains unchanged after one season.

---

## 8. Rivalries status

The code audit showing no `Rivalry Heat` implementation means the planned rivalry/Player-beef challenge targeting remains an implementation-phase item, not a production feature.

Do not mark rivalry-driven XP/challenge behavior as implemented until:
- rivalry persistence exists
- rivalry heat/state exists
- player-beef social linkage exists
- challenge-targeting consumer exists
- tests exist

The XP plan can depend on these future signals, but production must feature-gate them until Phase 7 is complete.
