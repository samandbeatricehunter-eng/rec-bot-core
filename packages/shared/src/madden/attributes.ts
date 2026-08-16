export type MaddenAttributeCode =
  | "ACC" | "AGI" | "AWR" | "BCV" | "BSH" | "BSK" | "BTK" | "CAR" | "CIT" | "COD" | "CTH"
  | "DAC" | "DRR" | "FMV" | "IBL" | "INJ" | "JKM" | "JMP" | "KAC" | "KPW" | "LBK" | "MAC" | "MCV"
  | "MRR" | "PAC" | "PBF" | "PBP" | "PBK" | "PMV" | "POW" | "PRC" | "PRS" | "PUR" | "RBF" | "RBP"
  | "RBK" | "RET" | "RLS" | "RUN" | "SAC" | "SFA" | "SPC" | "SPD" | "SPM" | "SRR" | "STA" | "STR"
  | "TAK" | "THP" | "TOU" | "TRK" | "TUP" | "ZCV";

export type MaddenAttributeGroupKey =
  | "physical"
  | "passing_ball"
  | "receiving"
  | "blocking"
  | "defensive_kicking";

export type MaddenAttributeDefinition = {
  code: MaddenAttributeCode;
  name: string;
  category: "physical" | "offensive" | "defensive";
  subgroup: string;
};

export const MADDEN_ATTRIBUTE_DEFINITIONS: MaddenAttributeDefinition[] = [
  { code: "SPD", name: "Speed", category: "physical", subgroup: "Physical" },
  { code: "ACC", name: "Acceleration", category: "physical", subgroup: "Physical" },
  { code: "AGI", name: "Agility", category: "physical", subgroup: "Physical" },
  { code: "COD", name: "Change of Direction", category: "physical", subgroup: "Physical" },
  { code: "STR", name: "Strength", category: "physical", subgroup: "Physical" },
  { code: "JMP", name: "Jumping", category: "physical", subgroup: "Physical" },
  { code: "STA", name: "Stamina", category: "physical", subgroup: "Physical" },
  { code: "INJ", name: "Injury", category: "physical", subgroup: "Physical" },
  { code: "AWR", name: "Awareness", category: "physical", subgroup: "Physical" },
  { code: "TOU", name: "Toughness", category: "physical", subgroup: "Physical" },

  { code: "THP", name: "Throw Power", category: "offensive", subgroup: "Passing" },
  { code: "SAC", name: "Short Accuracy", category: "offensive", subgroup: "Passing" },
  { code: "MAC", name: "Medium Accuracy", category: "offensive", subgroup: "Passing" },
  { code: "DAC", name: "Deep Accuracy", category: "offensive", subgroup: "Passing" },
  { code: "RUN", name: "Throw on the Run", category: "offensive", subgroup: "Passing" },
  { code: "TUP", name: "Throw Under Pressure", category: "offensive", subgroup: "Passing" },
  { code: "BSK", name: "Break Sack", category: "offensive", subgroup: "Passing" },
  { code: "PAC", name: "Play Action", category: "offensive", subgroup: "Passing" },

  { code: "TRK", name: "Trucking", category: "offensive", subgroup: "Ball Carrier" },
  { code: "BCV", name: "Ball Carrier Vision", category: "offensive", subgroup: "Ball Carrier" },
  { code: "SFA", name: "Stiff Arm", category: "offensive", subgroup: "Ball Carrier" },
  { code: "SPM", name: "Spin Move", category: "offensive", subgroup: "Ball Carrier" },
  { code: "JKM", name: "Juke Move", category: "offensive", subgroup: "Ball Carrier" },
  { code: "CAR", name: "Carrying", category: "offensive", subgroup: "Ball Carrier" },
  { code: "BTK", name: "Break Tackle", category: "offensive", subgroup: "Ball Carrier" },

  { code: "CTH", name: "Catching", category: "offensive", subgroup: "Receiving" },
  { code: "CIT", name: "Catch in Traffic", category: "offensive", subgroup: "Receiving" },
  { code: "SPC", name: "Spectacular Catch", category: "offensive", subgroup: "Receiving" },
  { code: "RLS", name: "Release", category: "offensive", subgroup: "Receiving" },
  { code: "SRR", name: "Short Route Running", category: "offensive", subgroup: "Receiving" },
  { code: "MRR", name: "Medium Route Running", category: "offensive", subgroup: "Receiving" },
  { code: "DRR", name: "Deep Route Running", category: "offensive", subgroup: "Receiving" },
  { code: "RET", name: "Kick Return", category: "offensive", subgroup: "Receiving" },

  { code: "PBK", name: "Pass Block", category: "offensive", subgroup: "Blocking" },
  { code: "PBP", name: "Pass Block Power", category: "offensive", subgroup: "Blocking" },
  { code: "PBF", name: "Pass Block Finesse", category: "offensive", subgroup: "Blocking" },
  { code: "RBK", name: "Run Block", category: "offensive", subgroup: "Blocking" },
  { code: "RBP", name: "Run Block Power", category: "offensive", subgroup: "Blocking" },
  { code: "RBF", name: "Run Block Finesse", category: "offensive", subgroup: "Blocking" },
  { code: "LBK", name: "Lead Block", category: "offensive", subgroup: "Blocking" },
  { code: "IBL", name: "Impact Blocking", category: "offensive", subgroup: "Blocking" },

  { code: "KPW", name: "Kick Power", category: "offensive", subgroup: "Kicking" },
  { code: "KAC", name: "Kick Accuracy", category: "offensive", subgroup: "Kicking" },

  { code: "TAK", name: "Tackle", category: "defensive", subgroup: "Defense" },
  { code: "POW", name: "Hit Power", category: "defensive", subgroup: "Defense" },
  { code: "PMV", name: "Power Moves", category: "defensive", subgroup: "Defense" },
  { code: "FMV", name: "Finesse Moves", category: "defensive", subgroup: "Defense" },
  { code: "BSH", name: "Block Shedding", category: "defensive", subgroup: "Defense" },
  { code: "PUR", name: "Pursuit", category: "defensive", subgroup: "Defense" },
  { code: "PRC", name: "Play Recognition", category: "defensive", subgroup: "Defense" },
  { code: "MCV", name: "Man Coverage", category: "defensive", subgroup: "Defense" },
  { code: "ZCV", name: "Zone Coverage", category: "defensive", subgroup: "Defense" },
  { code: "PRS", name: "Press", category: "defensive", subgroup: "Defense" },
];

