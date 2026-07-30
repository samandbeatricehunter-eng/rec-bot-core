export const CFB_DIFFICULTIES = [
  "freshman",
  "varsity",
  "all_american",
  "heisman",
] as const;

export type CfbDifficulty = (typeof CFB_DIFFICULTIES)[number];

export const CFB_DIFFICULTY_LABELS: Record<CfbDifficulty, string> = {
  freshman: "Freshman",
  varsity: "Varsity",
  all_american: "All-American",
  heisman: "Heisman",
};

/** 2026–27 FBS postseason bowl names, including current title sponsors. */
export const CFB_BOWL_NAMES = [
  "68 Ventures Bowl",
  "Allstate Sugar Bowl",
  "AutoZone Liberty Bowl",
  "Bad Boy Mowers Pinstripe Bowl",
  "Boca Raton Bowl",
  "Cactus Bowl",
  "Capital One Orange Bowl",
  "Chick-fil-A Peach Bowl",
  "Citrus Bowl",
  "Cricket Celebration Bowl",
  "Duke's Mayo Bowl",
  "Famous Idaho Potato Bowl",
  "Freedom Mortgage Military Bowl",
  "Frisco Bowl",
  "Frisco Football Classic",
  "Goodyear Cotton Bowl",
  "IS4S Salute to Veterans Bowl",
  "Isleta New Mexico Bowl",
  "JLab Birmingham Bowl",
  "Kinder's Texas Bowl",
  "Las Vegas Bowl",
  "Liberty Mutual Music City Bowl",
  "Lockheed Martin Armed Forces Bowl",
  "Myrtle Beach Bowl",
  "New Orleans Bowl",
  "Poinsettia Bowl",
  "Pop-Tarts Bowl",
  "Puerto Rico Bowl",
  "Radiance Technologies Independence Bowl",
  "ReliaQuest Bowl",
  "Rose Bowl Game",
  "SERVPRO First Responder Bowl",
  "Sheraton Hawai'i Bowl",
  "Snoop Dogg Arizona Bowl",
  "StaffDNA Cure Bowl",
  "TaxSlayer Gator Bowl",
  "Tony the Tiger Sun Bowl",
  "Trust & Will Holiday Bowl",
  "Union Home Mortgage Gasparilla Bowl",
  "Valero Alamo Bowl",
  "Vrbo Fiesta Bowl",
  "Wasabi Fenway Bowl",
  "Custom Bowl",
] as const;

export type CfbBowlName = (typeof CFB_BOWL_NAMES)[number];

/** Translate legacy cross-game values while stored leagues are migrated. */
export function normalizeCfbDifficulty(value: string | null | undefined): CfbDifficulty {
  if (value === "all_madden" || value === "heisman") return "heisman";
  if (value === "all_pro" || value === "all_american") return "all_american";
  if (value === "pro" || value === "varsity") return "varsity";
  return "freshman";
}
