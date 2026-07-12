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
export type PendingBoxScoresResponse = { submissions: PendingBoxScore[] };

export type BoxScoreSubmissionDetail = PendingBoxScore & {
  league_id: string;
  status: string;
  team_stats: Record<string, unknown> | null;
  quarter_scores: unknown;
};
