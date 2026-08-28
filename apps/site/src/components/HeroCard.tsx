import { useState } from "react";
import { siteApi, type PowerRankPosition, type SiteHomeCard } from "../lib/site-api.js";

type HeroTab = "profile" | "stats";

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

function powerRankMovement(pos: PowerRankPosition): string {
  if (pos.previousRank == null) return "NEW";
  const delta = pos.previousRank - pos.rank;
  if (delta > 0) return `▲${delta}`;
  if (delta < 0) return `▼${Math.abs(delta)}`;
  return "—";
}

export function HeroCard({
  displayName,
  card,
}: {
  displayName: string;
  card: SiteHomeCard | null;
}) {
  const [tab, setTab] = useState<HeroTab>("profile");
  const [expanded, setExpanded] = useState(false);
  const [careerGames, setCareerGames] = useState<CareerGame[] | null>(null);
  const [gamesLoading, setGamesLoading] = useState(false);

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
  }

  const perf = card?.performanceRecord;

  return (
    <section className={["site-home-hero", expanded ? "is-expanded" : "is-collapsed"].join(" ")}>
      <button
        type="button"
        className="site-home-hero-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>
          <strong>{card?.username ? `@${card.username}` : displayName}</strong>
          <small>{card?.globalRecord?.text ?? "0-0"} · {card?.leaguesActivity?.activeLeagues ?? 0} leagues</small>
        </span>
        <span className="site-home-hero-toggle-label">{expanded ? "Hide profile" : "Show profile"}</span>
      </button>
      {expanded ? (
        <>
      <div className="site-hero-switcher" role="tablist" aria-label="Hero card view">
        <button type="button" role="tab" aria-selected={tab === "profile"} className={tab === "profile" ? "is-active" : ""} onClick={() => openTab("profile")}>
          {card?.username ? `@${card.username}` : "Profile"}
        </button>
        <button type="button" role="tab" aria-selected={tab === "stats"} className={tab === "stats" ? "is-active" : ""} onClick={() => openTab("stats")}>
          My Stats
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
              <span>{card?.currentGame?.startsWith("madden") ? "Franchise" : "Dynasty"} power rank</span>
              <strong title={`Ranked against other site-linked ${card?.currentGame?.startsWith("madden") ? "Madden" : "CFB"} players with a computed power ranking -- not every REC user plays this game or has linked their site account yet, so this pool is smaller than the full user base.`}>
                {card?.dynastyPowerRank ? `#${card.dynastyPowerRank.rank} of ${card.dynastyPowerRank.of}` : "Unranked"}
              </strong>
              {card?.dynastyPowerRank ? (
                <small className="site-hero-rank-move">{powerRankMovement(card.dynastyPowerRank)}</small>
              ) : null}
            </article>
            <article>
              <span>Tournament power rank</span>
              <strong title="Tournament ranking fills in as bracket results are logged.">
                {card?.compPowerRank ? `#${card.compPowerRank.rank} of ${card.compPowerRank.of}` : "Not ranked yet"}
              </strong>
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
        </>
      ) : null}
    </section>
  );
}
