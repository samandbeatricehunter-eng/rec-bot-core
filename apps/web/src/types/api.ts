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
  confirmedMatchupType: "h2h" | "cpu" | null;
  gameId: string | null;
  result: { homeScore: number; awayScore: number; isTie: boolean; source: string } | null;
  pendingBoxScoreSubmissionId: string | null;
  boxScoreSubmissionId: string | null;
  boxScoreStatus: string | null;
  isBye: boolean;
  byeType: "regular_season" | "cfp_first_round";
  postseasonRound: string | null;
  bowlName: string | null;
  isBowlGame: boolean;
  isNationalChampionship: boolean;
  rivalry: {
    enabled: boolean;
    optedOut: boolean;
    details: null | {
      id: string; rivalry_name: string; team_a_id: string; team_b_id: string;
      first_year_played: number | null; team_a_wins: number; team_b_wins: number; ties: number;
      last_game_team_a_score: number | null; last_game_team_b_score: number | null;
      streak_winner_team_id: string | null; streak_length: number; is_seeded: boolean;
    };
  };
};

export type TeamScheduleManualState = {
  team: { id: string; name: string; abbreviation: string };
  seasonNumber: number;
  game: string | null;
  weeks: TeamScheduleManualWeek[];
};

export type CommitDecision = {
  weekNumber: number;
  opponentTeamId: string;
  homeAway: "home" | "away";
  postseasonRound?: string | null;
  bowlName?: string | null;
  isBowlGame?: boolean;
  isNationalChampionship?: boolean;
};
export type CommitByeWeeks = number[];
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
  image_urls: string[] | null;
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
export type RecruitStatus = "undecided" | "visit_scheduled" | "verbal_commit" | "hard_commit" | "signed" | "recruiting_battle" | "committed_elsewhere";
export type Recruit = {
  id: string; playerName: string; position: string; homeCity: string | null; homeState: string | null;
  starRating: number; status: RecruitStatus; committedTeamId: string | null; committedTeamExternal: string | null;
  commitDate: string | null; storyId: string | null; heightInches: number | null; weightLbs: number | null;
  submittedByUserId: string | null;
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
  | "media"
  | "game_of_the_year"
  | "legend"
  | "force_win_request"
  | "autopilot_request"
  | "matchup_issue_report";

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
  internalMemo: string | null;
  votingTopicId: string | null;
  awaitingUserResponse: boolean;
  displayStatus: import("@rec/shared").CaseDisplayStatus;
};
export type CommissionerNotificationsResponse = { notifications: CommissionerNotification[] };
export type CommissionerCaseEvent = {
  id: string;
  eventType: string;
  priorState: Record<string, unknown> | null;
  nextState: Record<string, unknown> | null;
  createdAt: string;
};
export type CompletedCommissionerTransaction = CommissionerNotification & {
  status: string;
  statusLabel: string;
  reviewedBy: string | null;
  reviewedByName: string | null;
  completedAt: string;
  details: Array<{ label: string; value: string }>;
};
export type CompletedCommissionerTransactionsResponse = { transactions: CompletedCommissionerTransaction[] };

export type HighlightReviewDetail = {
  streamUid: string | null;
  videoUrl: string | null;
  messageUrl: string | null;
  weekNumber: number | null;
  seasonStage: string | null;
  submittedByName: string | null;
  matchup: { weekNumber: number | null; homeTeamName: string | null; awayTeamName: string | null } | null;
};

// Aggregate "N pending items in {league}" bell summary — one row per league, not one per item.
export type CommissionerPendingSummary = {
  leagueId: string;
  leagueName: string;
  game: string;
  gameLabel: string;
  pendingCount: number;
  latestCreatedAt: string;
  unread: boolean;
};

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

export type EosAwardVotingPoll = {
  id: string;
  categoryKey: string;
  categoryLabel: string;
  amount: number;
  nominees: Array<EosAwardNominee & { votes: number }>;
  myVote: string | null;
};
export type EosBallotSessionInfo = { status: "draft" | "submitted"; lastPollId: string | null; submittedAt: string | null };

// Delete League (Phase 2)
export type LeagueWeekView = {
  league: { id: string; name: string; current_week: number | null; season_stage: string | null } | null;
  server: { id: string; guild_id: string; name: string } | null;
};
export type DeleteLeagueResult = { ok: true; leagueName: string; result: { rows_deleted: number; [key: string]: unknown } };

