/**
 * REC custom-player archetype catalog and cost policy.
 *
 * CFB labels are observed in the approved CFB 27 baseline roster `utility` field.
 * Madden labels are REC-authoritative launch labels and are not represented as
 * EA's proprietary/internal archetype taxonomy.
 *
 * Archetypes affect creation-point pricing, support gates, and submission identity.
 * They never add or subtract OVR directly.
 */

import { normalizeRecOvrPosition, REC_POSITION_OVR_MODELS, type RecOvrPosition } from "./ovr-model.js";
import { MADDEN_ATTRIBUTE_DEFINITIONS } from "../madden/attributes.js";

const ALL_ATTRIBUTE_CODES: readonly string[] = MADDEN_ATTRIBUTE_DEFINITIONS.map((d) => d.code.toLowerCase());

export const REC_ARCHETYPE_CONFIG_VERSION = "rec-archetypes-v1.1.0" as const;
export type RecGameFamily = "CFB" | "MADDEN";
export type RecPackageTier = 1 | 2 | 3 | 4 | 5;

export interface RecArchetypeDefinition {
  key: string;
  label: string;
  primaryAttributes: readonly string[];
  secondaryAttributes: readonly string[];
  source: "cfb27_baseline_utility" | "rec_launch_madden_v1";
  observedCfb27Players?: number;
}

// "irrelevant" covers every attribute outside both this archetype's primary/secondary list
// AND the position's OVR-model coefficients — e.g. blocking ratings on a CB. Custom players
// must have every one of the 53 attributes set (not just the ones that matter for this
// position/archetype), so those still cost creation points to raise, just at a lower,
// "less intensified" rate than an attribute the position's OVR model actually weighs.
export const REC_ARCHETYPE_COST_MULTIPLIERS = {
  primary: 1.15,
  secondary: 1.07,
  otherPositionRelevant: 1.00,
  irrelevant: 0.5,
} as const;

export const REC_ARCHETYPE_IDENTITY_FLOORS: Readonly<Record<RecPackageTier, number>> = {
  1: 50,
  2: 55,
  3: 60,
  4: 65,
  5: 70,
} as const;

export const REC_ARCHETYPE_CATALOG: Readonly<
  Record<RecGameFamily, Record<RecOvrPosition, readonly RecArchetypeDefinition[]>>
