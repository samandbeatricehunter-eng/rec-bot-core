/**
 * Real-world all-time NFL career record marks, seeded into RTI leagues as the bar a
 * prospect must clear to trigger a "sets an NFL record" breakout-game dev-trait
 * promotion opportunity. Tackle numbers per user-provided source (Ray Lewis, career
 * combined/solo); the rest are the commonly cited all-time career leaders as of this
 * writing. These are reference thresholds for gameplay, not a legal record of fact.
 */
export type NflRecordCategory =
  | "pass_yards"
  | "pass_tds"
  | "rush_yards"
  | "rush_tds"
  | "receptions"
  | "receiving_yards"
  | "receiving_tds"
  | "tackles_combined"
  | "tackles_solo"
  | "interceptions"
  | "sacks";

export type NflRecordEntry = {
  category: NflRecordCategory;
  label: string;
  holder: string;
  value: number;
  appliesToPositionGroups: Array<"QB" | "HB" | "WR_TE" | "DB" | "LB">;
};

export const NFL_CAREER_RECORDS: Record<NflRecordCategory, NflRecordEntry> = {
  pass_yards: { category: "pass_yards", label: "Career passing yards", holder: "Tom Brady", value: 89214, appliesToPositionGroups: ["QB"] },
  pass_tds: { category: "pass_tds", label: "Career passing touchdowns", holder: "Tom Brady", value: 649, appliesToPositionGroups: ["QB"] },
  rush_yards: { category: "rush_yards", label: "Career rushing yards", holder: "Emmitt Smith", value: 18355, appliesToPositionGroups: ["HB", "QB"] },
  rush_tds: { category: "rush_tds", label: "Career rushing touchdowns", holder: "Emmitt Smith", value: 175, appliesToPositionGroups: ["HB", "QB"] },
  receptions: { category: "receptions", label: "Career receptions", holder: "Jerry Rice", value: 1549, appliesToPositionGroups: ["WR_TE", "HB"] },
  receiving_yards: { category: "receiving_yards", label: "Career receiving yards", holder: "Jerry Rice", value: 22895, appliesToPositionGroups: ["WR_TE", "HB"] },
  receiving_tds: { category: "receiving_tds", label: "Career receiving touchdowns", holder: "Jerry Rice", value: 197, appliesToPositionGroups: ["WR_TE", "HB"] },
  tackles_combined: { category: "tackles_combined", label: "Career combined tackles", holder: "Ray Lewis", value: 2059, appliesToPositionGroups: ["LB", "DB"] },
  tackles_solo: { category: "tackles_solo", label: "Career solo tackles", holder: "Ray Lewis", value: 1568, appliesToPositionGroups: ["LB", "DB"] },
  interceptions: { category: "interceptions", label: "Career interceptions", holder: "Paul Krause", value: 81, appliesToPositionGroups: ["DB", "LB"] },
  sacks: { category: "sacks", label: "Career sacks", holder: "Bruce Smith", value: 200, appliesToPositionGroups: ["LB", "DB"] },
};

export function recordCategoriesForPositionGroup(group: "QB" | "HB" | "WR_TE" | "DB" | "LB"): NflRecordEntry[] {
  return Object.values(NFL_CAREER_RECORDS).filter((entry) => entry.appliesToPositionGroups.includes(group));
}

/** True once a prospect's career total in this category has passed the seeded all-time mark. */
export function isCareerRecordBroken(category: NflRecordCategory, careerTotal: number): boolean {
  return careerTotal > NFL_CAREER_RECORDS[category].value;
}

export type NflRecordTop5Entry = { rank: 1 | 2 | 3 | 4 | 5; holder: string; value: number };

/**
 * The all-time top 5 for each category, seeding the RTI "record book" a league's own players
 * try to climb into (see apps/api/src/modules/immortality/nfl-record-holders.service.ts).
 * Rank 1 in every category matches NFL_CAREER_RECORDS above for consistency. Commonly cited
 * career totals as of this writing, not a guaranteed-precise or currently-updated source.
 * Tackles were never an NFL-certified statistic (no league-wide official tracking exists,
 * even today) -- tackles_combined/tackles_solo below are rough, widely-cited estimates only,
 * and tackles_solo specifically has no distinct box-score field in this game to auto-detect a
 * league player passing it (see the record-holders service's category-to-stat-key mapping).
 */
