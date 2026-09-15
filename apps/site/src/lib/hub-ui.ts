// Local re-export shim — replaces @rec/hub-ui after consolidation.
// All apps/site imports of @rec/hub-ui resolve here via the Vite alias.

export { InjectedAuthProvider, useAuth, useReadyAuth } from "./injected-auth-context.js";
export { LeagueThemeProvider, useLeagueTheme } from "./league-theme-context.js";
export { HubChromeProvider, useHubChrome } from "./hub-chrome-context.js";
export { MatchupCard } from "../components/matchups/MatchupCard.js";
export { HeroMatchupBreakdown } from "../components/hub/HeroMatchupBreakdown.js";
export { TeamLogo } from "../components/ui/TeamLogo.js";
export type { MatchupPreview, NflPlayoffPicture } from "../types/api.js";
export { PlayerOfWeekCard, type PlayerOfWeekCardWinner } from "../components/hub/PlayerOfWeekCard.js";
export { ProspectCard, type ProspectCardData } from "../components/hub/ProspectCard.js";
export { ProTrackerCard, type ProTrackerPlayerLine } from "../components/hub/ProTrackerCard.js";
export type { HubMatchupGame } from "../types/api.js";
export { AdvanceStatusDrawer } from "../components/league-mgmt/AdvanceStatusDrawer.js";
export { AdvanceStatusProvider, useAdvanceStatus } from "./advance-status-context.js";
export { ImportStatusDrawer } from "../components/import/ImportStatusDrawer.js";
export { ImportStatusProvider, useImportStatus } from "./import-status-context.js";
export { HighlightUploadDrawer } from "../components/hub/HighlightUploadDrawer.js";
export { HighlightUploadProvider, useHighlightUpload } from "./highlight-upload-context.js";
