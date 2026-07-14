export const REC_ROUTE_CHANNELS = {
  announcements: {
    label: "Announcements",
    inputField: "announcementsChannelId",
    dbField: "announcements_channel_id",
  },
  power_rankings: {
    label: "Power Rankings",
    inputField: "powerRankingsChannelId",
    dbField: "power_rankings_channel_id",
  },
  streams: {
    label: "Streams",
    inputField: "streamsChannelId",
    dbField: "streams_channel_id",
  },
  highlights: {
    label: "Highlights",
    inputField: "highlightsChannelId",
    dbField: "highlights_channel_id",
  },
  weekly_submissions: {
    label: "Weekly Submissions",
    inputField: "weeklySubmissionsChannelId",
    dbField: "weekly_submissions_channel_id",
  },
  rec_guide: {
    label: "REC Guide",
    inputField: "recGuideChannelId",
    dbField: "rec_guide_channel_id",
  },
  game_channels_category: {
    label: "Game Channels Category",
    inputField: "gameChannelsCategoryId",
    dbField: "game_channels_category_id",
  },
} as const;

export type RecRouteChannelKey = keyof typeof REC_ROUTE_CHANNELS;
export type RecRouteChannelInputField = (typeof REC_ROUTE_CHANNELS)[RecRouteChannelKey]["inputField"];

export function getRecRouteChannel(key: string) {
  return REC_ROUTE_CHANNELS[key as RecRouteChannelKey] ?? null;
}