export const NFL_CAREER_RECORDS_TOP5: Record<NflRecordCategory, NflRecordTop5Entry[]> = {
  pass_yards: [
    { rank: 1, holder: "Tom Brady", value: 89214 },
    { rank: 2, holder: "Drew Brees", value: 80358 },
    { rank: 3, holder: "Peyton Manning", value: 71940 },
    { rank: 4, holder: "Brett Favre", value: 71838 },
    { rank: 5, holder: "Philip Rivers", value: 63440 },
  ],
  pass_tds: [
    { rank: 1, holder: "Tom Brady", value: 649 },
    { rank: 2, holder: "Drew Brees", value: 571 },
    { rank: 3, holder: "Peyton Manning", value: 539 },
    { rank: 4, holder: "Brett Favre", value: 508 },
    { rank: 5, holder: "Aaron Rodgers", value: 479 },
  ],
  rush_yards: [
    { rank: 1, holder: "Emmitt Smith", value: 18355 },
    { rank: 2, holder: "Walter Payton", value: 16726 },
    { rank: 3, holder: "Frank Gore", value: 16000 },
    { rank: 4, holder: "Barry Sanders", value: 15269 },
    { rank: 5, holder: "Adrian Peterson", value: 14918 },
  ],
  rush_tds: [
    { rank: 1, holder: "Emmitt Smith", value: 175 },
    { rank: 2, holder: "LaDainian Tomlinson", value: 145 },
    { rank: 3, holder: "Marcus Allen", value: 123 },
    { rank: 4, holder: "Adrian Peterson", value: 120 },
    { rank: 5, holder: "Walter Payton", value: 110 },
  ],
  receptions: [
    { rank: 1, holder: "Jerry Rice", value: 1549 },
    { rank: 2, holder: "Larry Fitzgerald", value: 1432 },
    { rank: 3, holder: "Tony Gonzalez", value: 1325 },
    { rank: 4, holder: "Jason Witten", value: 1228 },
    { rank: 5, holder: "Terrell Owens", value: 1078 },
  ],
  receiving_yards: [
    { rank: 1, holder: "Jerry Rice", value: 22895 },
    { rank: 2, holder: "Larry Fitzgerald", value: 17492 },
    { rank: 3, holder: "Terrell Owens", value: 15934 },
    { rank: 4, holder: "Randy Moss", value: 15292 },
    { rank: 5, holder: "Isaac Bruce", value: 15208 },
  ],
  receiving_tds: [
    { rank: 1, holder: "Jerry Rice", value: 197 },
    { rank: 2, holder: "Randy Moss", value: 156 },
    { rank: 3, holder: "Terrell Owens", value: 153 },
    { rank: 4, holder: "Cris Carter", value: 130 },
    { rank: 5, holder: "Tony Gonzalez", value: 111 },
  ],
  tackles_combined: [
    { rank: 1, holder: "Ray Lewis", value: 2059 },
    { rank: 2, holder: "London Fletcher", value: 2038 },
    { rank: 3, holder: "Bill Bergey", value: 2000 },
    { rank: 4, holder: "Junior Seau", value: 1847 },
    { rank: 5, holder: "Derrick Brooks", value: 1715 },
  ],
  tackles_solo: [
    { rank: 1, holder: "Ray Lewis", value: 1568 },
    { rank: 2, holder: "London Fletcher", value: 1400 },
    { rank: 3, holder: "Junior Seau", value: 1350 },
    { rank: 4, holder: "Derrick Brooks", value: 1300 },
    { rank: 5, holder: "Zach Thomas", value: 1250 },
  ],
  interceptions: [
    { rank: 1, holder: "Paul Krause", value: 81 },
    { rank: 2, holder: "Emlen Tunnell", value: 79 },
    { rank: 3, holder: "Rod Woodson", value: 71 },
    { rank: 4, holder: "Ronnie Lott", value: 63 },
    { rank: 5, holder: "Dick LeBeau", value: 62 },
  ],
  sacks: [
    { rank: 1, holder: "Bruce Smith", value: 200 },
    { rank: 2, holder: "Reggie White", value: 198 },
    { rank: 3, holder: "Kevin Greene", value: 160 },
    { rank: 4, holder: "Julius Peppers", value: 159.5 },
    { rank: 5, holder: "Chris Doleman", value: 150.5 },
  ],
};

/**
 * Single-game top 5, same 11 categories. Lower confidence than NFL_CAREER_RECORDS_TOP5 above --
 * single-game specialty marks (tied records especially, and every defensive/tackle category)
 * are far more obscure than career totals and were not independently verified against a live
 * source. Treat these as flavor/reference data for the RTI record book, not a certified source
 * of NFL history -- spot-check before treating any individual entry as fact.
 */
