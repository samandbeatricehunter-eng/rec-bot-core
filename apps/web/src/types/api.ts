// Frontend-local response shapes for the pilot endpoints — pragmatic, not exhaustive
// (matches apps/bot/src/lib/rec-api.ts's own convention of loosely-typed responses for
// most calls). Add fields here as screens need them rather than modeling every column.

export type ScheduleTeam = {
  id: string;
  name: string;
  abbreviation: string;
  conference: string | null;
  division: string | null;
};

export type TeamScheduleManualWeek = {
  weekNumber: number;
  alreadyConfirmed: boolean;
  confirmedOpponentTeamId: string | null;
  confirmedOpponentName: string | null;
  confirmedHomeAway: "home" | "away" | null;
  gameId: string | null;
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
  pendingBoxScoreSubmissionId: string | null;
};

export type TeamScheduleManualState = {
  team: { id: string; name: string; abbreviation: string };
  seasonNumber: number;
  game: string | null;
  weeks: TeamScheduleManualWeek[];
};

export type CommitDecision = { weekNumber: number; opponentTeamId: string; homeAway: "home" | "away" };
export type CommitResult = { saved: Array<{ weekNumber: number; skipped: boolean; reason?: string }> };

export type TeamManagementSummaryRow = {
  id: string;
  name: string;
  abbreviation: string | null;
  displayCity: string | null;
  displayNick: string | null;
  displayAbbr: string | null;
  conference: string;
  division: string | null;
  isRelocated: boolean;
  linkedUser: { userId: string; discordId: string | null; displayName: string | null } | null;
  scheduleStatus: "empty" | "partial" | "complete";
  gamesScheduled: number;
  gamesExpected: number;
  missingBoxScoreCount: number;
  awaitingReviewCount: number;
  record: { wins: number; losses: number; ties: number };
};

export type TeamManagementSummary = {
  league: { id: string; name: string | null; game: string | null; seasonNumber: number; currentWeek: number; gamesExpectedPerTeam: number };
  teams: TeamManagementSummaryRow[];
};

export type LinkedRosterEntry = {
  teamId: string;
  teamName: string;
  userDisplayName: string;
  record: { wins: number; losses: number; ties: number };
  powerRank: number | null;
  rankChange: number | null;
};

export type LeagueHeaderSummary = {
  league: { name: string; game: string; leaguePassword: string | null; seasonNumber: number; currentWeek: number | null; weekLabel: string };
  teams: { linked: number; cap: number; availableTeams: number };
  isGuildOwner: boolean;
};

export type LinkedTeamRow = {
  id: string;
  user_id: string;
  team: { id: string; name: string; abbreviation: string; conference: string | null } | null;
  user: { id: string; display_name: string } | null;
  discordId: string | null;
};
export type LinkedTeamsResponse = { linked: LinkedTeamRow[] };

export type OpenTeam = { id: string; name: string; abbreviation: string; conference: string | null; division: string | null };
export type OpenTeamsResponse = { openTeams: OpenTeam[]; totalTeams: number; league?: { name?: string | null } };

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
    team_stats: Record<string, { team1?: string | number | null; team2?: string | number | null }> | null;
    quarter_scores: { team1?: number[]; team2?: number[] } | null;
    team1_id: string | null;
    team2_id: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    parse_warnings: string[] | null;
    flag_reasons: string[] | null;
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

// Players to Watch
export type ClassYear = "freshman" | "sophomore" | "junior" | "senior";
export type WatchedPlayer = { id: string; teamId: string; playerName: string; position: string; classYear: ClassYear | null };
export type PerformanceTag = {
  subjectType: "player" | "unit";
  watchedPlayerId?: string | null;
  unit?: "offense" | "defense" | "special_teams" | null;
  statLines?: Array<{ statKey: string; label: string; value: number }>;
  performanceGrade: "standout" | "solid" | "neutral" | "poor";
};

// Recruiting tracker
export type RecruitStatus = "uncommitted" | "committed" | "decommitted";
export type Recruit = {
  id: string; playerName: string; position: string; homeCity: string | null; homeState: string | null;
  starRating: number; status: RecruitStatus; committedTeamId: string | null; committedTeamExternal: string | null;
  commitDate: string | null; storyId: string | null;
};