export const MADDEN_ATTRIBUTE_BY_CODE = new Map(
  MADDEN_ATTRIBUTE_DEFINITIONS.map((def) => [def.code, def])
);

// rec_players.attributes is keyed by the snake_case names ea-direct-writer.ts's
// EA_RATING_TO_SNAKE map writes at import time (e.g. "throw_power"), not these 3-letter
// codes — this is the other half of that same mapping, so any UI that already has a
// player's live attributes can look up "what is this code's current value on this player."
export const MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY: Record<MaddenAttributeCode, string> = {
  SPD: "speed", ACC: "acceleration", AGI: "agility", COD: "change_of_direction", STR: "strength",
  JMP: "jumping", STA: "stamina", INJ: "injury", AWR: "awareness", TOU: "toughness",
  THP: "throw_power", SAC: "throw_accuracy_short", MAC: "throw_accuracy_mid", DAC: "throw_accuracy_deep",
  RUN: "throw_on_the_run", TUP: "throw_under_pressure", BSK: "break_sack", PAC: "play_action",
  TRK: "trucking", BCV: "bc_vision", SFA: "stiff_arm", SPM: "spin_move", JKM: "juke_move",
  CAR: "carrying", BTK: "break_tackle",
  CTH: "catching", CIT: "catch_in_traffic", SPC: "spectacular_catch", RLS: "release",
  SRR: "route_running_short", MRR: "route_running_medium", DRR: "route_running_deep", RET: "kick_return",
  PBK: "pass_block", PBP: "pass_block_power", PBF: "pass_block_finesse",
  RBK: "run_block", RBP: "run_block_power", RBF: "run_block_finesse",
  LBK: "lead_block", IBL: "impact_blocking",
  TAK: "tackle", POW: "hit_power", PMV: "power_moves", FMV: "finesse_moves", BSH: "block_shedding",
  PUR: "pursuit", PRC: "play_recognition", MCV: "man_coverage", ZCV: "zone_coverage", PRS: "press",
  KPW: "kick_power", KAC: "kick_accuracy",
};