> = {
  CFB: {
    QB: [
    { key: "pocket_passer", label: "Pocket Passer", primaryAttributes: ["mac", "dac", "sac", "tup"], secondaryAttributes: ["awr", "pac", "thp", "bsk"], source: "cfb27_baseline_utility", observedCfb27Players: 355 },
    { key: "pure_runner", label: "Pure Runner", primaryAttributes: ["spd", "cod", "acc", "run"], secondaryAttributes: ["bsk", "thp", "sac", "mac"], source: "cfb27_baseline_utility", observedCfb27Players: 147 },
    { key: "dual_threat", label: "Dual Threat", primaryAttributes: ["thp", "run", "bsk", "spd"], secondaryAttributes: ["sac", "mac", "dac", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 84 },
    { key: "backfield_creator", label: "Backfield Creator", primaryAttributes: ["run", "cod", "acc", "bsk"], secondaryAttributes: ["spd", "tup", "pac", "thp"], source: "cfb27_baseline_utility", observedCfb27Players: 13 },
    ],
    HB: [
    { key: "east_west_playmaker", label: "East/West Playmaker", primaryAttributes: ["agi", "cod", "jkm", "spm"], secondaryAttributes: ["spd", "acc", "bcv", "btk"], source: "cfb27_baseline_utility", observedCfb27Players: 580 },
    { key: "contact_seeker", label: "Contact Seeker", primaryAttributes: ["trk", "sfa", "btk", "car"], secondaryAttributes: ["str", "bcv", "awr", "spm"], source: "cfb27_baseline_utility", observedCfb27Players: 111 },
    { key: "backfield_threat", label: "Backfield Threat", primaryAttributes: ["cth", "acc", "cod", "agi"], secondaryAttributes: ["spd", "bcv", "car", "jkm"], source: "cfb27_baseline_utility", observedCfb27Players: 46 },
    { key: "elusive_bruiser", label: "Elusive Bruiser", primaryAttributes: ["trk", "sfa", "btk", "cod"], secondaryAttributes: ["agi", "spd", "car", "bcv"], source: "cfb27_baseline_utility", observedCfb27Players: 19 },
    ],
    FB: [
    { key: "utility", label: "Utility", primaryAttributes: ["cth", "car", "bcv", "trk"], secondaryAttributes: ["acc", "spd", "rbk", "ibl"], source: "cfb27_baseline_utility", observedCfb27Players: 18 },
    { key: "blocking", label: "Blocking", primaryAttributes: ["lbk", "ibl", "rbk", "str"], secondaryAttributes: ["awr", "car", "trk", "sfa"], source: "cfb27_baseline_utility", observedCfb27Players: 5 },
    ],
    WR: [
    { key: "elusive_route_runner", label: "Elusive Route Runner", primaryAttributes: ["srr", "mrr", "cod", "agi"], secondaryAttributes: ["acc", "spd", "cth", "drr"], source: "cfb27_baseline_utility", observedCfb27Players: 573 },
    { key: "gadget", label: "Gadget", primaryAttributes: ["cod", "agi", "acc", "spd"], secondaryAttributes: ["cth", "ret", "jkm", "spm"], source: "cfb27_baseline_utility", observedCfb27Players: 263 },
    { key: "speedster", label: "Speedster", primaryAttributes: ["spd", "acc", "drr", "rls"], secondaryAttributes: ["cth", "srr", "mrr", "cod"], source: "cfb27_baseline_utility", observedCfb27Players: 255 },
    { key: "contested_specialist", label: "Contested Specialist", primaryAttributes: ["rls", "spc", "cit", "cth"], secondaryAttributes: ["jmp", "str", "mrr", "drr"], source: "cfb27_baseline_utility", observedCfb27Players: 136 },
    { key: "route_artist", label: "Route Artist", primaryAttributes: ["srr", "mrr", "drr", "rls"], secondaryAttributes: ["cth", "cit", "awr", "cod"], source: "cfb27_baseline_utility", observedCfb27Players: 16 },
    ],
    TE: [
    { key: "physical_route_runner", label: "Physical Route Runner", primaryAttributes: ["cth", "cit", "srr", "mrr"], secondaryAttributes: ["rls", "spc", "str", "drr"], source: "cfb27_baseline_utility", observedCfb27Players: 361 },
    { key: "vertical_threat", label: "Vertical Threat", primaryAttributes: ["spd", "acc", "drr", "spc"], secondaryAttributes: ["cth", "mrr", "rls", "srr"], source: "cfb27_baseline_utility", observedCfb27Players: 229 },
    { key: "gritty_possession", label: "Gritty Possession", primaryAttributes: ["cit", "cth", "rbk", "ibl"], secondaryAttributes: ["str", "lbk", "awr", "srr"], source: "cfb27_baseline_utility", observedCfb27Players: 90 },
    { key: "pure_blocker", label: "Pure Blocker", primaryAttributes: ["rbk", "ibl", "lbk", "str"], secondaryAttributes: ["awr", "pbk", "pbf", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 69 },
    { key: "pure_possession", label: "Pure Possession", primaryAttributes: ["cit", "cth", "spc", "str"], secondaryAttributes: ["rls", "srr", "mrr", "awr"], source: "cfb27_baseline_utility", observedCfb27Players: 7 },
    ],
    LT: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 341 },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 68 },
    { key: "raw_strength", label: "Raw Strength", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "cfb27_baseline_utility", observedCfb27Players: 95 },
    ],
    LG: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 266 },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 29 },
    { key: "raw_strength", label: "Raw Strength", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "cfb27_baseline_utility", observedCfb27Players: 182 },
    ],
    C: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 176 },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 122 },
    { key: "raw_strength", label: "Raw Strength", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "cfb27_baseline_utility", observedCfb27Players: 105 },
    ],
    RG: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 279 },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 25 },
    { key: "raw_strength", label: "Raw Strength", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "cfb27_baseline_utility", observedCfb27Players: 161 },
    ],
    RT: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 317 },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "cfb27_baseline_utility", observedCfb27Players: 70 },
    { key: "raw_strength", label: "Raw Strength", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "cfb27_baseline_utility", observedCfb27Players: 99 },
    ],
    LE: [
    { key: "pure_power", label: "Pure Power", primaryAttributes: ["bsh", "str", "pmv", "pow"], secondaryAttributes: ["tak", "prc", "awr", "pur"], source: "cfb27_baseline_utility", observedCfb27Players: 247 },
    { key: "speed_rusher", label: "Speed Rusher", primaryAttributes: ["fmv", "spd", "acc", "pur"], secondaryAttributes: ["bsh", "tak", "prc", "awr"], source: "cfb27_baseline_utility", observedCfb27Players: 203 },
    { key: "power_rusher", label: "Power Rusher", primaryAttributes: ["pmv", "bsh", "str", "pow"], secondaryAttributes: ["prc", "tak", "pur", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 120 },
    { key: "edge_setter", label: "Edge Setter", primaryAttributes: ["bsh", "tak", "pur", "prc"], secondaryAttributes: ["str", "pow", "awr", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 18 },
    ],
    RE: [
    { key: "pure_power", label: "Pure Power", primaryAttributes: ["bsh", "str", "pmv", "pow"], secondaryAttributes: ["tak", "prc", "awr", "pur"], source: "cfb27_baseline_utility", observedCfb27Players: 87 },
    { key: "speed_rusher", label: "Speed Rusher", primaryAttributes: ["fmv", "spd", "acc", "pur"], secondaryAttributes: ["bsh", "tak", "prc", "awr"], source: "cfb27_baseline_utility", observedCfb27Players: 368 },
    { key: "power_rusher", label: "Power Rusher", primaryAttributes: ["pmv", "bsh", "str", "pow"], secondaryAttributes: ["prc", "tak", "pur", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 91 },
    { key: "edge_setter", label: "Edge Setter", primaryAttributes: ["bsh", "tak", "pur", "prc"], secondaryAttributes: ["str", "pow", "awr", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 19 },
    ],
    DT: [
    { key: "pure_power", label: "Pure Power", primaryAttributes: ["bsh", "str", "pmv", "pow"], secondaryAttributes: ["tak", "prc", "pur", "awr"], source: "cfb27_baseline_utility", observedCfb27Players: 699 },
    { key: "power_rusher", label: "Power Rusher", primaryAttributes: ["pmv", "bsh", "pow", "str"], secondaryAttributes: ["fmv", "acc", "prc", "tak"], source: "cfb27_baseline_utility", observedCfb27Players: 91 },
    { key: "speed_rusher", label: "Speed Rusher", primaryAttributes: ["fmv", "acc", "spd", "pur"], secondaryAttributes: ["bsh", "pmv", "tak", "prc"], source: "cfb27_baseline_utility", observedCfb27Players: 78 },
    { key: "gap_specialist", label: "Gap Specialist", primaryAttributes: ["bsh", "pur", "tak", "prc"], secondaryAttributes: ["str", "pow", "awr", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 24 },
    ],
    LOLB: [
    { key: "lurker", label: "Lurker", primaryAttributes: ["zcv", "mcv", "agi", "acc"], secondaryAttributes: ["spd", "cth", "prc", "pur"], source: "cfb27_baseline_utility", observedCfb27Players: 125 },
    { key: "thumper", label: "Thumper", primaryAttributes: ["tak", "bsh", "pow", "pur"], secondaryAttributes: ["str", "prc", "awr", "pmv"], source: "cfb27_baseline_utility", observedCfb27Players: 67 },
    { key: "signal_caller", label: "Signal Caller", primaryAttributes: ["awr", "prc", "pur", "tak"], secondaryAttributes: ["zcv", "mcv", "bsh", "pow"], source: "cfb27_baseline_utility", observedCfb27Players: 9 },
    ],
    MLB: [
    { key: "lurker", label: "Lurker", primaryAttributes: ["zcv", "mcv", "agi", "acc"], secondaryAttributes: ["spd", "cth", "prc", "pur"], source: "cfb27_baseline_utility", observedCfb27Players: 258 },
    { key: "thumper", label: "Thumper", primaryAttributes: ["tak", "bsh", "pow", "pur"], secondaryAttributes: ["str", "prc", "awr", "pmv"], source: "cfb27_baseline_utility", observedCfb27Players: 303 },
    { key: "signal_caller", label: "Signal Caller", primaryAttributes: ["awr", "prc", "pur", "tak"], secondaryAttributes: ["zcv", "mcv", "bsh", "pow"], source: "cfb27_baseline_utility", observedCfb27Players: 33 },
    ],
    ROLB: [
    { key: "lurker", label: "Lurker", primaryAttributes: ["zcv", "mcv", "agi", "acc"], secondaryAttributes: ["spd", "cth", "prc", "pur"], source: "cfb27_baseline_utility", observedCfb27Players: 250 },
    { key: "thumper", label: "Thumper", primaryAttributes: ["tak", "bsh", "pow", "pur"], secondaryAttributes: ["str", "prc", "awr", "pmv"], source: "cfb27_baseline_utility", observedCfb27Players: 248 },
    { key: "signal_caller", label: "Signal Caller", primaryAttributes: ["awr", "prc", "pur", "tak"], secondaryAttributes: ["zcv", "mcv", "bsh", "pow"], source: "cfb27_baseline_utility", observedCfb27Players: 21 },
    ],
    CB: [
    { key: "bump_and_run", label: "Bump and Run", primaryAttributes: ["mcv", "prs", "spd", "acc"], secondaryAttributes: ["cod", "agi", "cth", "prc"], source: "cfb27_baseline_utility", observedCfb27Players: 466 },
    { key: "field", label: "Field", primaryAttributes: ["zcv", "prc", "spd", "cth"], secondaryAttributes: ["mcv", "acc", "agi", "tak"], source: "cfb27_baseline_utility", observedCfb27Players: 424 },
    { key: "boundary", label: "Boundary", primaryAttributes: ["prs", "mcv", "tak", "pur"], secondaryAttributes: ["prc", "awr", "cth", "spd"], source: "cfb27_baseline_utility", observedCfb27Players: 118 },
    { key: "zone", label: "Zone", primaryAttributes: ["zcv", "prc", "awr", "pur"], secondaryAttributes: ["mcv", "cth", "spd", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 29 },
    ],
    FS: [
    { key: "box_specialist", label: "Box Specialist", primaryAttributes: ["tak", "pow", "pur", "prc"], secondaryAttributes: ["awr", "zcv", "spd", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 359 },
    { key: "hybrid", label: "Hybrid", primaryAttributes: ["mcv", "zcv", "pur", "prs"], secondaryAttributes: ["spd", "acc", "agi", "cod"], source: "cfb27_baseline_utility", observedCfb27Players: 219 },
    { key: "coverage_specialist", label: "Coverage Specialist", primaryAttributes: ["zcv", "mcv", "prc", "awr"], secondaryAttributes: ["spd", "acc", "cod", "cth"], source: "cfb27_baseline_utility", observedCfb27Players: 9 },
    ],
    SS: [
    { key: "box_specialist", label: "Box Specialist", primaryAttributes: ["tak", "pow", "pur", "prc"], secondaryAttributes: ["awr", "zcv", "spd", "acc"], source: "cfb27_baseline_utility", observedCfb27Players: 72 },
    { key: "hybrid", label: "Hybrid", primaryAttributes: ["mcv", "zcv", "pur", "prs"], secondaryAttributes: ["spd", "acc", "agi", "cod"], source: "cfb27_baseline_utility", observedCfb27Players: 292 },
    { key: "coverage_specialist", label: "Coverage Specialist", primaryAttributes: ["zcv", "mcv", "prc", "awr"], secondaryAttributes: ["spd", "acc", "cod", "cth"], source: "cfb27_baseline_utility", observedCfb27Players: 193 },
    ],
    K: [
    { key: "power", label: "Power", primaryAttributes: ["kpw"], secondaryAttributes: ["kac", "awr"], source: "cfb27_baseline_utility", observedCfb27Players: 201 },
    { key: "accurate", label: "Accurate", primaryAttributes: ["kac"], secondaryAttributes: ["kpw", "awr"], source: "cfb27_baseline_utility", observedCfb27Players: 68 },
    ],
    P: [
    { key: "power", label: "Power", primaryAttributes: ["kpw"], secondaryAttributes: ["kac", "awr"], source: "cfb27_baseline_utility", observedCfb27Players: 194 },
    { key: "accurate", label: "Accurate", primaryAttributes: ["kac"], secondaryAttributes: ["kpw", "awr"], source: "cfb27_baseline_utility", observedCfb27Players: 10 },
    ],
  },
  MADDEN: {
    QB: [
    { key: "field_general", label: "Field General", primaryAttributes: ["mac", "dac", "sac", "tup"], secondaryAttributes: ["awr", "pac", "thp", "bsk"], source: "rec_launch_madden_v1" },
    { key: "strong_arm", label: "Strong Arm", primaryAttributes: ["thp", "dac", "tup", "pac"], secondaryAttributes: ["sac", "mac", "awr", "bsk"], source: "rec_launch_madden_v1" },
    { key: "scrambler", label: "Scrambler", primaryAttributes: ["spd", "cod", "acc", "run"], secondaryAttributes: ["bsk", "thp", "sac", "mac"], source: "rec_launch_madden_v1" },
    { key: "improviser", label: "Improviser", primaryAttributes: ["run", "bsk", "cod", "tup"], secondaryAttributes: ["spd", "acc", "thp", "pac"], source: "rec_launch_madden_v1" },
    ],
    HB: [
    { key: "elusive_back", label: "Elusive Back", primaryAttributes: ["agi", "cod", "jkm", "spm"], secondaryAttributes: ["spd", "acc", "bcv", "btk"], source: "rec_launch_madden_v1" },
    { key: "power_back", label: "Power Back", primaryAttributes: ["trk", "sfa", "btk", "car"], secondaryAttributes: ["str", "bcv", "awr", "spm"], source: "rec_launch_madden_v1" },
    { key: "receiving_back", label: "Receiving Back", primaryAttributes: ["cth", "acc", "cod", "agi"], secondaryAttributes: ["spd", "bcv", "car", "jkm"], source: "rec_launch_madden_v1" },
    { key: "balanced_back", label: "Balanced Back", primaryAttributes: ["bcv", "car", "btk", "cod"], secondaryAttributes: ["agi", "spd", "trk", "cth"], source: "rec_launch_madden_v1" },
    ],
    FB: [
    { key: "utility", label: "Utility", primaryAttributes: ["cth", "car", "bcv", "trk"], secondaryAttributes: ["acc", "spd", "rbk", "ibl"], source: "rec_launch_madden_v1" },
    { key: "blocking", label: "Blocking", primaryAttributes: ["lbk", "ibl", "rbk", "str"], secondaryAttributes: ["awr", "car", "trk", "sfa"], source: "rec_launch_madden_v1" },
    ],
    WR: [
    { key: "route_runner", label: "Route Runner", primaryAttributes: ["srr", "mrr", "drr", "rls"], secondaryAttributes: ["cth", "cit", "awr", "cod"], source: "rec_launch_madden_v1" },
    { key: "deep_threat", label: "Deep Threat", primaryAttributes: ["spd", "acc", "drr", "rls"], secondaryAttributes: ["cth", "srr", "mrr", "cod"], source: "rec_launch_madden_v1" },
    { key: "slot", label: "Slot", primaryAttributes: ["srr", "mrr", "cod", "agi"], secondaryAttributes: ["acc", "cth", "cit", "rls"], source: "rec_launch_madden_v1" },
    { key: "physical", label: "Physical", primaryAttributes: ["rls", "spc", "cit", "cth"], secondaryAttributes: ["jmp", "str", "mrr", "drr"], source: "rec_launch_madden_v1" },
    { key: "gadget", label: "Gadget", primaryAttributes: ["cod", "agi", "acc", "spd"], secondaryAttributes: ["cth", "ret", "jkm", "spm"], source: "rec_launch_madden_v1" },
    ],
    TE: [
    { key: "vertical_threat", label: "Vertical Threat", primaryAttributes: ["spd", "acc", "drr", "spc"], secondaryAttributes: ["cth", "mrr", "rls", "srr"], source: "rec_launch_madden_v1" },
    { key: "possession", label: "Possession", primaryAttributes: ["cit", "cth", "spc", "str"], secondaryAttributes: ["rls", "srr", "mrr", "awr"], source: "rec_launch_madden_v1" },
    { key: "blocking", label: "Blocking", primaryAttributes: ["rbk", "ibl", "lbk", "str"], secondaryAttributes: ["awr", "pbk", "pbf", "rbp"], source: "rec_launch_madden_v1" },
    { key: "physical_route_runner", label: "Physical Route Runner", primaryAttributes: ["cth", "cit", "srr", "mrr"], secondaryAttributes: ["rls", "spc", "str", "drr"], source: "rec_launch_madden_v1" },
    ],
    LT: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "rec_launch_madden_v1" },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "rec_launch_madden_v1" },
    { key: "power", label: "Power", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "rec_launch_madden_v1" },
    ],
    LG: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "rec_launch_madden_v1" },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "rec_launch_madden_v1" },
    { key: "power", label: "Power", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "rec_launch_madden_v1" },
    ],
    C: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "rec_launch_madden_v1" },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "rec_launch_madden_v1" },
    { key: "power", label: "Power", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "rec_launch_madden_v1" },
    ],
    RG: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "rec_launch_madden_v1" },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "rec_launch_madden_v1" },
    { key: "power", label: "Power", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "rec_launch_madden_v1" },
    ],
    RT: [
    { key: "agile", label: "Agile", primaryAttributes: ["rbf", "rbk", "lbk", "pbf"], secondaryAttributes: ["pbk", "awr", "ibl", "rbp"], source: "rec_launch_madden_v1" },
    { key: "pass_protector", label: "Pass Protector", primaryAttributes: ["pbf", "pbk", "pbp", "awr"], secondaryAttributes: ["str", "ibl", "rbk", "rbp"], source: "rec_launch_madden_v1" },
    { key: "power", label: "Power", primaryAttributes: ["str", "rbp", "pbp", "ibl"], secondaryAttributes: ["rbk", "pbk", "awr", "lbk"], source: "rec_launch_madden_v1" },
    ],
    LE: [
    { key: "speed_rusher", label: "Speed Rusher", primaryAttributes: ["fmv", "spd", "acc", "pur"], secondaryAttributes: ["bsh", "tak", "prc", "awr"], source: "rec_launch_madden_v1" },
    { key: "power_rusher", label: "Power Rusher", primaryAttributes: ["pmv", "bsh", "str", "pow"], secondaryAttributes: ["prc", "tak", "pur", "acc"], source: "rec_launch_madden_v1" },
    { key: "run_stopper", label: "Run Stopper", primaryAttributes: ["bsh", "tak", "pur", "prc"], secondaryAttributes: ["str", "pow", "awr", "acc"], source: "rec_launch_madden_v1" },
    { key: "hybrid", label: "Hybrid", primaryAttributes: ["bsh", "fmv", "pmv", "pur"], secondaryAttributes: ["spd", "acc", "tak", "prc"], source: "rec_launch_madden_v1" },
    ],
    RE: [
    { key: "speed_rusher", label: "Speed Rusher", primaryAttributes: ["fmv", "spd", "acc", "pur"], secondaryAttributes: ["bsh", "tak", "prc", "awr"], source: "rec_launch_madden_v1" },
    { key: "power_rusher", label: "Power Rusher", primaryAttributes: ["pmv", "bsh", "str", "pow"], secondaryAttributes: ["prc", "tak", "pur", "acc"], source: "rec_launch_madden_v1" },
    { key: "run_stopper", label: "Run Stopper", primaryAttributes: ["bsh", "tak", "pur", "prc"], secondaryAttributes: ["str", "pow", "awr", "acc"], source: "rec_launch_madden_v1" },
    { key: "hybrid", label: "Hybrid", primaryAttributes: ["bsh", "fmv", "pmv", "pur"], secondaryAttributes: ["spd", "acc", "tak", "prc"], source: "rec_launch_madden_v1" },
    ],
    DT: [
    { key: "power_rusher", label: "Power Rusher", primaryAttributes: ["pmv", "bsh", "pow", "str"], secondaryAttributes: ["fmv", "acc", "prc", "tak"], source: "rec_launch_madden_v1" },
    { key: "run_stopper", label: "Run Stopper", primaryAttributes: ["bsh", "pur", "tak", "prc"], secondaryAttributes: ["str", "pow", "awr", "acc"], source: "rec_launch_madden_v1" },
    { key: "speed_rusher", label: "Speed Rusher", primaryAttributes: ["fmv", "acc", "spd", "pur"], secondaryAttributes: ["bsh", "pmv", "tak", "prc"], source: "rec_launch_madden_v1" },
    { key: "hybrid", label: "Hybrid", primaryAttributes: ["bsh", "fmv", "pmv", "tak"], secondaryAttributes: ["str", "pow", "pur", "prc"], source: "rec_launch_madden_v1" },
    ],
    LOLB: [
    { key: "pass_coverage", label: "Pass Coverage", primaryAttributes: ["zcv", "mcv", "agi", "acc"], secondaryAttributes: ["spd", "cth", "prc", "pur"], source: "rec_launch_madden_v1" },
    { key: "run_stopper", label: "Run Stopper", primaryAttributes: ["tak", "bsh", "pow", "pur"], secondaryAttributes: ["str", "prc", "awr", "pmv"], source: "rec_launch_madden_v1" },
    { key: "field_general", label: "Field General", primaryAttributes: ["awr", "prc", "pur", "tak"], secondaryAttributes: ["zcv", "mcv", "bsh", "pow"], source: "rec_launch_madden_v1" },
    ],
    MLB: [
    { key: "pass_coverage", label: "Pass Coverage", primaryAttributes: ["zcv", "mcv", "agi", "acc"], secondaryAttributes: ["spd", "cth", "prc", "pur"], source: "rec_launch_madden_v1" },
    { key: "run_stopper", label: "Run Stopper", primaryAttributes: ["tak", "bsh", "pow", "pur"], secondaryAttributes: ["str", "prc", "awr", "pmv"], source: "rec_launch_madden_v1" },
    { key: "field_general", label: "Field General", primaryAttributes: ["awr", "prc", "pur", "tak"], secondaryAttributes: ["zcv", "mcv", "bsh", "pow"], source: "rec_launch_madden_v1" },
    ],
    ROLB: [
    { key: "pass_coverage", label: "Pass Coverage", primaryAttributes: ["zcv", "mcv", "agi", "acc"], secondaryAttributes: ["spd", "cth", "prc", "pur"], source: "rec_launch_madden_v1" },
    { key: "run_stopper", label: "Run Stopper", primaryAttributes: ["tak", "bsh", "pow", "pur"], secondaryAttributes: ["str", "prc", "awr", "pmv"], source: "rec_launch_madden_v1" },
    { key: "field_general", label: "Field General", primaryAttributes: ["awr", "prc", "pur", "tak"], secondaryAttributes: ["zcv", "mcv", "bsh", "pow"], source: "rec_launch_madden_v1" },
    ],
    CB: [
    { key: "man_to_man", label: "Man-to-Man", primaryAttributes: ["mcv", "prs", "spd", "acc"], secondaryAttributes: ["cod", "agi", "cth", "prc"], source: "rec_launch_madden_v1" },
    { key: "zone", label: "Zone", primaryAttributes: ["zcv", "prc", "awr", "pur"], secondaryAttributes: ["mcv", "cth", "spd", "acc"], source: "rec_launch_madden_v1" },
    { key: "slot", label: "Slot", primaryAttributes: ["mcv", "cod", "agi", "acc"], secondaryAttributes: ["zcv", "prs", "cth", "tak"], source: "rec_launch_madden_v1" },
    { key: "press", label: "Press", primaryAttributes: ["prs", "mcv", "str", "tak"], secondaryAttributes: ["spd", "acc", "pur", "prc"], source: "rec_launch_madden_v1" },
    ],
    FS: [
    { key: "zone", label: "Zone", primaryAttributes: ["zcv", "mcv", "prc", "awr"], secondaryAttributes: ["spd", "acc", "cod", "cth"], source: "rec_launch_madden_v1" },
    { key: "hybrid", label: "Hybrid", primaryAttributes: ["mcv", "zcv", "pur", "prs"], secondaryAttributes: ["spd", "acc", "agi", "cod"], source: "rec_launch_madden_v1" },
    { key: "run_support", label: "Run Support", primaryAttributes: ["tak", "pow", "pur", "prc"], secondaryAttributes: ["awr", "zcv", "spd", "acc"], source: "rec_launch_madden_v1" },
    ],
    SS: [
    { key: "zone", label: "Zone", primaryAttributes: ["zcv", "mcv", "prc", "awr"], secondaryAttributes: ["spd", "acc", "cod", "cth"], source: "rec_launch_madden_v1" },
    { key: "hybrid", label: "Hybrid", primaryAttributes: ["mcv", "zcv", "pur", "prs"], secondaryAttributes: ["spd", "acc", "agi", "cod"], source: "rec_launch_madden_v1" },
    { key: "run_support", label: "Run Support", primaryAttributes: ["tak", "pow", "pur", "prc"], secondaryAttributes: ["awr", "zcv", "spd", "acc"], source: "rec_launch_madden_v1" },
    ],
    K: [
    { key: "power", label: "Power", primaryAttributes: ["kpw"], secondaryAttributes: ["kac", "awr"], source: "rec_launch_madden_v1" },
    { key: "accurate", label: "Accurate", primaryAttributes: ["kac"], secondaryAttributes: ["kpw", "awr"], source: "rec_launch_madden_v1" },
    ],
    P: [
    { key: "power", label: "Power", primaryAttributes: ["kpw"], secondaryAttributes: ["kac", "awr"], source: "rec_launch_madden_v1" },
    { key: "accurate", label: "Accurate", primaryAttributes: ["kac"], secondaryAttributes: ["kpw", "awr"], source: "rec_launch_madden_v1" },
    ],
  },
} as const;

