// Canonical creation defaults captured from the active REC OG CFB league on 2026-07-14.
// Names and the Weekly Submissions -> Gameday category relationship are portable; Discord
// role IDs and channel IDs are deliberately not copied between servers. When a route already
// has a channel, creation clones that live channel's overwrites and category server-side.
export const REC_ROUTE_CHANNELS = {
  main_chat: {
    label: "Main Chat Channel",
    defaultName: "main-chat",
    inputField: "mainChatChannelId",
    dbField: "main_chat_channel_id",
  },
  announcements: {
    label: "Announcements",
    defaultName: "announcements",
    inputField: "announcementsChannelId",
    dbField: "announcements_channel_id",
  },
  streams: {
    label: "Streams",
    defaultName: "streams",
    inputField: "streamsChannelId",
    dbField: "streams_channel_id",
  },
  headlines: {
    label: "Headlines",
    defaultName: "headlines",
    inputField: "headlinesChannelId",
    dbField: "headlines_channel_id",
  },
  highlights: {
    label: "Highlights",
    defaultName: "highlights",
    inputField: "highlightsChannelId",
    dbField: "highlights_channel_id",
  },
  box_scores: {
    label: "Box Scores",
    defaultName: "box-scores",
    defaultParentRoute: "game_channels_category",
    inputField: "boxScoresChannelId",
    dbField: "box_scores_channel_id",
    // RTI leagues use Player XP/ratings progression, never box-score stat entry.
    hidden_for_rti: true,
  },
  rec_guide: {
    label: "REC Guide",
    defaultName: "rec-guide",
    inputField: "recGuideChannelId",
    dbField: "rec_guide_channel_id",
  },
  game_channels_category: {
    label: "Game Channels Category",
    defaultName: "Gameday 🏈",
    inputField: "gameChannelsCategoryId",
    dbField: "game_channels_category_id",
  },
  trade_block: {
    label: "Trade Block (Madden)",
    defaultName: "trade-block",
    inputField: "tradeBlockChannelId",
    dbField: "trade_block_channel_id",
    // Madden-only feature — trades don't exist in CFB leagues, so the field shouldn't
    // even be offered there.
    madden_only: true,
  },
  voting_polls: {
    label: "Voting Polls (optional Discord mirror)",
    defaultName: "voting-polls",
    inputField: "votingPollsChannelId",
    dbField: "voting_polls_channel_id",
  },
  availability: {
    label: "Availability (Game Scheduling)",
    defaultName: "availability",
    inputField: "schedulingChannelId",
    dbField: "scheduling_channel_id",
  },
  matchups: {
    label: "Matchups (Weekly Schedule)",
    defaultName: "matchups",
    inputField: "matchupsChannelId",
    dbField: "matchups_channel_id",
  },
  interviews: {
    label: "Interviews (Rise to Immortality)",
    defaultName: "interviews",
    inputField: "interviewsChannelId",
    dbField: "interviews_channel_id",
    rti_only: true,
  },
  tweets: {
    label: "Tweets (Rise to Immortality)",
    defaultName: "tweets",
    inputField: "tweetsChannelId",
    dbField: "tweets_channel_id",
    rti_only: true,
  },
  power_rankings: {
    label: "Power Rankings (Rise to Immortality)",
    defaultName: "power-rankings",
    inputField: "powerRankingsChannelId",
    dbField: "power_rankings_channel_id",
    rti_only: true,
  },
  player_of_the_week: {
    label: "Player of the Week (Rise to Immortality)",
    defaultName: "player-of-the-week",
    inputField: "playerOfTheWeekChannelId",
    dbField: "player_of_the_week_channel_id",
    rti_only: true,
  },
  roster_movement: {
    label: "Roster Movement (Rise to Immortality)",
    defaultName: "roster-movement",
    inputField: "rosterMovementChannelId",
    dbField: "roster_movement_channel_id",
    rti_only: true,
  },
  finalized_trades: {
    label: "Finalized Trades (Rise to Immortality)",
    defaultName: "finalized-trades",
    inputField: "finalizedTradesChannelId",
    dbField: "finalized_trades_channel_id",
    rti_only: true,
  },
  league_leaders: {
    label: "League Leaders (Rise to Immortality)",
    defaultName: "league-leaders",
    inputField: "leagueLeadersChannelId",
    dbField: "league_leaders_channel_id",
    rti_only: true,
  },
  record_holders: {
    label: "Record Holders (Rise to Immortality)",
    defaultName: "record-holders",
    inputField: "recordHoldersChannelId",
    dbField: "record_holders_channel_id",
    rti_only: true,
  },
  owners_chat: {
    label: "Owners Chat (Rise to Immortality)",
    defaultName: "owners-chat",
    inputField: "ownersChatChannelId",
    dbField: "owners_chat_channel_id",
    rti_only: true,
  },
  offensive_pros: {
    label: "Offensive Pros (Rise to Immortality)",
    defaultName: "offensive-pros",
    inputField: "offensiveProsChannelId",
    dbField: "offensive_pros_channel_id",
    rti_only: true,
  },
  defensive_pros: {
    label: "Defensive Pros (Rise to Immortality)",
    defaultName: "defensive-pros",
    inputField: "defensiveProsChannelId",
    dbField: "defensive_pros_channel_id",
    rti_only: true,
  },
  hof_milestones: {
    label: "HOF Milestones (Rise to Immortality)",
    defaultName: "hof-milestones",
    inputField: "hofMilestonesChannelId",
    dbField: "hof_milestones_channel_id",
    rti_only: true,
  },
  pro_tracker: {
    label: "Pro Tracker (Rise to Immortality)",
    defaultName: "pro-tracker",
    inputField: "proTrackerChannelId",
    dbField: "pro_tracker_channel_id",
    rti_only: true,
  },
} as const;

export type RecRouteChannelKey = keyof typeof REC_ROUTE_CHANNELS;
export type RecRouteChannelInputField = (typeof REC_ROUTE_CHANNELS)[RecRouteChannelKey]["inputField"];

export function getRecRouteChannel(key: string) {
  return REC_ROUTE_CHANNELS[key as RecRouteChannelKey] ?? null;
}
