export type SliderGame = "cfb_27" | "madden_26" | "madden_27";
export type SliderSide = "shared" | "user" | "cpu";
export type SliderCategory = "gameplay" | "special_teams" | "penalties" | "wear_and_tear" | "xp" | "regression" | "age_regression";

export interface LeagueSliderDefinition {
  key: string;
  label: string;
  category: SliderCategory;
  side: SliderSide;
  min: number;
  max: number;
  defaultValue: number;
}

export interface CommunitySliderPreset {
  id: string;
  game: SliderGame;
  name: string;
  creator: string;
  description: string;
  sourceUrl: string;
  sourceVersion: string;
  values: Record<string, number>;
}

const gameplay = [
  ["qb_accuracy", "QB Accuracy"], ["pass_blocking", "Pass Blocking"],
  ["wr_catching", "WR Catching"], ["run_blocking", "Run Blocking"],
  ["ball_security", "Ball Security"], ["pass_defense_reaction", "Pass Defense Reaction Time"],
  ["interceptions", "Interceptions"], ["pass_coverage", "Pass Coverage"],
  ["tackling", "Tackling"],
] as const;

const specialTeams = [
  ["field_goal_power", "Field Goal Power"], ["field_goal_accuracy", "Field Goal Accuracy"],
  ["punt_power", "Punt Power"], ["punt_accuracy", "Punt Accuracy"],
  ["kickoff_power", "Kickoff Power"],
] as const;

const penalties = [
  ["offside", "Offside"], ["false_start", "False Start"], ["holding", "Holding"],
  ["facemask", "Facemask"], ["illegal_block_back", "Illegal Block in the Back"],
  ["roughing_passer", "Roughing the Passer"], ["defensive_pass_interference", "Defensive Pass Interference"],
] as const;

const wearAndTear = [
  ["normal_tackle", "Normal Tackle"], ["catch_tackle", "Catch Tackle"],
  ["hit_stick", "Hit Stick"], ["cut_stick", "Cut Stick"],
  ["defender_advantage", "Defender Tackle Advantage"], ["sack", "Sack"],
  ["block", "Block"], ["impact_block", "Impact Block"],
  ["per_play_recovery", "Per-Play Recovery"], ["per_timeout_recovery", "Per-Timeout Recovery"],
  ["quarter_recovery", "Between-Quarter Recovery"], ["halftime_recovery", "Halftime Recovery"],
  ["week_recovery", "Week-to-Week Recovery"],
] as const;

const positions = ["qb", "hb", "fb", "wr", "te", "ot", "og", "c", "de", "dt", "mlb", "olb", "cb", "fs", "ss", "k", "p"] as const;

function sided(rows: readonly (readonly [string, string])[], category: SliderCategory): LeagueSliderDefinition[] {
  return rows.flatMap(([key, label]) => (["user", "cpu"] as const).map((side) => ({
    key: `${side}.${key}`, label, category, side, min: 0, max: 100, defaultValue: 50,
  })));
}

function shared(rows: readonly (readonly [string, string])[], category: SliderCategory, max = 100): LeagueSliderDefinition[] {
  return rows.map(([key, label]) => ({ key: `shared.${key}`, label, category, side: "shared", min: 0, max, defaultValue: 50 }));
}

const baseCatalog = [
  ...sided(gameplay, "gameplay"), ...sided(specialTeams, "special_teams"),
  ...shared(penalties, "penalties"), ...shared(wearAndTear, "wear_and_tear"),
  ...positions.map((position) => ({ key: `xp.${position}`, label: `${position.toUpperCase()} XP`, category: "xp" as const, side: "shared" as const, min: 0, max: 300, defaultValue: 50 })),
];

const maddenOnly = [
  ...positions.map((position) => ({ key: `regression.${position}`, label: `${position.toUpperCase()} Regression`, category: "regression" as const, side: "shared" as const, min: 0, max: 300, defaultValue: 50 })),
  ...[20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35].map((age) => ({ key: `age_regression.${age}`, label: `Age ${age}${age === 35 ? "+" : ""}`, category: "age_regression" as const, side: "shared" as const, min: 0, max: 300, defaultValue: 50 })),
];

export const LEAGUE_SLIDER_CATALOGS: Record<SliderGame, LeagueSliderDefinition[]> = {
  cfb_27: baseCatalog,
  madden_26: [...baseCatalog, ...maddenOnly],
  // Madden 27 intentionally launches from the Madden 26 catalog. New Madden 27-only
  // controls can be appended under a new catalog version without changing saved builds.
  madden_27: [...baseCatalog, ...maddenOnly],
};

export const LEAGUE_SLIDER_CATALOG_VERSION: Record<SliderGame, string> = {
  cfb_27: "cfb-27-2026-08-10",
  madden_26: "madden-26-final",
  madden_27: "madden-27-m26-baseline-v1",
};

export function defaultLeagueSliderValues(game: SliderGame): Record<string, number> {
  return Object.fromEntries(LEAGUE_SLIDER_CATALOGS[game].map((slider) => [slider.key, slider.defaultValue]));
}

