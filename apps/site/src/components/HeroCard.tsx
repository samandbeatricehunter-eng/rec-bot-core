import { useState } from "react";
import { badgeAsset, badgeTooltip, type SiteBadge } from "../lib/badge-display.js";
import { siteApi, type SiteHomeCard } from "../lib/site-api.js";

type HeroTab = "profile" | "stats" | "badges";

type CareerGame = {
  game: string;
  gameLabel: string;
  gamesLogged: number;
  passingYards: number;
  rushingYards: number;
  totalYards: number;
  firstDowns: number;
  turnoversGenerated: number;
  turnoversCommitted: number;
  turnoverDifferential: number;
};

function formatMemberSince(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

function recordText(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}

export function HeroCard({
  displayName,
  card,
}: {
  displayName: string;
  card: SiteHomeCard | null;
}) {
  const [tab, setTab] = useState<HeroTab>("profile");
  const [careerGames, setCareerGames] = useState<CareerGame[] | null>(null);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [badges, setBadges] = useState<SiteBadge[] | null>(null);
  const [badgesLoading, setBadgesLoading] = useState(false);

  function openTab(next: HeroTab) {
    setTab(next);
    if (next === "stats" && careerGames === null && !gamesLoading) {
      setGamesLoading(true);
      siteApi
        .listCareerStatsByGame()
        .then((res) => setCareerGames(res.games))
        .catch(() => setCareerGames([]))
        .finally(() => setGamesLoading(false));
    }
    if (next === "badges" && badges === null && !badgesLoading) {
      setBadgesLoading(true);
      siteApi
        .listMyBadges()
        .then((res) => setBadges(res.badges))
        .catch(() => setBadges([]))
        .finally(() => setBadgesLoading(false));
    }
  }

  const perf = card?.performanceRecord;

  return (
    <section className="site-home-hero">
      <div className="site-hero-switcher" role="tablist" aria-label="Hero card view">
        <button type="button" role="tab" aria-selected={tab === "profile"} className={tab === "profile" ? "is-active" : ""} onClick={() => openTab("profile")}>
          {card?.username ? `@${card.username}` : "Profile"}
        </button>
        <button type="button" role="tab" aria-selected={tab === "stats"} className={tab === "stats" ? "is-active" : ""} onClick={() => openTab("stats")}>
          My Stats
        </button>
        <button type="button" role="tab" aria-selected={tab === "badges"} className={tab === "badges" ? "is-active" : ""} onClick={() => openTab("badges")}>
          My Badges
        </button>
      </div>

      {tab === "profile" ? (
        <div className="site-home-hero-copy">
          <p className="site-home-eyebrow">REC Leagues Sports</p>
          <h1>Welcome back, {displayName}</h1>
          <p>Your season hub starts here.</p>
          <div className="site-account-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <article>
              <span>All-time record</span>
              <strong>{card?.globalRecord?.text ?? "0-0"}</strong>
            </article>
            <article>
              <span>User rating</span>
              <strong>
                {card?.userRating?.displayAsGrade ? card.userRating.grade : card?.userRating?.rating ?? "—"}
              </strong>
            </article>
            <article>
              <span>Dynasty power rank</span>
              <strong>{card?.powerRank ? `#${card.powerRank.rank} of ${card.powerRank.of}` : "—"}</strong>
            </article>
            <article>
              <span>Comp power rank</span>
              <strong title="Global H2H Comp ranking launches with the matchmaking queue.">Coming soon</strong>
            </article>
            <article>
              <span>Current streak</span>
              <strong>{perf?.currentStreak ?? "—"}</strong>
            </article>
            <article>
              <span>Playoff record</span>
              <strong>{perf ? recordText(perf.playoffWins, perf.playoffLosses) : "0-0"}</strong>
            </article>
            <article>
              <span>Championship record</span>
              <strong>{perf ? recordText(perf.superbowlWins, perf.superbowlLosses) : "0-0"}</strong>
            </article>
            <article>
              <span>Point differential</span>
              <strong>{perf ? (perf.pointDifferential > 0 ? `+${perf.pointDifferential}` : perf.pointDifferential) : "0"}</strong>
            </article>
            <article>
              <span>Badges earned</span>
              <strong>{card?.badgeCount ?? 0}</strong>
            </article>
            <article>
              <span>Career awards won</span>
              <strong>{card?.careerAwardsWon ?? 0}</strong>
            </article>
            <article>
              <span>Active leagues</span>
              <strong>
                {card?.leaguesActivity?.activeLeagues ?? 0}
                {card?.leaguesActivity?.commissionerOf ? ` (${card.leaguesActivity.commissionerOf} commish)` : ""}
              </strong>
            </article>
            <article>
              <span>Member since</span>
              <strong>{formatMemberSince(card?.memberSince ?? null)}</strong>
            </article>
          </div>
          {card?.recentBadge ? (
            <p className="site-muted site-hero-recent-badge">
              Most recent badge: <strong>{card.recentBadge.label}</strong>
              {card.recentBadge.tier ? ` (${card.recentBadge.tier})` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "stats" ? (
        <div className="site-home-hero-copy">
          {gamesLoading ? (
            <p className="site-muted">Loading stats…</p>
          ) : careerGames && careerGames.length ? (
            <div className="site-account-game-stats">
              {careerGames.map((game) => (
                <details key={game.game} className="site-account-game-block" open>
                  <summary>{game.gameLabel}</summary>
                  <div className="site-account-stat-grid">
                    <article><span>Games logged</span><strong>{game.gamesLogged}</strong></article>
                    <article><span>Passing yards</span><strong>{game.passingYards.toLocaleString()}</strong></article>
                    <article><span>Rushing yards</span><strong>{game.rushingYards.toLocaleString()}</strong></article>
                    <article><span>Total yards</span><strong>{game.totalYards.toLocaleString()}</strong></article>
                    <article><span>First downs</span><strong>{game.firstDowns.toLocaleString()}</strong></article>
                    <article><span>TO generated</span><strong>{game.turnoversGenerated}</strong></article>
                    <article><span>TO committed</span><strong>{game.turnoversCommitted}</strong></article>
                    <article><span>TO differential</span><strong>{game.turnoverDifferential}</strong></article>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="site-muted">No box-score career stats logged yet.</p>
          )}
        </div>
      ) : null}

      {tab === "badges" ? (
        <div className="site-home-hero-copy">
          {badgesLoading ? (
            <p className="site-muted">Loading badges…</p>
          ) : badges && badges.length ? (
            <ul className="site-account-badge-list">
              {badges.map((badge) => {
                const label = badge.badge_label ?? badge.badge_key.replaceAll("_", " ");
                const tip = badgeTooltip(badge);
                return (
                  <li
                    key={badge.badge_key + "-" + badge.badge_scope}
                    title={tip}
                    className="site-account-badge-render"
                    style={{ backgroundImage: `url("${badgeAsset(badge.badge_key, label, badge.tier)}")` }}
                  >
                    <span className="sr-only">{label}. {tip}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="site-muted">No badges yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
