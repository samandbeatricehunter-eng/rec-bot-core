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
  const siteBase = (import.meta.env.VITE_SITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, "") || "https://rec-leagues.com";
  const pricingUrl = `${siteBase}/pricing`;
  return (
    <div className="hub-placeholder-page">
      <h1>My Account</h1>
      <p>
        Signed in via Discord session for guild <code>{auth.guildId}</code>.
        Discord user <code>{auth.discordId}</code>. There is no separate login UI in
        the Activity hub — re-open from Discord if your session expires.
      </p>
      <p>
        <a href={pricingUrl} target="_blank" rel="noreferrer">
          Billing and subscriptions live on REC Leagues site
        </a>
      </p>
    </div>
  );
}