// Roles (Phase 2)
export type RoleMgmtMember = { discordId: string; displayName: string; username: string; managedRole: RoleMgmtRoleKey };
export type TeamLinkMatrix = {
  league: { id: string; name: string };
  teams: Array<{ id: string; name: string; abbreviation: string; conference: string | null; division: string | null; discordId: string | null }>;
  users: Array<{ discordId: string; displayName: string; username: string }>;
};
export type PlayerStatSubmission = { id:string; seasonNumber:number; seasonStage:string; weekNumber:number|null; teamId:string; teamName:string; gameId:string; submittedByDiscordId:string; playerName:string; status:"draft"|"submitted"|"approved"|"rejected"; reviewedByDiscordId:string|null; reviewedAt:string|null; createdAt:string; lines:Array<{id:string;category:string;stats:Record<string,number>;updatedAt:string}> };
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
  isBowlGame: boolean;
  isNationalChampionship: boolean;
};
export type AdvanceWeekGames = {
  league: { id: string; name: string };
  seasonNumber: number;
  currentWeek: number;
  currentStage: string;
  nextWeekNumber: number;
  nextSeasonStage: string;
  nextLabel: string;
  games: AdvanceGame[];
  gamesNeedingInput: AdvanceGame[];
};
export type AdvanceResultInput = { gameId: string; outcome: "home" | "away" | "tie"; homeScore?: number | null; awayScore?: number | null };
export type GotwCandidateBreakdown = { rivalry: number; parity: number; quality: number; recentForm: number; repeatPenalty: number; total: number };
export type GotwCandidate = {
  gameId: string; weekNumber: number;
  awayTeamId: string; homeTeamId: string;
  awayTeamName: string; homeTeamName: string;
  awayUserId: string | null; homeUserId: string | null;
  isRivalry: boolean; rivalryName: string | null;
  breakdown: GotwCandidateBreakdown; score: number; recommended: boolean;
};
export type DivisionWinnerOption = { key: string; conference: string; division: string; label: string; teams: { id: string; name: string; abbreviation: string | null }[] };
export type DivisionWinnerOptions = { league: { id: string; seasonNumber: number }; divisions: DivisionWinnerOption[] };

export type RecPayoutTier = "S" | "A" | "B" | "C" | "D";
export type RecTierProgress = {
  currentTier: RecPayoutTier | null;
  currentAmount: number;
  nextTier: { tier: RecPayoutTier; amount: number; threshold: number; operator: string } | null;
  percent: number;
};
export type EosPayoutProgressCard = {
  key: string;
  label: string;
  currentValue: number;
  progress: RecTierProgress;
  tiers: Array<{ tier: RecPayoutTier; amount: number; threshold: number; operator: string }>;
  direction: "higher_is_better" | "lower_is_better";
  triggerNote?: string;
  currentAwardedName?: string | null;
};
export type CommissionerPollAnswerCount = { id: number; count: number; me_voted: boolean };
export type CommissionerPollResults = { question: string; answers: Array<{ id: number; text: string }>; isFinalized: boolean; answerCounts: CommissionerPollAnswerCount[] } | null;
export type CommissionerPoll = {
  id: string;
  league_id: string;
  season_number: number;
  question: string;
  options: Array<{ id: number; text: string }>;
  status: "open" | "closed" | "cancelled";
  discord_channel_id: string | null;
  discord_message_id: string | null;
  created_by_user_id: string | null;
  closes_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  tally: Array<{ id: number; text: string; votes: number }>;
  totalVotes: number;
  hasVoted?: boolean;
  myVoteOptionId?: number | null;
};
export type MyEosPayoutProgress = {
  seasonNumber: number;
  teamStats: EosPayoutProgressCard[];
  ranking: (EosPayoutProgressCard & { rank: number | null }) | null;
};
export type EosLedgerLineItem = {
  id: string;
  payoutCategory: string;
  payoutLabel: string;
  qualifiedTier: RecPayoutTier | null;
  qualifiedValue: number;
  amount: number;
  availableTiers: Array<{ tier: RecPayoutTier; amount: number; threshold: number; operator: string }>;
};
export type EosLedger = {
  userId: string;
  displayName: string;
  teamName: string | null;
  discordId: string | null;
  items: EosLedgerLineItem[];
  total: number;
};
export type PendingEosLedgers = { batch: { id: string; seasonNumber: number } | null; ledgers: EosLedger[] };

