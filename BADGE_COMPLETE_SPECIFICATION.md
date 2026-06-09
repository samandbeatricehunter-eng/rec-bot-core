# COMPLETE BADGE SPECIFICATION

**Total Badges: 19** | **All season-long cumulative** | **No tiers**

---

## 1. REGULAR-SEASON WIN RECORDS (3 badges)
*Assigned at regular_season→playoffs transition (end of Week 17)*

### Undefeated
- **Threshold:** 17-0 record in regular season
- **How Earned:** Win all 17 games with 0 losses
- **League Impact:** Rare; perfect season
- **Notes:** Only possible badge; regular season is exactly 17 games

### Dominant
- **Threshold:** 80%+ win rate (14+ wins in 17 games)
- **How Earned:** Win at least 14 of 17 games
- **Combinations:** 14-3, 15-2, 16-1, 17-0
- **Notes:** Much more common than Undefeated

### Winning Season
- **Threshold:** More wins than losses
- **How Earned:** Win at least 9 games (breakeven = 9-8)
- **Combinations:** 9-8, 10-7, 11-6, ... 17-0
- **Notes:** Base-level achievement; most common badge


---

## 2. OFFENSIVE EXCELLENCE (3 badges)
*Assigned at season end based on cumulative season statistics*

### Scoring Leader
- **Threshold:** Most total points scored in season (league-wide)
- **How Earned:** Highest PPF (points for) across entire league
- **Metric:** Sum of all scores across 17 games
- **Rarity:** 1 per league per season
- **Example:** 1,547 total points vs 1,423 next highest
- **Notes:** League-wide winner; dynamic if records later broken

### High Octane
- **Threshold:** 40+ points per game average
- **How Earned:** PPG = total_points ÷ 17 ≥ 40
- **Calculation:** 680+ total points minimum (40 × 17)
- **Rarity:** 5-10 per season typically
- **Example:** 1,700 points ÷ 17 games = 100 PPG
- **Notes:** Scoring consistency indicator; more common than Scoring Leader

### Blowout Master
- **Threshold:** 50%+ of wins by 21+ point margin
- **How Earned:** Half or more of wins are dominant victories (21+ point spreads)
- **Requirements:** Minimum 8 wins (50% of 16 minimum)
- **Calculation:** Count wins with margin ≥ 21, then ÷ total_wins ≥ 0.50
- **Example:** 14 wins, 8 by 21+ points = 57% → earns badge
- **Rarity:** 3-5 per season
- **Notes:** Indicates dominance, not just scoring volume


---

## 3. DEFENSIVE EXCELLENCE (2 badges)
*Assigned at season end based on cumulative season statistics*

### Defensive Powerhouse
- **Threshold:** Fewest total points allowed in season (league-wide)
- **How Earned:** Lowest PPA (points against) across entire league
- **Metric:** Sum of all opponent scores across 17 games
- **Rarity:** 1 per league per season
- **Example:** 1,123 PA vs 1,245 next best
- **Notes:** Opposite of Scoring Leader; league-wide winner

### Shutout King
- **Threshold:** 3+ games where opponent scored 0 points
- **How Earned:** Win 3 or more shutout games (opponent = 0 points)
- **Rarity:** 3-8 per season (varies wildly)
- **Notes:** Defensive dominance indicator; shutouts are rare in Madden


---

## 4. HEAD-TO-HEAD EXCELLENCE (2 badges)
*Assigned at season end based on GLOBAL H2H records (not league-specific)*

### H2H Dominator
- **Threshold:** 0 losses in H2H matchups (undefeated vs players)
- **Requirements:** Minimum 8 H2H games played (sample size threshold)
- **How Earned:** Win all H2H matchups (ties are OK, losses are not)
- **Example:** 8-0-2 H2H record = Dominated
- **Rarity:** 1-3 per season (very rare)
- **Notes:** Global record aggregates across all seasons and leagues

### H2H Specialist
- **Threshold:** 85%+ win rate in H2H matchups
- **Requirements:** Minimum 8 H2H games played
- **Calculation:** h2h_wins ÷ (h2h_wins + h2h_losses) ≥ 0.85
- **Example:** 12-2 H2H = 86% → earns badge
- **Rarity:** 3-8 per season
- **Notes:** Competitive player indicator; shows player matchup skill


---

## 5. CLUTCH PERFORMANCE (1 badge)
*Assigned at season end based on game-by-game margin analysis*

### Closer
- **Threshold:** 50%+ of wins by ≤7 point margin
- **Requirements:** Minimum 10 wins (prevents low sample-size bias)
- **How Earned:** Win half or more of games by close margins (≤7 points)
- **Calculation:** Count wins with margin ≤ 7, then ÷ total_wins ≥ 0.50
- **Example:** 12 wins, 7 by 7 or less = 58% → earns badge
- **Rarity:** 5-10 per season
- **Notes:** Indicates clutch player; wins tight games


---

## 6. PLAYOFF CHAMPIONSHIP (3 badges)
*Assigned at super_bowl→offseason transition (end of Week 21)*

### 🏆 Super Bowl Champion
- **Threshold:** Winner of Super Bowl game
- **How Earned:** Defeat opponent in Week 21 final game
- **Rarity:** 1 per league per season
- **Notes:** Ultimate achievement; highest honor

### 🥈 Super Bowl Runner-Up
- **Threshold:** Loser of Super Bowl game
- **How Earned:** Reach Super Bowl but lose in Week 21
- **Rarity:** 1 per league per season
- **Notes:** Second-place achievement; still significant