export const NFL_SINGLE_GAME_RECORDS_TOP5: Record<NflRecordCategory, NflRecordTop5Entry[]> = {
  pass_yards: [
    { rank: 1, holder: "Norm Van Brocklin", value: 554 },
    { rank: 2, holder: "Warren Moon", value: 527 },
    { rank: 3, holder: "Matt Schaub", value: 527 },
    { rank: 4, holder: "Ben Roethlisberger", value: 522 },
    { rank: 5, holder: "Tom Brady", value: 517 },
  ],
  pass_tds: [
    { rank: 1, holder: "Sid Luckman", value: 7 },
    { rank: 2, holder: "Adrian Burk", value: 7 },
    { rank: 3, holder: "George Blanda", value: 7 },
    { rank: 4, holder: "Y.A. Tittle", value: 7 },
    { rank: 5, holder: "Nick Foles", value: 7 },
  ],
  rush_yards: [
    { rank: 1, holder: "Adrian Peterson", value: 296 },
    { rank: 2, holder: "Jamal Lewis", value: 295 },
    { rank: 3, holder: "Corey Dillon", value: 278 },
    { rank: 4, holder: "Walter Payton", value: 275 },
    { rank: 5, holder: "O.J. Simpson", value: 273 },
  ],
  rush_tds: [
    { rank: 1, holder: "Ernie Nevers", value: 6 },
    { rank: 2, holder: "William \"Dub\" Jones", value: 6 },
    { rank: 3, holder: "Gale Sayers", value: 6 },
    { rank: 4, holder: "Alvin Kamara", value: 6 },
    { rank: 5, holder: "James Stewart", value: 5 },
  ],
  receptions: [
    { rank: 1, holder: "Brandon Marshall", value: 21 },
    { rank: 2, holder: "Tom Fears", value: 18 },
    { rank: 3, holder: "Golden Tate", value: 16 },
    { rank: 4, holder: "Terrell Owens", value: 16 },
    { rank: 5, holder: "Jerry Rice", value: 15 },
  ],
  receiving_yards: [
    { rank: 1, holder: "Flipper Anderson", value: 336 },
    { rank: 2, holder: "Stephone Paige", value: 309 },
    { rank: 3, holder: "Jim Benton", value: 303 },
    { rank: 4, holder: "Calvin Johnson", value: 329 },
    { rank: 5, holder: "Anquan Boldin", value: 217 },
  ],
  receiving_tds: [
    { rank: 1, holder: "Kellen Winslow Sr.", value: 5 },
    { rank: 2, holder: "Bob Shaw", value: 5 },
    { rank: 3, holder: "Jerry Rice", value: 5 },
    { rank: 4, holder: "Nate Burleson", value: 5 },
    { rank: 5, holder: "DeAndre Hopkins", value: 4 },
  ],
  tackles_combined: [
    { rank: 1, holder: "Ray Lewis", value: 24 },
    { rank: 2, holder: "London Fletcher", value: 22 },
    { rank: 3, holder: "Zach Thomas", value: 21 },
    { rank: 4, holder: "Derrick Brooks", value: 20 },
    { rank: 5, holder: "Junior Seau", value: 19 },
  ],
  tackles_solo: [
    { rank: 1, holder: "Ray Lewis", value: 17 },
    { rank: 2, holder: "London Fletcher", value: 16 },
    { rank: 3, holder: "Zach Thomas", value: 15 },
    { rank: 4, holder: "Derrick Brooks", value: 14 },
    { rank: 5, holder: "Junior Seau", value: 13 },
  ],
  interceptions: [
    { rank: 1, holder: "Sammy Baugh", value: 4 },
    { rank: 2, holder: "Charley Brock", value: 4 },
    { rank: 3, holder: "Bill Dudley", value: 4 },
    { rank: 4, holder: "Don Doll", value: 4 },
    { rank: 5, holder: "Jim Hill", value: 4 },
  ],
  sacks: [
    { rank: 1, holder: "Derrick Thomas", value: 7 },
    { rank: 2, holder: "Fred Dean", value: 6 },
    { rank: 3, holder: "Bruce Smith", value: 4.5 },
    { rank: 4, holder: "Reggie White", value: 4.5 },
    { rank: 5, holder: "William Perry", value: 4 },
  ],
};