/** Current value of a code (SPD, THP, …) on a player's rec_players.attributes map, if logged. */
export function rosterAttributeValueForCode(attributes: Record<string, number | null> | null | undefined, code: string): number | null {
  const key = MADDEN_ATTRIBUTE_CODE_TO_ROSTER_KEY[code as MaddenAttributeCode];
  if (!key || !attributes) return null;
  const value = attributes[key];
  return typeof value === "number" ? value : null;
}

export const MADDEN_ATTRIBUTE_SELECTION_GROUPS: Record<MaddenAttributeGroupKey, {
  label: string;
  codes: MaddenAttributeCode[];
}> = {
  physical: {
    label: "Physical Skills",
    codes: ["SPD", "ACC", "AGI", "COD", "STR", "JMP", "STA", "INJ", "AWR", "TOU"],
  },
  passing_ball: {
    label: "Passing & Ball Carrier",
    codes: ["THP", "SAC", "MAC", "DAC", "RUN", "TUP", "BSK", "PAC", "TRK", "BCV", "SFA", "SPM", "JKM", "CAR", "BTK"],
  },
  receiving: {
    label: "Receiving Skills",
    codes: ["CTH", "CIT", "SPC", "RLS", "SRR", "MRR", "DRR", "RET"],
  },
  blocking: {
    label: "Blocking Skills",
    codes: ["PBK", "PBP", "PBF", "RBK", "RBP", "RBF", "LBK", "IBL"],
  },
  defensive_kicking: {
    label: "Defensive & Kicking",
    codes: ["TAK", "POW", "PMV", "FMV", "BSH", "PUR", "PRC", "MCV", "ZCV", "PRS", "KPW", "KAC"],
  },
};

// Dropdown-safe grouping: exactly 3 groups, each ≤25 options, covering all 53 attributes.
// Used by the Core-attribute config picker and the attribute purchase picker so selects stay
// under Discord's 25-option / 5-row limits. Keep these exhaustive and mutually exclusive.
export type MaddenAttributeDropdownGroupKey = "athletic_carrier" | "passing_receiving" | "blocking_defense_kicking";

export const MADDEN_ATTRIBUTE_DROPDOWN_GROUPS: Record<MaddenAttributeDropdownGroupKey, {
  label: string;
  codes: MaddenAttributeCode[];
}> = {
  athletic_carrier: {
    label: "Athletic & Ball Carrier",
    codes: ["SPD", "ACC", "AGI", "COD", "STR", "JMP", "STA", "INJ", "AWR", "TOU", "TRK", "BCV", "SFA", "SPM", "JKM", "CAR", "BTK"],
  },
  passing_receiving: {
    label: "Passing & Receiving",
    codes: ["THP", "SAC", "MAC", "DAC", "RUN", "TUP", "BSK", "PAC", "CTH", "CIT", "SPC", "RLS", "SRR", "MRR", "DRR", "RET"],
  },
  blocking_defense_kicking: {
    label: "Blocking, Defense & Kicking",
    codes: ["PBK", "PBP", "PBF", "RBK", "RBP", "RBF", "LBK", "IBL", "TAK", "POW", "PMV", "FMV", "BSH", "PUR", "PRC", "MCV", "ZCV", "PRS", "KPW", "KAC"],
  },
};

export const MADDEN_ATTRIBUTE_CATEGORY_SUMMARY = {
  physical: MADDEN_ATTRIBUTE_DEFINITIONS.filter((def) => def.category === "physical"),
  offensive: MADDEN_ATTRIBUTE_DEFINITIONS.filter((def) => def.category === "offensive"),
  defensive: MADDEN_ATTRIBUTE_DEFINITIONS.filter((def) => def.category === "defensive"),
};

export function formatMaddenAttributeList(codes: string[]) {
  return codes
    .map((code) => {
      const def = MADDEN_ATTRIBUTE_BY_CODE.get(code as MaddenAttributeCode);
      return def ? `${def.code} (${def.name})` : code;
    })
    .join(", ");
}

export function isMaddenAttributeCode(value: string): value is MaddenAttributeCode {
  return MADDEN_ATTRIBUTE_BY_CODE.has(value as MaddenAttributeCode);
}
