// Compatibility re-export. League creation defaults live in @rec/shared so the API and
// every client apply the same complete, game-specific snapshots.
export {
  ALL_MADDEN_ATTRIBUTE_CODES,
  BASE_TEMPLATE_PRESET,
  CFB_LEAGUE_TEMPLATES,
  CFB_TEMPLATE_PRESETS,
  LEAGUE_TEMPLATES,
  MADDEN_LEAGUE_TEMPLATES,
  MADDEN_TEMPLATE_PRESETS,
  NORMAL_CORE_ATTRIBUTES,
  REC_RECOMMENDED_CORE_ATTRIBUTES,
  describeTemplateSettings,
  getLeagueTemplatePreset,
  type LeagueTemplateId,
  type LeagueTemplateMeta,
  type LeagueTemplatePreset,
  type TemplateSettingGroup,
  type TemplateSettingRow,
} from "@rec/shared";