export type CfbRosterSeedStatus = {
  league: { id: string; name: string | null; game: string | null };
  isCfb: boolean;
  dataset: { id: string; game_title: string; published_date: string } | null;
  seeded: boolean;
  teams: { total: number; stamped: number };
  players: { total: number; defaultPlayers: number; active: number; withClassYear: number };
};
export type CfbRollForwardResult = { advanced: number; graduated: number; skipped: number; total: number };
export type CfbBaselineApplyResponse = {
  result: { teamsUpdated: number; playersCreated: number; skipped: { teams: number; players: number } };
  status: CfbRosterSeedStatus;
};
export type CfbRollForwardResponse = { result: CfbRollForwardResult; status: CfbRosterSeedStatus };

export type GotwPollStatus = { id: string; game_id: string; status: string; away_team_name: string; home_team_name: string };
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

export type HubReactionKey = "love" | "like" | "dislike" | "poop" | "TOTY" | "COTY" | "ROTY" | "IOTY" | "HOTY" | "MVP_PLAY" | "MOSSED" | "STEAMROLLER" | "FAWKKKK" | "SNATCHED" | "RIP";
export type HubResponse = {
  league: { id: string; name: string; game: string; seasonNumber: number; weekNumber: number; seasonStage: string };
  canManageLeague: boolean;
  commissionerTier: "commissioner" | "co_commissioner" | null;
  store: { enabled: boolean; cfbSeasonOneLocked: boolean; products: Array<{ type: "age_reset" | "dev_upgrade" | "contract" | "player_trait" | "attribute" | "legend" | "custom_player"; label: string; locked: boolean }> };
  announcements: Array<{ id: string; title: string; body: string; season_number: number | null; week_number: number | null; published_at: string }>;
  headlines: Array<{ id: string; season: number; week: number | null; season_stage?: string | null; headline: string | null; body: string | null; image_url?: string | null; media_kind?: string | null; author_discord_id?: string | null; primary_angle: string | null; story_type: "headline" | "article" | "game_article"; notes: string[] | null; roundtable: Array<{ speaker: string; role: string; take: string }> | null; reactionCounts: { like: number; dislike: number }; myReaction: "like" | "dislike" | null; commentCount: number; created_at: string }>;
  matchups: WeeklyH2hGamesResponse;
  myTeam: any;
  powerRankings: null | { completedWeekNumber: number | null; hasPreviousWeek: boolean; teams: Array<{ teamId: string; teamName: string; abbr: string | null; conference: string | null; isHuman: boolean; rank: number; score: number; prevRank: number | null; change: number | null }> };
  sos: null | { totalTeams: number; viewerTeamId: string | null; teams: Array<{ teamId: string; teamName: string; abbr: string | null; isHuman: boolean; rank: number; sosFull: number; sosRemaining: number; humanCount: number; cpuCount: number; oppRecord: number }> };
  coachRatings: null | { displayAsGrade: boolean; viewerTeamId: string | null; teams: Array<{ teamId: string; teamName: string; abbr: string | null; userId: string | null; rank: number; rating: number; grade: string; record: string; sos: number; madePlayoffs: boolean }> };
  userRatings: null | { displayAsGrade: boolean; viewerUserId: string | null; users: Array<{ userId: string; displayName: string; teamId: string | null; teamName: string | null; rank: number; rating: number; grade: string; statScore: number; badgeScore: number }> };
  liveStreams: Array<{ id: string; url: string; watchPath: string; postedAt: string | null; user: { display_name: string | null; username?: string | null } | null; team: { name: string; abbreviation: string | null } | null; awayTeamName: string | null; homeTeamName: string | null; matchupLabel: "H2H" | "CPU" | null; viewCount: number; reactionCounts: { like: number; dislike: number }; myReaction: "like" | "dislike" | null }>;
  highlights: Array<{
    id: string; user_id?: string | null; season_number: number; week_number: number; season_stage: string | null; message_url: string | null; content: string | null; created_at: string;
    videoUrl: string | null; streamUid?: string | null; iframeUrl?: string | null; user: { username?: string | null; display_name: string | null } | null; team: { name: string; abbreviation: string | null } | null;
    matchupLabel?: string | null; matchupParticipants?: { away: string; home: string } | null; viewCount: number; reactionCounts: Record<HubReactionKey, number>; myReactions: HubReactionKey[];
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
  audience?: "commissioners" | "league";
};
export type PublicPoll = {
  id: string;
  title: string;
  description: string | null;
  options: string[];
  status: "open" | "closed";
  closes_at: string | null;
  created_at: string;
  tally: number[];
  totalVotes: number;
  myVoteOptionIndex: number | null;
};
export type ChatAttachment = {
  id: string;
  messageId: string;
  originalUrl: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number | null;
};
// League Chat + Game Chat (Campus Buzz "Chat" tab)
export type LeagueChatMessage = {
  id: string;
  author_user_id: string | null;
  author_discord_id: string | null;
  author_display_name: string;
  is_discord_only: boolean;
  body: string;
  created_at: string;
};
export type LeagueChatMember = {
  userId: string;
  discordId: string | null;
  username: string | null;
  displayName: string;
  isRegistered: boolean;
  isDiscordOnly: boolean;
  online: boolean;
  lastSeenAt: string | null;
};
export type GameChatChannel = { gameChannelId: string; gameId: string | null; label: string; awayTeamName: string; homeTeamName: string };
export type GameChatMessage = {
  id: string;
  author_user_id: string | null;
  author_discord_id: string | null;
  author_display_name: string;
  is_discord_only: boolean;
  source: "site" | "discord" | "system";
  body: string;
  created_at: string;
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

export type InterviewQuestion = { id: string; topic: string; question: string };
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
  gotw: null | { pollId: string; gameId: string; status: "open" | "closed"; canVote: boolean; awayTeamId: string; homeTeamId: string; awayTeamName: string; homeTeamName: string; awayVotes: number; homeVotes: number; myVote: string | null };
  games: Array<{
    gameId: string;
    weekNumber: number;
    matchupType: "h2h" | "human_cpu" | "cpu";
    involvesMe: boolean;
    viewerSide: "away" | "home" | null;
    isGameOfWeek: boolean;
    gotw: null | { pollId: string; gameId: string; status: "open" | "closed"; canVote: boolean; awayTeamId: string; homeTeamId: string; awayTeamName: string; homeTeamName: string; awayVotes: number; homeVotes: number; myVote: string | null };
    homeTeamId: string | null;
    awayTeamId: string | null;
    homeTeamName: string;
    awayTeamName: string;
    homeTeamMascot: string;
    awayTeamMascot: string;
    homeTeamColor: string;
    awayTeamColor: string;
    rivalryName: string | null;
    homeConference: string | null;
    awayConference: string | null;
    homeScore: number | null;
    awayScore: number | null;
    isFinal: boolean;
    wageringOpen: boolean;
    winnerTeamId: string | null;
    boxScoreSubmissionId: string | null;
    boxScoreStatus: string | null;
    boxScoreDeniedReason: string | null;
    reactionCounts: Record<"love" | "like" | "goty" | "dislike" | "poop", number>;
    myReactions: Array<"love" | "like" | "goty" | "dislike" | "poop">;
    myGotyComment?: string | null;
    streams: Array<{ side: "away" | "home"; userId: string; teamName: string; streamLogId: string; url: string; watchPath: string; postedAt: string | null; viewCount: number; reactionCounts: { like: number; dislike: number }; myReaction: "like" | "dislike" | null }>;
  }>;
  isOffseason: boolean;
  offseasonStageLabel: string | null;
};
export type HubMatchupGame = HubMatchupSchedule["games"][number];
export type MatchupChatMessage = { id: string; author_user_id: string; author_display_name: string; body: string; created_at: string };
export type H2hMatchupRecord = {
  leagueName: string;
  game: string | null;
  seasonNumber: number | null;
  weekNumber: number | null;
  userTeamName: string | null;
  opponentTeamName: string | null;
  userScore: number | null;
  opponentScore: number | null;
  result: "win" | "loss" | "tie";
  playedAt: string | null;
};
export type HubMatchupDetail = {
  matchup: HubMatchupGame;
  streamFeature?: {
    streamingSide: "home" | "away" | "either" | "both" | string;
    primaryStreamLogId: string | null;
    secondaryStreamLogId: string | null;
  } | null;
  gotw: HubMatchupSchedule["gotw"];
  h2hHistory: H2hMatchupRecord[];
  lastMatchup: H2hMatchupRecord | null;
  messages: MatchupChatMessage[];
};

export type MatchupTeamBreakdown = {
  teamId: string;
  teamName: string;
  abbr: string | null;
  primaryColor: string;
  conference: string | null;
  isHuman: boolean;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  pointsPerGame: number;
  pointsAllowedPerGame: number;
  pointDifferential: number;
  avgMargin: number;
  last5: Array<"W" | "L" | "T">;
  streak: string;
  winPct: number;
  coachRating: number | null;
  coachGrade: string | null;
  powerRank: number | null;
};
export type MatchupPreview = {
  gameId: string;
  weekNumber: number;
  matchupType: "h2h" | "human_cpu" | "cpu";
  displayAsGrade: boolean;
  hasSeasonData: boolean;
  away: MatchupTeamBreakdown;
  home: MatchupTeamBreakdown;
  prediction: {
    awayWinProbability: number;
    homeWinProbability: number;
    favoredSide: "home" | "away" | "even";
    predictedAwayScore: number;
    predictedHomeScore: number;
    summary: string;
  };
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
export type RosterPlayer = {
  id: string;
  fullName: string;
  position: string;
  positionGroup: string;
  heightInches: number | null;
  weightLbs: number | null;
  handedness: string | null;
  classYear: string | null;
  overallRating: number | null;
  rosterStatus: string;
  isDefaultPlayer: boolean;
  recentIncrease: number | null;
  devTrait: string | null;
};
export type RosterPositionGroup = {
  group: string;
  grade: string;
  avgOverall: number | null;
  playerCount: number;
};
export type TradeLegInput = { type: "player"; playerId: string } | { type: "pick"; draftPickId: string };
export type TradeStatus = "pending_response" | "accepted" | "pending_review" | "applied" | "declined" | "withdrawn" | "rejected";
export type TradeLeg = { id: string; leg_type: "player" | "pick"; player_id: string | null; draft_pick_id: string | null; from_team_id: string; to_team_id: string };
export type Trade = {
  id: string; league_id: string; season_number: number;
  proposing_team_id: string; proposing_user_id: string;
  receiving_team_id: string; receiving_user_id: string;
  proposing_coins: number; receiving_coins: number;
  status: TradeStatus; approval_policy_snapshot: string;
  reviewed_by_discord_id: string | null; review_note: string | null;
  proposed_at: string; accepted_at: string | null; applied_at: string | null;
  declined_at: string | null; withdrawn_at: string | null; rejected_at: string | null;
};
export type DraftPickChainLink = { fromTeamId: string | null; toTeamId: string | null; reason: string | null; at: string };
export type TeamDraftPick = {
  id: string;
  seasonNumber: number;
  round: number;
  pickNumber: number | null;
  originalTeamId: string;
  originalTeamName: string;
  isOwnPick: boolean;
  manualLock: boolean;
  adminNotes: string | null;
  tradeChain: DraftPickChainLink[];
};
export type TeamRosterResponse = {
  team: { id: string; name: string | null; abbreviation: string | null };
  players: RosterPlayer[];
  positionGroups: RosterPositionGroup[];
  draftPicks: TeamDraftPick[];
  canEditRosterStatus: boolean;
};
export type TurnoverKind = "interceptions_thrown" | "fumbles_lost" | "interceptions_made" | "forced_fumble";
export type AssignableBoxScoreStats = {
  teamId: string;
  categories: Partial<Record<"passing" | "rushing", Array<{ statKey: string; label: string; value: number }>>>;
  turnovers: Partial<Record<TurnoverKind, number>>;
};
export type RosterDepartureStatus = "drafted" | "transferred_out" | "retired" | "graduated";
export type RosterLifecycleResult = { id: string; full_name: string; roster_status: string };
export type WeekWagerLinesResponse = {
  lines: Array<{
    gameId: string;
    homeLabel: string;
    awayLabel: string;
    moneyline: { homeOdds: number; awayOdds: number } | null;
    spread: { line: number; odds: number } | null;
    total: { line: number; odds: number } | null;
  }>;
};
export type PeerWagerBoardResponse = {
  wagers: Array<{ id: string; gameId: string; gameLabel: string; challengeType: string; market: string; marketLabel: string; pick: string; pickLabel: string; line: number | null; odds: number; stake: number; potentialPayout: number; placedByDiscordId: string; placedByName: string; acceptedByName: string | null; isMine: boolean; canAccept: boolean; canEdit: boolean; createdAt: string; status?: string; boardState?: "open" | "active" }>;
};
export type MyWagersResponse = {
  wagers: Array<{ id: string; gameId: string | null; gameLabel: string; weekNumber: number; wagerKind: string; challengeType: string | null; market: string; marketLabel: string; pickLabel: string; stake: number; potentialPayout: number; status: string; boardState: "open" | "active" | "settled"; placedByName: string; acceptedByName: string | null; isMine: boolean; canEdit: boolean; canCancel: boolean; settledAt: string | null; createdAt: string }>;
};
export type ReversibleTransaction = {
  id: string;
  amount: number;
  transaction_type: string;
  description: string;
  source: string;
  source_reference: Record<string, unknown> | null;
  created_at: string;
  reversible: boolean;
};
export type ReversibleTransactionsResponse = { userId: string; transactions: ReversibleTransaction[] };
export type ChallengeableCoachesResponse = {
  coaches: Array<{ userId: string; discordId: string | null; teamAbbr: string; conference: string }>;
};
export type OpenWagersForCommissionerResponse = {
  wagers: Array<{
    id: string;
    gameId: string | null;
    gameLabel: string;
    wagerKind: string;
    challengeType: string | null;
    market: string;
    marketLabel: string;
    pick: string;
    pickLabel: string;
    line: number | null;
    odds: number;
    stake: number;
    potentialPayout: number;
    status: string;
    seasonNumber: number;
    weekNumber: number;
    placedByName: string;
    acceptedByName: string | null;
    createdAt: string;
  }>;
};

export type StorePurchaseContext = {
  seasonNumber: number;
  wallet: number;
  coreAttributes: string[];
  coreAttributeDefaultCap: number;
  coreAttributeCapOverrides: Record<string, number>;
  coreAttributeGroupCap: number;
  nonCoreAttributeCap: number;
  nonCoreAttributeCapOverrides: Record<string, number>;
  usedCoreByCode: Record<string, number>;
  usedNonCoreByCode: Record<string, number>;
  usedCore: number;
  usedNonCore: number;
  seasonCaps: Partial<Record<"age_reset" | "dev_upgrade" | "contract" | "player_trait" | "legend" | "custom_player", number>>;
  seasonActive: Record<string, number>;
};

export type HeismanCandidate = {
  id: string;
  player_name: string;
  team_id: string | null;
  team_name: string | null;
  team_abbreviation: string | null;
  created_at: string;
};

export type HeismanRaceState = {
  seasonNumber: number;
  candidates: HeismanCandidate[];
  closed: boolean;
  winnerCandidateId: string | null;
  winnerName: string | null;
  awardedAt: string | null;
};

export type CfpPostseasonState = {
  seasonNumber: number;
  currentWeek: number;
  top25Locked: boolean;
  rankings: Array<{ rank: number; team_id: string; conference_champion: boolean; name: string; abbreviation: string; conference: string | null }>;
  bracket: Array<{
    id: string; status: string; slot_id: string | null;
    round: "first_round" | "quarterfinal" | "semifinal" | "championship" | null;
    slot_number: number | null; home_seed: number | null; away_seed: number | null;
    home_team_id: string | null; away_team_id: string | null;
    home_team_name: string | null; away_team_name: string | null;
    game_id: string | null; game_status: string | null;
    home_score: number | null; away_score: number | null; bowl_name: string | null;
  }>;
};

export type LegendCatalogEntry = {
  id: string;
  name: string;
  position: string;
  position_group: string;
  est_ovr: number | null;
  height: string | null;
  weight: number | null;
  hand: string | null;
  jersey_number: number | null;
  dev_trait: string;
  archetype: string | null;
  build_note: string | null;
  college: string | null;
  body_type: string | null;
  attributes: Record<string, number>;
};

export type LegendAvailabilityEntry = {
  legendId: string;
  purchaseId: string;
  purchaserUserId: string;
  purchaserDiscordId: string;
  status: string;
};

export type MentionableCommissioner = { discordId: string; displayName: string };
export type MentionableRole = { key: "commissioner" | "coCommissioner"; roleId: string; name: string };
export type MentionableList = { members: MentionableCommissioner[]; roles: MentionableRole[] };
