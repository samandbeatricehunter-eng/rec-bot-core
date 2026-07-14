// Canonical creation defaults captured from the active REC OG CFB league on 2026-07-14.
// Names and the Weekly Submissions -> Gameday category relationship are portable; Discord
// role IDs and channel IDs are deliberately not copied between servers. When a route already
// has a channel, creation clones that live channel's overwrites and category server-side.
export const REC_ROUTE_CHANNELS = {
  announcements: {
    label: "Announcements",
    defaultName: "announcements",
    inputField: "announcementsChannelId",
    dbField: "announcements_channel_id",
  },
  power_rankings: {
    label: "Power Rankings",
    defaultName: "power-rankings",
    inputField: "powerRankingsChannelId",
    dbField: "power_rankings_channel_id",
  },
  streams: {
    label: "Streams",
    defaultName: "streams",
    inputField: "streamsChannelId",
    dbField: "streams_channel_id",
  },
  highlights: {
    label: "Highlights",
    defaultName: "highlights",
    inputField: "highlightsChannelId",
    dbField: "highlights_channel_id",
  },
  weekly_submissions: {
    label: "Weekly Submissions",
    defaultName: "box-scores",
    defaultParentRoute: "game_channels_category",
    inputField: "weeklySubmissionsChannelId",
    dbField: "weekly_submissions_channel_id",
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
} as const;

export type RecRouteChannelKey = keyof typeof REC_ROUTE_CHANNELS;
export type RecRouteChannelInputField = (typeof REC_ROUTE_CHANNELS)[RecRouteChannelKey]["inputField"];

export function getRecRouteChannel(key: string) {
  return REC_ROUTE_CHANNELS[key as RecRouteChannelKey] ?? null;
}
