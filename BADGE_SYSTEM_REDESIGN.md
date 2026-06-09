# BADGE SYSTEM - FINAL DESIGN (Madden 2026)

## CORE PRINCIPLES
- **Season-long cumulative performance** - Not single-game achievements
- **No tiers** - Simple, clear badge names
- **Dynamic record tracking** - Records held/broken across all leagues
- **Season-end transitions** - Record Breaker → Record Holder at season conclusion
- **Auto-managed lifecycle** - Badges auto-assigned, auto-removed per season

---

## PLAYOFF STRUCTURE BADGES
*(Auto-assigned at season end when advancing from Super Bowl → Wildcard/Offseason)*

### Championship
- **🏆 Super Bowl Champion** - Won the Super Bowl
  - Threshold: Recorded as sb_winner in rec_league_season_results
  
- **🥈 Super Bowl Runner-Up** - Lost the Super Bowl
  - Threshold: Recorded as sb_loser in rec_league_season_results

### Playoff
- **Playoff Qualifier** - Made the playoffs
  - Threshold: Ranked in top 8 at end of regular season

---

## REGULAR SEASON PERFORMANCE BADGES
*(Auto-assigned at regular season end - Week 17)*

### Win Record
- **Undefeated** - Perfect 17-0 regular season
  - Threshold: 17 wins, 0 losses in weeks 1-17
  - Recognition: Pristine record

- **Dominant** - Elite win percentage
  - Threshold: 80%+ win rate (14+ wins in 17 games)
  - Recognition: Overwhelming success

- **Winning Season** - More wins than losses
  - Threshold: Wins > Losses
  - Recognition: Above .500

### Offensive Excellence
- **Scoring Leader** - Most points scored all season
  - Calculation: SUM(points scored) across all 17 games - HIGHEST IN LEAGUE
  - Threshold: Highest total points
  - Dynamic: Removed if another user surpasses at any advance

- **High Octane** - Consistently explosive offense
  - Threshold: 40+ points per game average across 17 games
  - Recognition: Sustained high-scoring output

- **Blowout Master** - Dominant wins
  - Threshold: 50%+ of wins by 21+ point margins
  - Requirement: 8+ wins minimum
  - Recognition: Overwhelming opponents

### Defensive Excellence  
- **Defensive Powerhouse** - Fewest points allowed all season
  - Calculation: SUM(points allowed) across all 17 games - LOWEST IN LEAGUE
  - Threshold: Lowest total points allowed
  - Dynamic: Removed if another user allows fewer at any advance

- **Shutout King** - Multiple shutout victories
  - Threshold: 3+ games where opponent scored 0 points
  - Recognition: Dominant defense

### Head-to-Head Performance
- **H2H Dominator** - Undefeated in user matchups
  - Threshold: 0 losses in H2H games (all wins/ties) + 8+ H2H games played
  - Requirement: Minimum 8 H2H matchups
  - Recognition: Never lost to another player

- **H2H Specialist** - Best H2H record
  - Threshold: 85%+ win rate in H2H matchups
  - Requirement: 8+ H2H games
  - Recognition: Superior head-to-head competitor

### Clutch Performance
- **Closer** - Wins in close games
  - Threshold: 50%+ of wins by ≤7 points
  - Requirement: 10+ wins minimum
  - Recognition: Thrives in tight contests

- **Momentum Builder** - Strong finish
  - Threshold: 5+ game winning streak during weeks 13-17
  - Recognition: Peaked when it mattered

### Strength of Schedule
- **Titan Slayer** - Beats the best
  - Threshold: 50%+ record vs top 3 teams in league
  - Recognition: Defeats elite competition

- **Giant Killer** - Beat every opponent
  - Threshold: Defeated all other league users at least once
  - Requirement: Full season participation
  - Recognition: Versatile victor

---

## COMEBACK ARTIST BADGE
*(Mid-season, can be earned once per season)*

- **Comeback Artist** - Broke a losing streak
  - Trigger: Won a game after 3+ consecutive losses
  - Assigned: Once when threshold first reached, removed at season start
  - Requirement: Must lose 3+ in a row, then win
  - Recognition: Resilience and persistence

---

## DYNAMIC RECORD TRACKING SYSTEM
*(Managed per advance across all active leagues)*

### How Record Tracking Works

**NFL/Madden Records** - Baseline for first season of any league:
- Most points scored: ~120 (NFL record reference)
- Fewest points allowed: ~20 (NFL record reference)
- Best win percentage: 1.000 (17-0)
- Highest average score: ~100 (based on Madden max)

**Record Breaker Badge**:
- Assigned when user breaks an existing league record
- Can hold multiple (one per record broken)
- Format: "Record Breaker - [Stat Name]" 
- Example: "Record Breaker - Points Scored (487 pts)"
- Reference: Shows new record and previous record holder
- Lifecycle: Persists through season → Season end
- Removal: When another user breaks the same record (previous holder loses badge)