### Playoff Qualifier
- **Threshold:** Finish in top 8 standings
- **How Earned:** End regular season ranked 1-8 in league
- **Rarity:** 8 per league per season
- **Notes:** Made-the-playoffs badge


---

## 7. MID-SEASON RESILIENCE (1 badge)
*Assigned dynamically per advance when triggered; removed at season end*

### Comeback Artist
- **Threshold:** Win after 3+ consecutive losses
- **When Earned:** First time user wins following a 3+ game losing streak
- **Frequency:** Once per season maximum (badge removed at season end)
- **Example:** User loses games W1, W2, W3, then wins W4 → badge earned
- **Rarity:** 5-15 per season (varies with skill distribution)
- **Notes:** Removed at season end; doesn't carry to next season


---

## 8. DYNAMIC RECORD TRACKING (variable)
*Assigned per advance; managed throughout season; converted at season end*

### Record Breaker - [Stat Name]
- **Threshold:** Break existing league record for any tracked stat
- **When Earned:** Dynamically, any advance where stat exceeds current record
- **Types Tracked:**
  - Points Scored (highest total)
  - Points Allowed (lowest total)
  - Wins (most in season)
- **Behavior:**
  - Previous Record Breaker badge removed when new record set
  - Current badge holder shown on leaderboards
  - Converted to Record Holder badge at season end
- **Example:** User reaches 1,701 points, beating previous record of 1,623
- **Rarity:** 1-5 per season per record type
- **Notes:** Temporary badge; replaced at season end

### Record Holder - [Stat Name]
- **Threshold:** Held league record through entire season (Weeks 1-17)
- **When Earned:** Season end (super_bowl→offseason) if still holding record
- **Conversion:** Record Breaker → Record Holder at season end
- **Behavior:**
  - Persists into next season as legacy achievement
  - Removed if new record set in next season
- **Rarity:** 1-5 per season per record type
- **Notes:** Permanent-looking; actually lasts until next season


---

## BADGE ASSIGNMENT SUMMARY TABLE

| Badge Name | Category | Trigger | Threshold | Timing | Rarity |
|-----------|----------|---------|-----------|--------|--------|
| Undefeated | Wins | Perfect season | 17-0 | Week 17→18 | 1/season |
| Dominant | Wins | Elite wins | 80%+ (14+ wins) | Week 17→18 | Very rare |
| Winning Season | Wins | Positive record | Wins > Losses | Week 17→18 | Common |
| Scoring Leader | Offense | Most points | Highest PF | Week 17→18 | 1/league |
| High Octane | Offense | Avg 40 PPG | 40+ PPG | Week 17→18 | 5-10 |
| Blowout Master | Offense | Dominant wins | 50%+ by 21+ | Week 17→18 | 3-5 |
| Defensive Powerhouse | Defense | Fewest PA | Lowest PA | Week 17→18 | 1/league |
| Shutout King | Defense | Multiple shutouts | 3+ shutouts | Week 17→18 | 3-8 |
| H2H Dominator | H2H | Undefeated H2H | 0 losses (8+) | Week 17→18 | 1-3 |
| H2H Specialist | H2H | Best H2H record | 85%+ (8+) | Week 17→18 | 3-8 |
| Closer | Clutch | Wins by 7 | 50%+ (10+) | Week 17→18 | 5-10 |
| Super Bowl Champion | Playoff | SB win | Week 21 winner | Week 21→off | 1/league |
| Super Bowl Runner-Up | Playoff | SB loss | Week 21 loser | Week 21→off | 1/league |
| Playoff Qualifier | Playoff | Top 8 | Ranked 1-8 | Week 21→off | 8/league |
| Comeback Artist | Resilience | Break streak | Win after 3L | Per advance | 5-15 |
| Record Breaker - * | Records | Break record | Stat exceeds | Per advance | 1-5 each |
| Record Holder - * | Records | Held record | Held through S17 | Week 21→off | 1-5 each |

---

## BADGE LIFECYCLE DIAGRAM

```
SEASON START (Week 1)
    ↓
PER-ADVANCE BADGES:
  • Comeback Artist (if triggered)
  • Record Breaker (if any stat exceeds record)
    ↓
REGULAR SEASON END (Week 17 → 18 transition)
  • Assign all season-end badges (Undefeated, Dominant, etc.)
  • Track Record Breaker badges
    ↓
PLAYOFFS (Weeks 18-21)
  • Record Breaker badges update as records potentially broken
    ↓
SEASON END (Week 21 → Offseason transition)
  • Assign Championship badges (SB Champion, Runner-Up, Playoff Qualifier)
  • Convert Record Breaker → Record Holder
  • Clear Comeback Artist badges (won't carry to next season)
  • Clear all other regular-season badges
    ↓
NEXT SEASON START
  • Record Holder badges persist (shown as legacy)
  • All other badges cleared
  • New Record Breaker tracking begins
  • New Comeback Artist opportunities open
```

---

## BADGE EARNING MOMENTS

**Typical User Journey:**
1. Week 17 ends → Evaluate for Undefeated/Dominant/Winning Season + all others
2. If user broke record at any point → Has Record Breaker badge
3. User loses 3 games then wins → Gets Comeback Artist (if not already earned)
4. Week 21 → If in top 8, gets Playoff Qualifier
5. Week 21 → If won SB, gets Champion; if lost, gets Runner-Up
6. Week 21 → If held a record, Record Breaker → Record Holder conversion

**Badges Possible Per User Per Season:**
- Minimum: 0 (if lost all games)
- Maximum: 8-12 (perfect season holder of 2-3 records + SB champion)
- Typical winning player: 3-5 badges
- Typical losing player: 0-1 badges
