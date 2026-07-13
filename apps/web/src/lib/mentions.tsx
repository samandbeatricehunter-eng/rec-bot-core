import type { ReactNode } from "react";
import type { MentionableList } from "../types/api.js";

const MENTION_PATTERN = /<@&?(\d+)>/g;

// Renders Discord's own mention syntax (<@discordId> for a person, <@&roleId> for a role —
// no custom format invented) as styled spans instead of raw tokens. Plain string split +
// map to React elements, never dangerouslySetInnerHTML — message bodies are user-supplied
// text, not markup. Cosmetic only: posting here never pings anyone's real Discord client,
// this chat is a separate space from the Discord channel it replaces.
export function renderMessageWithMentions(body: string, mentionable: MentionableList | null): ReactNode[] {
  if (!mentionable) return [body];
  const memberNames = new Map(mentionable.members.map((m) => [m.discordId, m.displayName]));
  const roleNames = new Map(mentionable.roles.map((r) => [r.roleId, r.name]));

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  MENTION_PATTERN.lastIndex = 0;
  while ((match = MENTION_PATTERN.exec(body))) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    const isRole = match[0].startsWith("<@&");
    const id = match[1];
    const name = isRole ? roleNames.get(id) : memberNames.get(id);
    parts.push(
      <span key={key++} style={{ color: "var(--gold)", fontWeight: 700 }}>
        {name ? `@${name}` : match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts;
}
