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
  box_scores: {
    label: "Box Scores",
    defaultName: "box-scores",
    defaultParentRoute: "game_channels_category",
    inputField: "boxScoresChannelId",
    dbField: "box_scores_channel_id",
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
} as const;

export type RecRouteChannelKey = keyof typeof REC_ROUTE_CHANNELS;
export type RecRouteChannelInputField = (typeof REC_ROUTE_CHANNELS)[RecRouteChannelKey]["inputField"];

export function getRecRouteChannel(key: string) {
  return REC_ROUTE_CHANNELS[key as RecRouteChannelKey] ?? null;
}