**Record Holder Badge**:
- Assigned at season end (Week 18 → Wildcard transition)
- Only to users who held a record through entire season conclusion
- Format: "Record Holder - [Stat Name]"
- Example: "Record Holder - Defensive (212 PA)"
- Persists through playoff run and into next season
- Removed: Start of next season (season resets), or when new record is broken

### Record Types to Track
1. **Offensive Records**
   - Most points scored (season total)
   - Highest average points per game
   - Most blowout wins (21+ margin)

2. **Defensive Records**
   - Fewest points allowed (season total)
   - Lowest average points per game allowed
   - Most shutout games

3. **Competitive Records**
   - Best win percentage (minimum 17 games)
   - Best H2H record
   - Longest win streak

4. **Consistency Records**
   - Lowest score variance
   - Most games played without forfeiting

---

## SEASON-END BADGE TRANSITION FLOW

**Week 17 (Regular Season End):**
- Auto-assign all regular-season badges
- Track any Record Breaker badges if records were set

**Week 18 (Super Bowl / Wildcard Transition):**
- Determine playoff qualifiers
- Assign Playoff Qualifier badges
- Determine Super Bowl winner/loser
- Assign Championship badges
- **CRITICAL**: Convert Record Breaker → Record Holder for users who maintained records through season end
- Clear Record Breaker badges for any records that were since broken
- Clear Comeback Artist badges (removed at season start/end)
- Clear all other regular season badges (reset for new season)

**Offseason (After Wildcard):**
- Record Holder badges persist into next season (shown as legacy achievement)
- All other badges cleared
- New season tracking begins at Week 1

---

## COMPREHENSIVE BADGE MATRIX

| Badge Name | Category | Trigger | Threshold | Timing |
|------------|----------|---------|-----------|--------|
| 🏆 Super Bowl Champion | Championship | SB win | Winner | Season End |
| 🥈 Super Bowl Runner-Up | Championship | SB loss | Loser | Season End |
| Playoff Qualifier | Playoff | Top 8 | Ranked 1-8 | Season End |
| Undefeated | Record | Perfect season | 17-0 regular | Week 17 |
| Dominant | Record | Elite wins | 80%+ win rate | Week 17 |
| Winning Season | Record | Positive | Wins > Losses | Week 17 |
| Scoring Leader | Offense | Most points | Highest total | Per Advance |
| High Octane | Offense | Consistent scoring | 40+ PPG avg | Week 17 |
| Blowout Master | Offense | Dominant wins | 50%+ by 21+ | Week 17 |
| Defensive Powerhouse | Defense | Fewest PA | Lowest total | Per Advance |
| Shutout King | Defense | Shutouts | 3+ shutout games | Week 17 |
| H2H Dominator | H2H | Undefeated H2H | 0 losses, 8+ games | Week 17 |
| H2H Specialist | H2H | Best H2H | 85%+ win rate | Week 17 |
| Closer | Clutch | Close wins | 50%+ by ≤7 pts | Week 17 |
| Momentum Builder | Clutch | Strong finish | 5+ streak W13-17 | Week 17 |
| Titan Slayer | SOS | Beat top 3 | 50%+ vs elite | Week 17 |
| Giant Killer | SOS | Beat all | Defeat all users | Week 17 |
| Comeback Artist | Resilience | Break streak | Win after 3 losses | Mid-Season |
| Record Breaker - [Stat] | Records | New record | Beats league best | Per Advance |
| Record Holder - [Stat] | Records | Held through season | Maintained through Week 17 | Season End |

---

## IMPLEMENTATION REQUIREMENTS

### Database Schema Needed
```typescript
// rec_league_records table
{
  id: uuid,
  league_id: uuid,
  season_number: number,
  record_name: string,           // "Points Scored", "Points Allowed", etc.
  record_value: number,
  record_holder_id: uuid | null,
  previous_holder_id: uuid | null,
  previous_value: number | null,
  created_at: timestamp,
  updated_at: timestamp,
  season_ended_at: timestamp | null
}
```

### Functions Required
1. `assignSeasonEndBadges(leagueId, seasonNumber)` - Week 17 end
2. `assignRecordBreakerBadges(leagueId, seasonNumber, advance)` - Per advance (dynamic)
3. `assignPlayoffBadges(leagueId, seasonNumber)` - Week 18 transition
4. `transitionRecordBadges(leagueId, seasonNumber)` - Convert Record Breaker → Record Holder
5. `clearSeasonBadges(leagueId, seasonNumber)` - Start of new season

### Menu Records Display
- New "/Records" section in /menu
- Leaderboard view: Top 5 records by category
- Current season holder + previous season holder comparison
- Filter by: Season, Record Type, User