export function listRecArchetypes(
  game: RecGameFamily,
  positionInput: string
): readonly RecArchetypeDefinition[] {
  const position = normalizeRecOvrPosition(positionInput);
  return REC_ARCHETYPE_CATALOG[game][position];
}

export function getRecArchetype(
  game: RecGameFamily,
  positionInput: string,
  archetypeKey: string
): RecArchetypeDefinition {
  const position = normalizeRecOvrPosition(positionInput);
  const normalizedKey = archetypeKey.trim().toLowerCase();
  const archetype = REC_ARCHETYPE_CATALOG[game][position].find(
    (candidate) => candidate.key === normalizedKey
  );
  if (!archetype) {
    throw new Error(`Unsupported ${game} ${position} archetype: ${archetypeKey}`);
  }
  return archetype;
}

export function getRecArchetypeCostMultiplier(
  game: RecGameFamily,
  positionInput: string,
  archetypeKey: string,
  attributeCode: string
): number {
  const archetype = getRecArchetype(game, positionInput, archetypeKey);
  const code = attributeCode.trim().toLowerCase();
  if (archetype.primaryAttributes.includes(code)) {
    return REC_ARCHETYPE_COST_MULTIPLIERS.primary;
  }
  if (archetype.secondaryAttributes.includes(code)) {
    return REC_ARCHETYPE_COST_MULTIPLIERS.secondary;
  }
  const position = normalizeRecOvrPosition(positionInput);
  if (code in REC_POSITION_OVR_MODELS[position].coefficients) {
    return REC_ARCHETYPE_COST_MULTIPLIERS.otherPositionRelevant;
  }
  return REC_ARCHETYPE_COST_MULTIPLIERS.irrelevant;
}