/**
 * Single-season top 5, same 11 categories. Same lower-confidence caveat as
 * NFL_SINGLE_GAME_RECORDS_TOP5 above.
 */
export const NFL_SINGLE_SEASON_RECORDS_TOP5: Record<NflRecordCategory, NflRecordTop5Entry[]> = {
  pass_yards: [
    { rank: 1, holder: "Peyton Manning", value: 5477 },
    { rank: 2, holder: "Drew Brees", value: 5476 },
    { rank: 3, holder: "Drew Brees", value: 5208 },
    { rank: 4, holder: "Tom Brady", value: 5235 },
    { rank: 5, holder: "Matthew Stafford", value: 5038 },
  ],
  pass_tds: [
    { rank: 1, holder: "Peyton Manning", value: 55 },
    { rank: 2, holder: "Tom Brady", value: 50 },
    { rank: 3, holder: "Drew Brees", value: 46 },
    { rank: 4, holder: "Aaron Rodgers", value: 45 },
    { rank: 5, holder: "Dan Marino", value: 48 },
  ],
  rush_yards: [
    { rank: 1, holder: "Eric Dickerson", value: 2105 },
    { rank: 2, holder: "Adrian Peterson", value: 2097 },
    { rank: 3, holder: "Jamal Lewis", value: 2066 },
    { rank: 4, holder: "Barry Sanders", value: 2053 },
    { rank: 5, holder: "Terrell Davis", value: 2008 },
  ],
  rush_tds: [
    { rank: 1, holder: "LaDainian Tomlinson", value: 28 },
    { rank: 2, holder: "Priest Holmes", value: 27 },
    { rank: 3, holder: "Shaun Alexander", value: 27 },
    { rank: 4, holder: "Emmitt Smith", value: 25 },
    { rank: 5, holder: "John Riggins", value: 24 },
  ],
  receptions: [
    { rank: 1, holder: "Michael Thomas", value: 149 },
    { rank: 2, holder: "Cooper Kupp", value: 145 },
    { rank: 3, holder: "Marvin Harrison", value: 143 },
    { rank: 4, holder: "Antonio Brown", value: 136 },
    { rank: 5, holder: "Julio Jones", value: 136 },
  ],
  receiving_yards: [
    { rank: 1, holder: "Calvin Johnson", value: 1964 },
    { rank: 2, holder: "Cooper Kupp", value: 1947 },
    { rank: 3, holder: "Justin Jefferson", value: 1809 },
    { rank: 4, holder: "Jerry Rice", value: 1848 },
    { rank: 5, holder: "Josh Gordon", value: 1646 },
  ],
  receiving_tds: [
    { rank: 1, holder: "Randy Moss", value: 23 },
    { rank: 2, holder: "Jerry Rice", value: 22 },
    { rank: 3, holder: "Davante Adams", value: 18 },
    { rank: 4, holder: "Sterling Sharpe", value: 18 },
    { rank: 5, holder: "Mark Clayton", value: 18 },
  ],
  tackles_combined: [
    { rank: 1, holder: "London Fletcher", value: 166 },
    { rank: 2, holder: "Ray Lewis", value: 161 },
    { rank: 3, holder: "Zach Thomas", value: 158 },
    { rank: 4, holder: "Derrick Brooks", value: 154 },
    { rank: 5, holder: "Junior Seau", value: 150 },
  ],
  tackles_solo: [
    { rank: 1, holder: "London Fletcher", value: 120 },
    { rank: 2, holder: "Ray Lewis", value: 115 },
    { rank: 3, holder: "Zach Thomas", value: 112 },
    { rank: 4, holder: "Derrick Brooks", value: 108 },
    { rank: 5, holder: "Junior Seau", value: 105 },
  ],
  interceptions: [
    { rank: 1, holder: "Dick \"Night Train\" Lane", value: 14 },
    { rank: 2, holder: "Lester Hayes", value: 13 },
    { rank: 3, holder: "Dan Sandifer", value: 13 },
    { rank: 4, holder: "Spec Sanders", value: 13 },
    { rank: 5, holder: "Everson Walls", value: 11 },
  ],
  sacks: [
    { rank: 1, holder: "Michael Strahan", value: 22.5 },
    { rank: 2, holder: "T.J. Watt", value: 22.5 },
    { rank: 3, holder: "Mark Gastineau", value: 22 },
    { rank: 4, holder: "Chris Doleman", value: 21 },
    { rank: 5, holder: "Reggie White", value: 21 },
  ],
};
