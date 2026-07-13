// Frontend-local response shapes for the pilot endpoints — pragmatic, not exhaustive
// (matches apps/bot/src/lib/rec-api.ts's own convention of loosely-typed responses for
// most calls). Add fields here as screens need them rather than modeling every column.

export type ScheduleTeam = {
  id: string;
  name: string;
  abbreviation: string;
  conference: string | null;
};

export type CfbTeamScheduleManualWeek = {
  weekNumber: number;
  alreadyConfirmed: boolean;
  confirmedOpponentTeamId: string | null;
  confirmedOpponentName: string | null;
  confirmedHomeAway: "home" | "away" | null;
  gameId: string | null;
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
  pendingBoxScoreSubmissionId: string | null;
};

export type CfbTeamScheduleManualState = {
  team: { id: string; name: string; abbreviation: string };
  seasonNumber: number;
  weeks: CfbTeamScheduleManualWeek[];
};

export type CommitDecision = { weekNumber: number; opponentTeamId: string; homeAway: "home" | "away" };
export type CommitResult = { saved: Array<{ weekNumber: number; skipped: boolean; reason?: string }> };

export type LinkedTeamRow = {
  id: string;
  user_id: string;
  team: { id: string; name: string; abbreviation: string; conference: string | null } | null;
  user: { id: string; display_name: string } | null;
  discordId: string | null;
};
export type LinkedTeamsResponse = { linked: LinkedTeamRow[] };

export type OpenTeam = { id: string; name: string; abbreviation: string; conference: string | null };
export type OpenTeamsResponse = { openTeams: OpenTeam[] };

export type LeagueIdentity = { userId: string; discordId: string | null; displayName: string };
export type LeagueIdentitiesResponse = { identities: LeagueIdentity[] };

export type PendingBoxScore = {
  id: string;
  team1_abbr: string | null;
  team2_abbr: string | null;
  home_score: number | null;
  away_score: number | null;
  week_number: number | null;
  submitted_by_discord_id: string | null;
  created_at: string;
  image_storage_url: string | null;
};

export type BoxScoreSubmissionDetail = PendingBoxScore & {
  league_id: string;
  status: string;
  team_stats: Record<string, unknown> | null;
  quarter_scores: unknown;
};

// Schedule builder: upload + OCR-submit flow (1c)
export type UploadImageResponse = { url: string };

export type BoxScoreJobResult = {
  submissionId: string;
  team1Abbr: string | null;
  team2Abbr: string | null;
  team1Score: number | null;
  team2Score: number | null;
  homeScore: number | null;
  awayScore: number | null;
  weekNumber: number;
  gameMatched: boolean;
  warnings: string[];
  flagged: boolean;
  flagReasons: string[];
  imageUrl: string | null;
};

export type BoxScoreJobStatus =
  | { status: "processing" }
  | { status: "done"; result: BoxScoreJobResult }
  | { status: "failed"; error: string; statusCode: number }
  | { status: "not_found" };

// Schedule builder: manual final-score entry (1c)
export type ManualScoreRecordResult = {
  weekNumber: number;
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  hasRealScores: boolean;
  isTie: boolean;
  outcome: "home" | "away" | "tie";
};

// Commissioner notification center (1d) — one unified shape covering ten heterogeneous
// underlying sources; see apps/api/src/modules/notifications/notifications.service.ts.
export type CommissionerNotificationType =
  | "box_score"
  | "purchase"
  | "highlight"
  | "stream"
  | "eos_payout"
  | "eos_award"
  | "active_check"
  | "weekly_score_review"
  | "wager"
  | "team_request";

export type CommissionerNotification = {
  id: string;
  type: CommissionerNotificationType;
  title: string;
  subtitle: string;
  amount: number | null;
  submittedBy: string | null;
  submittedAt: string;
  // teamId lets a box_score card deep-link straight into the schedule builder instead of a
  // standalone detail view (see 1c/1d consolidation) — null for every other type today,
  // and also null for box_score currently (the inbox row's team_id column isn't populated
  // by box-score.service.ts's insert yet; the schedule-builder deep link falls back to
  // resolving the team via sourceId/payload.submissionId instead until that's backfilled).
  teamId: string | null;
  weekNumber: number | null;
  sourceId: string | null;
  payload: Record<string, unknown> | null;
};
export type CommissionerNotificationsResponse = { notifications: CommissionerNotification[] };
