// TODO: schedule prefill parser (not implemented).
//
// Goal: given a source describing a full season's matchups (a screenshot of the game's
// schedule screen, an exported schedule file, or similar), resolve each row's teams against
// this league's `rec_teams` and write the resulting away/home pairings into every week's
// schedule slots up front — so a commissioner starting a new season doesn't have to hand-enter
// every week's matchups through TeamScheduleForm.tsx one game at a time.
//
// This is distinct from schedule.parser.ts's existing `parseScheduleImages` /
// `previewScheduleImport` flow, which reads Madden's in-game "League Schedule" RESULTS list
// (one already-in-progress week, scores included, Madden-only) to auto-fill scores for games
// that were already played. This prefill parser runs the opposite direction and earlier in the
// lifecycle: before any games are played, filling in *who plays whom* across the whole season
// (CFB and/or Madden), not recording results.
//
// Building blocks already in this codebase worth reusing rather than re-inventing:
// - Tesseract OCR pipeline (box-score.parser.ts: fetchImageBuffer/preprocessImage/
//   recognizeWithPool/groupIntoRows) if the source ends up being a screenshot.
// - Team-name resolution (buildAbbrMap/buildNickMap in schedule.service.ts, or
//   team-name-match.ts's buildTeamNameCandidates/matchTeamByName) for matching parsed team
//   names back to rec_teams.id.
// - saveManualScheduleGame / replaceScheduleWeek (schedule.service.ts) as the write path once
//   matchups are resolved — this parser's job is producing the input to those, not writing
//   directly.
//
// Left as a stub per explicit instruction — flagged here so the next pass has a clear,
// grounded starting point instead of guessing at the source format from scratch.
export {};