// Transfer portal tracker
export type TransferStatus = "entered_portal" | "transferred" | "withdrawn";
export type TransferEntry = {
  id: string; playerName: string; position: string; classYear: ClassYear | null;
  originTeamId: string; status: TransferStatus; destinationTeamId: string | null; destinationTeamExternal: string | null;
  entryDate: string | null; storyId: string | null;
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
  | "team_request"
  | "media";

export type CommissionerNotification = {
  id: string;
  type: CommissionerNotificationType;
  title: string;
  subtitle: string;
  amount: number | null;
  submittedBy: string | null;
  submittedByName: string | null;
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
export type CompletedCommissionerTransaction = CommissionerNotification & {
  status: string;
  statusLabel: string;
  reviewedBy: string | null;
  reviewedByName: string | null;
  completedAt: string;
  details: Array<{ label: string; value: string }>;
};
export type CompletedCommissionerTransactionsResponse = { transactions: CompletedCommissionerTransaction[] };

// Active Check resolve view (notification center)
export type ActiveCheckCandidate = { discordId: string; userId: string; teamId: string; teamName: string; label: string };
export type ActiveCheckReview = {
  event: { id: string; league_id: string; status: string; week_number: number; season_number: number };
  inactive: ActiveCheckCandidate[];
  kickMe: ActiveCheckCandidate[];
};

// EOS Award resolve view (notification center)
export type EosAwardNominee = { userId: string; discordId: string | null; displayName?: string; teamId: string; teamName: string; record: string; pointDifferential: number; metric?: number; detail?: string };
export type EosAwardPoll = {
  id: string;
  league_id: string;
  category_key: string;
  category_label: string;
  award_amount: number;
  nominee_payloads: EosAwardNominee[];
  status: string;
};

// Delete League (Phase 2)
export type LeagueWeekView = {
  league: { id: string; name: string; current_week: number | null; season_stage: string | null } | null;
  server: { id: string; guild_id: string; name: string } | null;
};
export type DeleteLeagueResult = { ok: true; leagueName: string; result: { rows_deleted: number; [key: string]: unknown } };

// Roles (Phase 2)
export type RoleMgmtMember = { discordId: string; displayName: string; username: string };
export type RoleMgmtRoleKey = "member" | "compCommittee" | "commissioner";

// Settings (Phase 2) — apps/api/src/modules/setup/setup.schemas.ts's CreateLeagueSchema has
// ~90 fields; typed loosely here rather than fully enumerated (matches the bot's own
// LeagueSetupDraft, which is similarly broad). Every field must round-trip on save — see
// SettingsHome.tsx's comment on why partial updates are unsafe.
export type LeagueSettingsDraft = Record<string, unknown> & { game?: string };

// Advance (Phase 2)
export type AdvanceGame = {
  gameId: string;
  weekNumber: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeUserId: string | null;
  awayUserId: string | null;
  homeTeamName: string;
  awayTeamName: string;
  hasBoxScore: boolean;
  existingResultSource: string | null;
  needsInput: boolean;
  isCpuGame: boolean;
  isH2h: boolean;
};
export type AdvanceWeekGames = {
  league: { id: string; name: string };
  seasonNumber: number;
  currentWeek: number;
  currentStage: string;
  games: AdvanceGame[];
  gamesNeedingInput: AdvanceGame[];
};
export type AdvanceResultInput = { gameId: string; outcome: "home" | "away" | "tie"; homeScore?: number | null; awayScore?: number | null };
export type DivisionWinnerOption = { key: string; conference: string; division: string; label: string; teams: { id: string; name: string; abbreviation: string | null }[] };
export type DivisionWinnerOptions = { league: { id: string; seasonNumber: number }; divisions: DivisionWinnerOption[] };
export type AdvanceDmPreview = {
  fromWeek: number | null;
  toWeek: number | null;
  seasonNumber: number;
  users: Array<{
    discordId: string;
    displayName: string;
    teamName: string | null;
    sections: { transactions: string | null; badges: string | null; eosProgress: string | null; powerRanking: string | null };
  }>;
};

// Commissioner Chat + Voting
export type ChatMessage = { id: string; author_discord_id: string; author_display_name: string | null; body: string; created_at: string };

export type HubReactionKey = "like" | "dislike" | "TOTY" | "COTY" | "ROTY" | "IOTY" | "HOTY";
export type HubResponse = {
  league: { id: string; name: string; game: string; seasonNumber: number; weekNumber: number; seasonStage: string };
  canManageLeague: boolean;
  store: { enabled: boolean; cfbSeasonOneLocked: boolean; products: Array<{ type: "age_reset" | "dev_upgrade" | "contract" | "player_trait" | "attribute" | "legend" | "custom_player"; label: string; locked: boolean }> };
  announcements: Array<{ id: string; title: string; body: string; season_number: number | null; week_number: number | null; published_at: string }>;
  headlines: Array<{ id: string; season: number; week: number; headline: string | null; body: string | null; image_url?: string | null; media_kind?: string | null; author_discord_id?: string | null; primary_angle: string | null; story_type: "headline" | "article" | "game_article"; notes: string[] | null; roundtable: Array<{ speaker: string; role: string; take: string }> | null; reactionCounts: { like: number; dislike: number }; myReaction: "like" | "dislike" | null; commentCount: number; created_at: string }>;
  matchups: WeeklyH2hGamesResponse;
  myTeam: any;
  powerRankings: null | { completedWeekNumber: number | null; hasPreviousWeek: boolean; teams: Array<{ teamId: string; teamName: string; abbr: string | null; isHuman: boolean; rank: number; score: number; prevRank: number | null; change: number | null }> };
  liveStreams: Array<{ id: string; url: string; watchPath: string; postedAt: string | null; user: { display_name: string | null } | null; team: { name: string; abbreviation: string | null } | null; viewCount: number; reactionCounts: { like: number; dislike: number }; myReaction: "like" | "dislike" | null }>;
  highlights: Array<{
    id: string; season_number: number; week_number: number; season_stage: string | null; message_url: string | null; content: string | null; created_at: string;
    videoUrl: string | null; user: { display_name: string | null } | null; team: { name: string; abbreviation: string | null } | null;
    viewCount: number; reactionCounts: Record<HubReactionKey, number>; myReactions: HubReactionKey[];
  }>;
};
export type ChatTopic = {
  id: string;
  title: string;
  description: string | null;
  options: string[];
  status: "open" | "closed";
  closes_at: string | null;
  created_by_discord_id: string;
  created_at: string;
  tally: number[];
  totalVotes: number;
  voters: { voterDiscordId: string; optionIndex: number }[];
};
export type WeeklyH2hGame = {
  gameId: string;
  homeTeamName: string;
  awayTeamName: string;
  status: "missing" | "awaiting_review" | "final";
  result: { homeScore: number; awayScore: number; isTie: boolean; winnerTeamName: string | null } | null;
  reactionCounts: { like: number; dislike: number };
  myReaction: "like" | "dislike" | null;
};
export type WeeklyH2hGamesResponse = { weekLabel: string; games: WeeklyH2hGame[] };
export type StoryComment = { id: string; body: string; authorName: string; created_at: string };

export type InterviewQuestion = { id: string; context: string; category: string; question: string };
export type MediaPortalResponse = {
  questions: InterviewQuestion[];
  limits: { articleSubmitted: boolean; articleStatus: string | null; interviewSubmitted: boolean; interviewStatus: string | null };
  opponent: null | { gameId: string; userId: string; discordId: string | null; teamId: string; teamName: string; seasonNumber: number; weekNumber: number };
};
export type HubMatchupSchedule = {
  currentWeek: number;
  selectedWeek: number;
  weekNumbers: number[];
  usersByConference: Array<{ conference: string; users: Array<{ userId: string; displayName: string; teamName: string; division: string | null }> }>;
  gotw: null | { pollId: string; gameId: string; status: "open" | "closed"; awayTeamId: string; homeTeamId: string; awayTeamName: string; homeTeamName: string; awayVotes: number; homeVotes: number; myVote: string | null };
  games: Array<{
    gameId: string;
    weekNumber: number;
    matchupType: "h2h" | "cpu";
    involvesMe: boolean;
    isGameOfWeek: boolean;
    homeTeamName: string;
    awayTeamName: string;
    homeConference: string | null;
    awayConference: string | null;
    homeScore: number | null;
    awayScore: number | null;
    isFinal: boolean;
    winnerTeamId: string | null;
    streams: Array<{ side: "away" | "home"; userId: string; teamName: string; streamLogId: string; url: string; watchPath: string; postedAt: string | null; viewCount: number; reactionCounts: { like: number; dislike: number }; myReaction: "like" | "dislike" | null }>;
  }>;
};

export type WagerOptionsResponse = {
  gameId: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeLabel: string;
  awayLabel: string;
  humanInvolved: boolean;
  markets: Array<{ market: string; label: string; kind: string; line: number | null; unit?: string; sides: Array<{ pick: string; label: string; odds: number }> }>;
};
export type PeerWagerBoardResponse = {
  wagers: Array<{ id: string; gameId: string; gameLabel: string; challengeType: string; market: string; pick: string; line: number | null; odds: number; stake: number; potentialPayout: number; placedByDiscordId: string; isMine: boolean; canAccept: boolean; createdAt: string }>;
};
export type ChallengeableCoachesResponse = {
  coaches: Array<{ userId: string; discordId: string | null; teamAbbr: string; conference: string }>;
};

export type MentionableCommissioner = { discordId: string; displayName: string };
export type MentionableRole = { key: "commissioner" | "coCommissioner"; roleId: string; name: string };
export type MentionableList = { members: MentionableCommissioner[]; roles: MentionableRole[] };