function both(key: string, user: number, cpu: number): Record<string, number> {
  return { [`user.${key}`]: user, [`cpu.${key}`]: cpu };
}

export const COMMUNITY_SLIDER_PRESETS: CommunitySliderPreset[] = [
  {
    id: "cfb27_noobtubetv", game: "cfb_27", name: "NoobTubeTV Dynasty", creator: "NoobTubeTV",
    description: "Heisman/All-American dynasty set with progression, transfers, gameplay, and wear-and-tear tuning.",
    sourceUrl: "https://noobtubetv.com/", sourceVersion: "2026-07-20",
    values: {
      ...both("qb_accuracy",50,45), ...both("pass_blocking",60,50), ...both("wr_catching",53,46),
      ...both("run_blocking",50,51), ...both("ball_security",40,30), ...both("interceptions",49,25),
      ...both("pass_coverage",55,5), ...both("tackling",50,50),
      "shared.normal_tackle":25,"shared.catch_tackle":28,"shared.hit_stick":38,"shared.cut_stick":38,
      "shared.defender_advantage":42,"shared.sack":36,"shared.block":25,"shared.impact_block":38,
      "shared.per_play_recovery":49,"shared.per_timeout_recovery":53,"shared.quarter_recovery":58,
      "shared.halftime_recovery":65,"shared.week_recovery":80,
      "xp.qb":155,"xp.hb":145,"xp.fb":110,"xp.wr":145,"xp.te":155,"xp.ot":120,"xp.og":120,
      "xp.c":120,"xp.de":125,"xp.dt":120,"xp.mlb":120,"xp.olb":110,"xp.cb":115,"xp.ss":120,"xp.fs":120,"xp.k":110,"xp.p":110,
    },
  },
  {
    id: "cfb27_editorial_all_american", game: "cfb_27", name: "CFB27 Editorial All-American", creator: "CFB27 Editorial",
    description: "No-switch All-American baseline verified against game version 1.005.",
    sourceUrl: "https://cfb27.com/article/cfb-27-sliders-guide-realistic-gameplay-settings-for-dynasty-and", sourceVersion: "1.005 / 2026-07-18",
    values: {
      ...both("qb_accuracy",37,32),...both("pass_blocking",51,55),...both("wr_catching",47,49),
      ...both("run_blocking",49,52),...both("ball_security",50,50),...both("pass_defense_reaction",53,51),
      ...both("interceptions",31,29),...both("pass_coverage",52,50),...both("tackling",44,50),
      ...both("field_goal_power",51,51),...both("field_goal_accuracy",45,45),...both("punt_power",54,54),
      ...both("punt_accuracy",49,49),...both("kickoff_power",50,50),
    },
  },
  {
    id: "cfb27_realsport101", game: "cfb_27", name: "RealSport101 Dynasty", creator: "RealSport101",
    description: "Community-published realism configuration for long-running CFB 27 dynasties.",
    sourceUrl: "https://realsport101.com/article/college-football-27-the-most-realistic-sliders-for-dynasty-mode", sourceVersion: "2026-07-15",
    values: { ...both("qb_accuracy",40,24),...both("pass_blocking",68,62),...both("wr_catching",40,50),...both("run_blocking",38,50),...both("ball_security",48,50),...both("interceptions",22,50),...both("pass_coverage",42,50),...both("tackling",42,50) },
  },
  {
    id: "m26_matt10", game: "madden_26", name: "Matt10 Simulation", creator: "Matt10",
    description: "Maintained All-Madden/All-Pro simulation set emphasizing blocking animations and coverage.",
    sourceUrl: "https://www.operationsports.com/matt10-madden-26-sliders/", sourceVersion: "5.0",
    values: {
      ...both("qb_accuracy",40,30),...both("pass_blocking",55,65),...both("wr_catching",48,46),
      ...both("run_blocking",40,55),...both("ball_security",45,45),...both("pass_defense_reaction",60,60),
      ...both("interceptions",40,40),...both("pass_coverage",50,50),...both("tackling",35,40),
      ...both("field_goal_power",52,52),...both("field_goal_accuracy",48,48),...both("punt_power",50,50),
      ...both("punt_accuracy",50,50),...both("kickoff_power",50,50),
      "shared.offside":70,"shared.false_start":55,"shared.holding":50,"shared.facemask":40,
      "shared.illegal_block_back":25,"shared.roughing_passer":45,"shared.defensive_pass_interference":75,
      "shared.normal_tackle":20,"shared.catch_tackle":25,"shared.hit_stick":35,"shared.cut_stick":30,
      "shared.defender_advantage":35,"shared.sack":25,"shared.block":25,"shared.impact_block":30,
      "shared.per_play_recovery":50,"shared.per_timeout_recovery":50,"shared.quarter_recovery":55,"shared.halftime_recovery":60,
    },
  },
  {
    id: "m26_armor_sword", game: "madden_26", name: "Armor & Sword All-Pro", creator: "Armor & Sword",
    description: "All-Pro franchise simulation set from a long-running Operation Sports creator.",
    sourceUrl: "https://www.operationsports.com/madden-26-armor-swords-all-pro-franchise-simulation-sliders/", sourceVersion: "2025-08-12",
    values: {
      ...both("qb_accuracy",40,40),...both("pass_blocking",50,83),...both("wr_catching",52,50),
      ...both("run_blocking",30,80),...both("ball_security",25,25),...both("pass_defense_reaction",50,50),
      ...both("interceptions",40,40),...both("pass_coverage",50,50),...both("tackling",40,40),
      ...both("field_goal_power",50,50),...both("field_goal_accuracy",32,32),...both("punt_power",50,50),
      ...both("punt_accuracy",45,45),...both("kickoff_power",50,50),
      "shared.offside":99,"shared.false_start":99,"shared.holding":79,"shared.facemask":99,
      "shared.illegal_block_back":90,"shared.roughing_passer":50,"shared.defensive_pass_interference":99,
      "shared.normal_tackle":50,"shared.catch_tackle":50,"shared.hit_stick":60,"shared.cut_stick":52,
      "shared.defender_advantage":60,"shared.sack":65,"shared.block":50,"shared.impact_block":60,
      "shared.per_timeout_recovery":50,"shared.quarter_recovery":50,"shared.halftime_recovery":50,
      "xp.qb":80,"xp.hb":120,"xp.te":88,"xp.wr":106,"xp.fb":90,"xp.ot":84,"xp.og":74,"xp.c":76,
      "xp.de":106,"xp.dt":82,"xp.mlb":90,"xp.olb":88,"xp.cb":104,"xp.fs":112,"xp.ss":114,"xp.k":100,"xp.p":100,
      "regression.qb":120,"regression.hb":80,"regression.te":100,"regression.wr":100,"regression.fb":100,
      "regression.ot":80,"regression.og":90,"regression.c":90,"regression.de":90,"regression.dt":100,
      "regression.mlb":90,"regression.olb":90,"regression.cb":90,"regression.fs":90,"regression.ss":90,"regression.k":100,"regression.p":100,
    },
  },
  {
    id: "m26_salem_clara", game: "madden_26", name: "SalemChief & Clara Progression", creator: "SalemChief & Clara",
    description: "XP and regression model tested across sixteen decade-long Franchise simulations.",
    sourceUrl: "https://www.operationsports.com/salemchief-clara-madden-26-xp-sliders/", sourceVersion: "v13",
    values: {
      "xp.qb":90,"xp.hb":114,"xp.te":114,"xp.wr":118,"xp.fb":84,"xp.ot":138,"xp.og":128,"xp.c":144,
      "xp.de":128,"xp.dt":110,"xp.mlb":130,"xp.olb":136,"xp.cb":138,"xp.fs":138,"xp.ss":134,"xp.k":84,"xp.p":84,
      "regression.qb":80,"regression.hb":130,"regression.te":110,"regression.wr":90,"regression.fb":90,"regression.ot":90,"regression.og":90,"regression.c":100,
      "regression.de":100,"regression.dt":120,"regression.mlb":110,"regression.olb":110,"regression.cb":120,"regression.fs":130,"regression.ss":120,"regression.k":90,"regression.p":90,
      "age_regression.20":100,"age_regression.21":100,"age_regression.22":100,"age_regression.23":100,"age_regression.24":100,"age_regression.25":100,
      "age_regression.26":90,"age_regression.27":90,"age_regression.28":90,"age_regression.29":90,"age_regression.30":90,"age_regression.31":90,
      "age_regression.32":80,"age_regression.33":80,"age_regression.34":80,"age_regression.35":70,
    },
  },
];

// Madden 27 uses the Madden 26 community baselines until dedicated, complete M27 sets mature.
export function communitySliderPresetsFor(game: SliderGame): CommunitySliderPreset[] {
  if (game === "madden_27") {
    return COMMUNITY_SLIDER_PRESETS.filter((preset) => preset.game === "madden_26").map((preset) => ({
      ...preset, id: preset.id.replace("m26_", "m27_"), game: "madden_27", name: `${preset.name} (M27 baseline)`,
      description: `${preset.description} Imported as a provisional Madden 27 baseline.`,
    }));
  }
  return COMMUNITY_SLIDER_PRESETS.filter((preset) => preset.game === game);
}

export function resolveLeagueSliderValues(game: SliderGame, presetId?: string | null, overrides: Record<string, number> = {}): Record<string, number> {
  const preset = communitySliderPresetsFor(game).find((candidate) => candidate.id === presetId);
  const allowed = new Set(LEAGUE_SLIDER_CATALOGS[game].map((slider) => slider.key));
  return Object.fromEntries(Object.entries({ ...defaultLeagueSliderValues(game), ...(preset?.values ?? {}), ...overrides }).filter(([key]) => allowed.has(key)));
}
