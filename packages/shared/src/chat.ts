// The chat messaging feature (league/game/commissioner chat) was removed. This type survives
// because the realtime pub/sub transport it was built on (apps/api/src/modules/chat/
// chat-realtime.ts, apps/web/src/lib/chat-realtime-client.ts) is still used independently by
// the Fantasy Draft Board's live-refresh events.
export type ChatChannelType = "fantasy_draft";
