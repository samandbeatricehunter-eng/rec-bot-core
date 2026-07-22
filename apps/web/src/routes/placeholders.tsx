import { useReadyAuth } from "../lib/auth-context.js";

export function HubPlaceholder({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="hub-placeholder-page">
      <h1>{title}</h1>
      <p>{blurb}</p>
    </div>
  );
}

export function AccountPlaceholder() {
  const auth = useReadyAuth();
  return (
    <div className="hub-placeholder-page">
      <h1>My Account</h1>
      <p>
        Signed in via Discord session for guild <code>{auth.guildId}</code>.
        Discord user <code>{auth.discordId}</code>. There is no separate login UI in
        the Activity hub — re-open from Discord if your session expires.
      </p>
    </div>
  );
}
