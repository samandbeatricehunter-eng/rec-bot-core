// Canonical creation defaults captured from the active REC OG CFB league on 2026-07-14.
// Names and the Weekly Submissions -> Gameday category relationship are portable; Discord
// role IDs and channel IDs are deliberately not copied between servers. When a route already
// has a channel, creation clones that live channel's overwrites and category server-side.
//
// Grouped into the 4 blocks the Discord settings tab renders (packages/shared is the single
// source of truth both the API and the web settings UI import from):
export type RouteChannelBlock = "league_updates" | "trades" | "players" | "gameday";

export const REC_ROUTE_CHANNELS = {
  announcements: {
    label: "Announcements",
    defaultName: "announcements",
    inputField: "announcementsChannelId",
    dbField: "announcements_channel_id",
    block: "league_updates",
  },
  headlines: {
    label: "Headlines",
    defaultName: "headlines",
    inputField: "headlinesChannelId",
    dbField: "headlines_channel_id",
    block: "league_updates",
  },
  tweets: {
    label: "Tweets",
    defaultName: "tweets",
    inputField: "tweetsChannelId",
    dbField: "tweets_channel_id",
    block: "league_updates",
  },
  power_rankings: {
    label: "Power Rankings",
    defaultName: "power-rankings",
    inputField: "powerRankingsChannelId",
    dbField: "power_rankings_channel_id",
    block: "league_updates",
  },
  ways_to_get_paid: {
    label: "Ways to Get Paid",
    defaultName: "ways-to-get-paid",
    inputField: "waysToGetPaidChannelId",
    dbField: "ways_to_get_paid_channel_id",
    block: "league_updates",
  },
  weekly_transactions: {
    label: "Weekly Transactions",
    defaultName: "weekly-transactions",
    inputField: "weeklyTransactionsChannelId",
    dbField: "weekly_transactions_channel_id",
    block: "league_updates",
  },
  matchup_breakdowns: {
    label: "Matchup Breakdowns",
    defaultName: "matchup-breakdowns",
    inputField: "matchupBreakdownsChannelId",
    dbField: "matchup_breakdowns_channel_id",
    // Wiped and reposted fresh every advance -- one embed per matchup, tagging the involved
    // user(s). This is the analytical "matchup details" content that used to render inline on
    // the game-channel matchup card; the card itself only shows the visual now.
    block: "league_updates",
  },
  proposed_trades: {
    label: "Proposed Trades",
    defaultName: "proposed-trades",
    inputField: "proposedTradesChannelId",
    dbField: "proposed_trades_channel_id",
    madden_only: true,
    block: "trades",
  },
  finalized_trades: {
    label: "Finalized Trades",
    defaultName: "finalized-trades",
    inputField: "finalizedTradesChannelId",
    dbField: "finalized_trades_channel_id",
    madden_only: true,
    block: "trades",
  },
  rejected_trades: {
    label: "Rejected Trades",
    defaultName: "rejected-trades",
    inputField: "rejectedTradesChannelId",
    dbField: "rejected_trades_channel_id",
    madden_only: true,
    block: "trades",
  },
  trade_block: {
    label: "Trade Block",
    defaultName: "trade-block",
    inputField: "tradeBlockChannelId",
    dbField: "trade_block_channel_id",
    madden_only: true,
    block: "trades",
  },
  roster_movement: {
    label: "Roster Movement",
    defaultName: "roster-movement",
    inputField: "rosterMovementChannelId",
    dbField: "roster_movement_channel_id",
    block: "players",
  },
  player_of_the_week: {
    label: "Player of the Week",
    defaultName: "player-of-the-week",
    inputField: "playerOfTheWeekChannelId",
    dbField: "player_of_the_week_channel_id",
    block: "players",
  },
  league_leaders: {
    label: "League Leaders",
    defaultName: "league-leaders",
    inputField: "leagueLeadersChannelId",
    dbField: "league_leaders_channel_id",
    block: "players",
  },
  record_holders: {
    label: "Record Holders",
    defaultName: "record-holders",
    inputField: "recordHoldersChannelId",
    dbField: "record_holders_channel_id",
    block: "players",
  },
  owners_chat: {
    label: "Owners Chat (Rise to Immortality)",
    defaultName: "owners-chat",
    inputField: "ownersChatChannelId",
    dbField: "owners_chat_channel_id",
    rti_only: true,
    block: "players",
  },
  offensive_pros: {
    label: "Offensive Pros (Rise to Immortality)",
    defaultName: "offensive-pros",
    inputField: "offensiveProsChannelId",
    dbField: "offensive_pros_channel_id",
    rti_only: true,
    block: "players",
  },
  defensive_pros: {
    label: "Defensive Pros (Rise to Immortality)",
    defaultName: "defensive-pros",
    inputField: "defensiveProsChannelId",
    dbField: "defensive_pros_channel_id",
    rti_only: true,
    block: "players",
  },
  hof_milestones: {
    label: "HOF Milestones (Rise to Immortality)",
    defaultName: "hof-milestones",
    inputField: "hofMilestonesChannelId",
    dbField: "hof_milestones_channel_id",
    rti_only: true,
    block: "players",
  },
  pro_tracker: {
    label: "Pro Tracker (Rise to Immortality)",
    defaultName: "pro-tracker",
    inputField: "proTrackerChannelId",
    dbField: "pro_tracker_channel_id",
    rti_only: true,
    block: "players",
  },
  streams: {
    label: "Streams",
    defaultName: "streams",
    inputField: "streamsChannelId",
    dbField: "streams_channel_id",
    block: "gameday",
  },
  matchup_tracker: {
    label: "Matchup Tracker",
    defaultName: "matchup-tracker",
    inputField: "matchupTrackerChannelId",
    dbField: "matchup_tracker_channel_id",
    // Private to commissioner/co-commissioner roles -- created with restricted permission
    // overwrites, not the default-visible overwrites every other route channel gets.
    commissioner_only: true,
    block: "gameday",
  },
  game_channels_category: {
    label: "Game Channels Category",
    defaultName: "Gameday 🏈",
    inputField: "gameChannelsCategoryId",
    dbField: "game_channels_category_id",
    block: "gameday",
  },
  highlights: {
    label: "Highlights",
    defaultName: "highlights",
    inputField: "highlightsChannelId",
    dbField: "highlights_channel_id",
    block: "gameday",
  },
} as const;

export type RecRouteChannelKey = keyof typeof REC_ROUTE_CHANNELS;
export type RecRouteChannelInputField = (typeof REC_ROUTE_CHANNELS)[RecRouteChannelKey]["inputField"];

export function getRecRouteChannel(key: string) {
  return REC_ROUTE_CHANNELS[key as RecRouteChannelKey] ?? null;
}

export const ROUTE_CHANNEL_BLOCKS: { key: RouteChannelBlock; label: string }[] = [
  { key: "league_updates", label: "League Updates" },
  { key: "trades", label: "Trades" },
  { key: "players", label: "Players" },
  { key: "gameday", label: "Gameday" },
];
