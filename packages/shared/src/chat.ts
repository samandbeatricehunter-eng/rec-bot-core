// The chat messaging feature (league/game/commissioner chat) was removed. The realtime
// pub/sub transport it was built on remains as scaffolding for future channel consumers;
// fantasy draft board live-refresh (previously the only remaining channel type) was removed
// with the fantasy/annual draft modules.
export type ChatChannelType = never;
