import type { ReactNode } from "react";
import type { MentionableList } from "../types/api.js";

const CHAT_TOKEN_PATTERN = /(<@&?\d+>|<a?:[a-zA-Z0-9_]+:\d+>|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|@everyone|@here)/g;

// Renders Discord's own mention syntax (<@discordId> for a person, <@&roleId> for a role —
// no custom format invented) as styled spans instead of raw tokens. Plain string split +
// map to React elements, never dangerouslySetInnerHTML — message bodies are user-supplied
// text, not markup. Cosmetic only: posting here never pings anyone's real Discord client,
// this chat is a separate space from the Discord channel it replaces.
export function renderMessageWithMentions(body: string, mentionable: MentionableList | null): ReactNode[] {
  const memberNames = new Map((mentionable?.members ?? []).map((m) => [m.discordId, m.displayName]));
  const roleNames = new Map((mentionable?.roles ?? []).map((r) => [r.roleId, r.name]));
  return body.split(CHAT_TOKEN_PATTERN).filter(Boolean).map((token, key) => {
    const mention = /^<@(&?)(\d+)>$/.exec(token);
    if (mention) {
      const name = mention[1] ? roleNames.get(mention[2]) : memberNames.get(mention[2]);
      return <span key={key} className="hub-chat-mention">{name ? `@${name}` : token}</span>;
    }
    if (token === "@everyone" || token === "@here") return <span key={key} className="hub-chat-mention">{token}</span>;
    const emoji = /^<(a?):([a-zA-Z0-9_]+):(\d+)>$/.exec(token);
    if (emoji) return <img key={key} className="hub-chat-emoji" src={`https://cdn.discordapp.com/emojis/${emoji[3]}.${emoji[1] ? "gif" : "webp"}?size=40&quality=lossless`} alt={`:${emoji[2]}:`} title={`:${emoji[2]}:`} />;
    if (token.startsWith("**")) return <strong key={key}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("__")) return <u key={key}>{token.slice(2, -2)}</u>;
    if (token.startsWith("~~")) return <s key={key}>{token.slice(2, -2)}</s>;
    if (token.startsWith("`")) return <code key={key}>{token.slice(1, -1)}</code>;
    if (token.startsWith("*")) return <em key={key}>{token.slice(1, -1)}</em>;
    return token;
  });
}
