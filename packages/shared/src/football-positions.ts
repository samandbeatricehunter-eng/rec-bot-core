// Canonical 24-position CFB roster list — used by the recruiting-commits Discord flow's
// position picker (and anywhere else a full CFB position dropdown is needed). Distinct
// from purchases.ts's REC_OFFENSE_POSITIONS/REC_DEFENSE_POSITIONS, which is a narrower,
// differently-grouped list built for that store sub-flow (K under offense, P under
// defense) — this one is the standard position-group breakdown, not tied to purchases.

export const CFB_OFFENSE_POSITIONS = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"] as const;
export const CFB_DEFENSE_POSITIONS = ["LE", "RE", "DT", "NT", "LOLB", "MLB", "ROLB", "CB", "FS", "SS"] as const;
export const CFB_SPECIAL_TEAMS_POSITIONS = ["K", "P", "LS", "KR"] as const;

export const CFB_POSITIONS = [
  ...CFB_OFFENSE_POSITIONS,
  ...CFB_DEFENSE_POSITIONS,
  ...CFB_SPECIAL_TEAMS_POSITIONS,
] as const;

export type CfbPosition = (typeof CFB_POSITIONS)[number];