/** Every attribute code the custom-player builder covers — a custom player must have all 53
 * set, not just the ones relevant to their position/archetype (those just cost less). */
export function getRecAllAttributeCodes(): readonly string[] {
  return ALL_ATTRIBUTE_CODES;
}

export interface RecArchetypeIdentityResult {
  valid: boolean;
  requiredPrimaryAverage: number;
  primaryAverage: number;
  lowestPermittedPrimaryRating: number;
  deficientPrimaryAttributes: Array<{ attribute: string; current: number; required: number }>;
}

export function evaluateRecArchetypeIdentity(
  game: RecGameFamily,
  positionInput: string,
  archetypeKey: string,
  packageTier: RecPackageTier,
  attributes: Readonly<Record<string, number | null | undefined>>
): RecArchetypeIdentityResult {
  const archetype = getRecArchetype(game, positionInput, archetypeKey);
  const requiredPrimaryAverage = REC_ARCHETYPE_IDENTITY_FLOORS[packageTier];
  const lowestPermittedPrimaryRating = requiredPrimaryAverage - 10;
  const values = archetype.primaryAttributes.map((attribute) => {
    const raw = attributes[attribute];
    return typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(99, Math.max(0, raw))
      : 0;
  });
  const primaryAverage = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const deficientPrimaryAttributes = archetype.primaryAttributes
    .map((attribute, index) => ({ attribute, current: values[index] ?? 0, required: lowestPermittedPrimaryRating }))
    .filter((entry) => entry.current < lowestPermittedPrimaryRating);
  return {
    valid: primaryAverage >= requiredPrimaryAverage && deficientPrimaryAttributes.length <= 1,
    requiredPrimaryAverage,
    primaryAverage: Math.round(primaryAverage * 100) / 100,
    lowestPermittedPrimaryRating,
    deficientPrimaryAttributes,
  };
}
