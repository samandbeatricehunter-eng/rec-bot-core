import { useEffect, useState } from "react";
import { useReadyAuth } from "../lib/auth-context.js";
import { recApi } from "../lib/rec-api-client.js";

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
  const [history, setHistory] = useState<any[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => { recApi.getMyLeagueHistory(auth.guildId).then((result) => setHistory(result.leagues)).catch((error) => setHistoryError(error instanceof Error ? error.message : "Failed to load league history.")); }, [auth.guildId]);
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
      <section style={{ marginTop: 24 }}>
        <h2>League History</h2>
        {historyError ? <p>{historyError}</p> : history === null ? <p>Loading league snapshots…</p> : history.length === 0 ? <p>No registered league history yet.</p> : (
          <div style={{ display: "grid", gap: 12 }}>
            {history.map((league) => <details key={league.id} className="site-card">
              <summary><strong>{league.league_name}</strong> · {league.game?.replaceAll("_", " ")} · {league.is_active ? "Active" : "Archived"}</summary>
              <p>{league.first_joined_at ? new Date(league.first_joined_at).toLocaleDateString() : "Unknown start"} – {league.is_active ? "Present" : league.archived_at ? new Date(league.archived_at).toLocaleDateString() : "Ended"} · {league.seasons_participated} season(s)</p>
              <p>Record: {league.record?.wins ?? 0}-{league.record?.losses ?? 0}-{league.record?.ties ?? 0}</p>
              <p>Coins earned: {league.economy?.earned ?? 0} · spent: {league.economy?.spent ?? 0} · net: {league.economy?.net ?? 0}</p>
              <p>House wagers: {league.wager_house?.won ?? 0}-{league.wager_house?.lost ?? 0}, staked {league.wager_house?.staked ?? 0}, paid {league.wager_house?.paid ?? 0}</p>
              <p>Peer wagers: {league.wager_peer?.won ?? 0}-{league.wager_peer?.lost ?? 0}, staked {league.wager_peer?.staked ?? 0}, paid {league.wager_peer?.paid ?? 0}</p>
              {(league.teamTenures ?? []).length > 0 && <p>Teams: {(league.teamTenures ?? []).map((team: any) => team.team_abbreviation ?? team.team_name).filter(Boolean).join(" → ")}</p>}
            </details>)}
          </div>
        )}
      </section>
      <p>
        <a href={pricingUrl} target="_blank" rel="noreferrer">
          Billing and subscriptions live on REC Leagues site
        </a>
      </p>
    </div>
  );
}
