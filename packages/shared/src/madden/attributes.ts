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
