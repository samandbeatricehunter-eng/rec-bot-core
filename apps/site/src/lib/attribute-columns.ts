import { getRecAttributeDisplayName } from "@rec/shared";

// Maps the snake_case keys stored in rec_players.attributes to the 3-letter Madden codes
// (matching MADDEN_ATTRIBUTE_DEFINITIONS in @rec/shared) used for spreadsheet-style column
// headers across the draft room, roster viewer, and Trade Center player tables.
export const ATTRIBUTE_KEY_TO_CODE: Record<string, string> = {
  speed: "SPD", acceleration: "ACC", strength: "STR", agility: "AGI", awareness: "AWR",
  jumping: "JMP", injury: "INJ", stamina: "STA", toughness: "TOU",
  throw_power: "THP", throw_under_pressure: "TUP", throw_accuracy_short: "SAC",
  throw_accuracy_mid: "MAC", throw_accuracy_deep: "DAC", throw_on_the_run: "RUN", play_action: "PAC",
  catching: "CTH", spectacular_catch: "SPC", catch_in_traffic: "CIT",
  route_running_short: "SRR", route_running_medium: "MRR", route_running_deep: "DRR", release: "RLS",
  carrying: "CAR", break_tackle: "BTK", trucking: "TRK", change_of_direction: "COD",
  bc_vision: "BCV", stiff_arm: "SFA", spin_move: "SPM", juke_move: "JKM", break_sack: "BSK",
  tackle: "TAK", power_moves: "PMV", finesse_moves: "FMV", block_shedding: "BSH", pursuit: "PUR",
  play_recognition: "PRC", man_coverage: "MCV", zone_coverage: "ZCV", hit_power: "POW", press: "PRS",
  run_block: "RBK", pass_block: "PBK", impact_blocking: "IBL", run_block_power: "RBP",
  run_block_finesse: "RBF", pass_block_power: "PBP", pass_block_finesse: "PBF", lead_block: "LBK",
  kick_power: "KPW", kick_accuracy: "KAC", kick_return: "RET",
};
export const ATTRIBUTE_ALL_KEYS = Object.keys(ATTRIBUTE_KEY_TO_CODE);

export function attributeLabel(key: string): string {
  return ATTRIBUTE_KEY_TO_CODE[key] ?? key.slice(0, 3).toUpperCase();
}
export function attributeFullName(key: string): string {
  const code = ATTRIBUTE_KEY_TO_CODE[key];
  return code ? getRecAttributeDisplayName(code) : key;
}
