import type { ChatChannelSummary } from "@rec/shared";

export function ChannelList({
  channels,
  selectedChannelId,
  onSelect,
}: {
  channels: ChatChannelSummary[];
  selectedChannelId: string | null;
  onSelect: (channel: ChatChannelSummary) => void;
}) {
  return (
    <div className="chat-drawer-channel-list">
      {channels.map((channel) => (
        <button
          key={`${channel.type}:${channel.id}`}
          type="button"
          className={
            channel.id === selectedChannelId
              ? "chat-drawer-channel-row chat-drawer-channel-row-active"
              : "chat-drawer-channel-row"
          }
          onClick={() => onSelect(channel)}
        >
          <span className="chat-drawer-channel-label">
            {channel.label}
            {channel.participantFlag && <span className="hub-dc-tag">MY GAME</span>}
          </span>
          {channel.lastMessagePreview && (
            <span className="chat-drawer-channel-preview">{channel.lastMessagePreview}</span>
          )}
          {channel.unreadCount > 0 && <span className="chat-drawer-channel-badge">{channel.unreadCount}</span>}
        </button>
      ))}
      {channels.length === 0 && <p className="hub-empty">No chat channels available.</p>}
    </div>
  );
}
