// Static dropdown/select option lists for CreateLeagueWizard, split out of the wizard
// component itself purely because of file size — none of this has any state or behavior.

export type GameKey = "madden_26" | "madden_27" | "cfb_27";

export const GAME_OPTIONS: { value: GameKey; label: string }[] = [
  { value: "madden_26", label: "Madden 26" },
  { value: "madden_27", label: "Madden 27" },
  { value: "cfb_27", label: "CFB 27" },
];

export const MADDEN_LEAGUE_TYPES = [
  { value: "regular_rosters", label: "Regular Rosters", desc: "Start with real NFL rosters. Trades, free agency, and the draft work as expected." },
  { value: "fantasy_draft", label: "Fantasy Draft", desc: "Every team is emptied and users draft brand-new rosters from scratch. You can schedule a draft date at the end of setup." },
  { value: "custom_rosters", label: "Custom Rosters", desc: "Import a custom roster file before starting. Useful for roster sharing communities." },
] as const;

export const CFB_ROSTER_OPTIONS = [
  { value: "activeRosters", label: "Active Rosters", desc: "Seed the league with the current CFB baseline dataset. Recommended for most leagues." },
  { value: "trackRosters", label: "Track Rosters", desc: "Enable recruiting, transfer portal, and roster progression tracking. Only check this if your league uses REC's dynasty tracking features." },
] as const;

export const MADDEN_DIFFICULTY = [
  { value: "rookie", label: "Rookie" },
  { value: "pro", label: "Pro" },
  { value: "all_pro", label: "All-Pro" },
  { value: "all_madden", label: "All-Madden" },
];

export const CFB_DIFFICULTY = [
  { value: "freshman", label: "Freshman" },
  { value: "varsity", label: "Varsity" },
  { value: "all_american", label: "All-American" },
  { value: "heisman", label: "Heisman" },
];

export const MADDEN_SEASON_STAGES = [
  "preseason_training_camp", "regular_season", "wild_card", "divisional",
  "conference_championship", "super_bowl", "offseason", "draft",
] as const;

export const CFB_SEASON_STAGES = [
  "preseason", "regular_season", "wild_card", "divisional",
  "conference_championship", "national_championship", "offseason", "draft",
] as const;

export const STREAMING_OPTIONS = [
  { value: "required", label: "Required" },
  { value: "recommended", label: "Recommended" },
  { value: "disabled", label: "Disabled" },
];

export const STREAMING_SIDE_OPTIONS = [
  { value: "home", label: "Home" },
  { value: "away", label: "Away" },
  { value: "either", label: "Either" },
  { value: "both", label: "Both" },
];

export const FOURTH_DOWN_OPTIONS = [
  { value: "none", label: "None" },
  { value: "standard_rec", label: "Standard REC" },
  { value: "custom", label: "Custom" },
];

export const INJURY_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on_standard", label: "On (Standard)" },
  { value: "on_reduced", label: "On (Reduced)" },
];

export const ADVANCE_TIMING_OPTIONS = [
  { value: "24hr", label: "24 Hours" },
  { value: "48hr", label: "48 Hours" },
  { value: "72hr", label: "72 Hours" },
  { value: "other", label: "Custom" },
];

export const BALL_HAWK_OPTIONS = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
  { value: "keep_individual", label: "Keep Individual" },
];

export const COACH_FIRING_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
  { value: "cpu_only", label: "CPU Teams Only" },
];

export const POSITION_CHANGE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "restricted", label: "Restricted" },
  { value: "highly_restricted", label: "Highly Restricted" },
];

export const TRADE_APPROVAL_OPTIONS = [
  { value: "no_approval_required", label: "No Approval Required" },
  { value: "commissioner_review", label: "Commissioner Review" },
  { value: "competition_committee_review", label: "Competition Committee Review" },
];

export const CPU_TRADING_OPTIONS = [
  { value: "allowed", label: "Allowed" },
  { value: "restricted", label: "Restricted" },
  { value: "not_allowed", label: "Not Allowed" },
];

export const TRADE_DIFFICULTY_OPTIONS = [
  { value: "very_easy", label: "Very Easy" },
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
  { value: "very_hard", label: "Very Hard" },
];

export const FA_MOTIVATION_IMPACT_OPTIONS = [
  { value: "off", label: "Off (None)" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very High" },
];

export const CFB_RECRUITING_DIFFICULTY = [
  { value: "easy", label: "Easy" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Hard" },
];

export const CFB_DYNASTY_TYPE = [
  { value: "real", label: "Real Rosters" },
  { value: "mixed", label: "Mixed (Team Builder Allowed)" },
];

export const PLAYER_EDIT_PERMISSION_OPTIONS = [
  { value: "commish_only", label: "Commissioner Only" },
  { value: "any_player", label: "Any Player" },
  { value: "none", label: "None" },
];

export const SEASON_EXPERIENCE_OPTIONS = [
  { value: "full_control", label: "Full Control" },
  { value: "customized", label: "Customized" },
  { value: "simple", label: "Simple" },
];

export const CHAMP_GAME_LOCATION_OPTIONS = [
  { value: "conference_leader_home", label: "Conference Leader's Home Stadium" },
  { value: "any_stadium", label: "Any Stadium" },
];

export const CHAMP_GAME_CRITERIA_OPTIONS = [
  { value: "conference_record", label: "Conference Record" },
  { value: "division_winners", label: "Division Winners" },
];

export const CFB_CONFERENCE_REALIGNMENT = [
  { value: "allowed", label: "Allowed" },
  { value: "locked", label: "Locked" },
];
