import type { CSSProperties } from "react";
import type {
  MatchupPreview as MatchupPreviewData,
  MatchupTeamBreakdown,
  WagerOptionsResponse,
} from "../../types/api.js";

function readableText(hex: string) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(
    (offset) => parseInt(value.slice(offset, offset + 2), 16) || 0,
  );
  return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#080A0C" : "#F4F5F6";
}

function TeamColumn({
  team,
  displayAsGrade,
  side,
}: {
  team: MatchupTeamBreakdown;
  displayAsGrade: boolean;
  side: "away" | "home";
}) {
  const ratingLabel =
    team.coachRating == null
      ? null
      : displayAsGrade
        ? team.coachGrade ?? "-"
        : String(team.coachRating);
  return (
    <div
      className={`matchup-preview__team matchup-preview__team--${side}`}
      style={
        {
          "--team-color": team.primaryColor,
          "--team-text": readableText(team.primaryColor),
        } as CSSProperties
      }
    >
      <header className="matchup-preview__team-head">
        <small>
          {side === "away" ? "Away" : "Home"}
          {team.isHuman ? "" : " · CPU"}
        </small>
        <strong>{team.teamName}</strong>
        <span className="matchup-preview__record">
          {team.record}
          {team.gamesPlayed ? ` · ${team.streak}` : ""}
        </span>
      </header>
      <dl className="matchup-preview__stats">
        <div>
          <dt>Points / game</dt>
          <dd>{team.gamesPlayed ? team.pointsPerGame.toFixed(1) : "-"}</dd>
        </div>
        <div>
          <dt>Allowed / game</dt>
          <dd>{team.gamesPlayed ? team.pointsAllowedPerGame.toFixed(1) : "-"}</dd>
        </div>
        <div>
          <dt>Point diff</dt>
          <dd>
            {team.gamesPlayed
              ? `${team.pointDifferential > 0 ? "+" : ""}${team.pointDifferential}`
              : "-"}
          </dd>
        </div>
        {ratingLabel != null && (
          <div>
            <dt>{displayAsGrade ? "Coach grade" : "Coach rating"}</dt>
            <dd>
              {ratingLabel}
              {team.powerRank ? ` · #${team.powerRank}` : ""}
            </dd>
          </div>
        )}
      </dl>
      <div className="matchup-preview__form" aria-label="Last five results">
        {team.last5.length ? (
          team.last5.map((outcome, index) => (
            <span
              key={index}
              className={`matchup-preview__form-chip is-${outcome.toLowerCase()}`}
            >
              {outcome}
            </span>
          ))
        ) : (
          <span className="matchup-preview__form-empty">No games yet</span>
        )}
      </div>
    </div>
  );
}

function featuredMarkets(options: WagerOptionsResponse | null | undefined) {
  if (!options) return [];
  const preferred = ["moneyline", "spread", "total_points"];
  const byKey = new Map(options.markets.map((market) => [market.market, market]));
  const primary = preferred
    .map((key) => byKey.get(key))
    .filter(Boolean) as WagerOptionsResponse["markets"];
  const extras = options.markets.filter(
    (market) =>
      !preferred.includes(market.market) &&
      market.sides.some(
        (side) => side.pick.toLowerCase() === "over" || side.pick.toLowerCase() === "under",
      ),
  );
  return [...primary, ...extras].slice(0, 6);
}

export function MatchupPreview({
  preview,
  wagerOptions,
}: {
  preview: MatchupPreviewData;
  wagerOptions?: WagerOptionsResponse | null;
}) {
  const { away, home, prediction, displayAsGrade } = preview;
  const markets =
    preview.matchupType === "h2h" ? featuredMarkets(wagerOptions ?? null) : [];
  return (
    <section className="matchup-preview">
      <header className="matchup-preview__heading">
        <span>Scouting</span>
        <strong>Matchup Preview</strong>
      </header>

      <div className="matchup-preview__teams">
        <TeamColumn team={away} displayAsGrade={displayAsGrade} side="away" />
        <div className="matchup-preview__vs" aria-hidden="true">
          VS
        </div>
        <TeamColumn team={home} displayAsGrade={displayAsGrade} side="home" />
      </div>

      <div className="matchup-preview__prediction">
        <div className="matchup-preview__odds-head">
          <span className={prediction.favoredSide === "away" ? "is-favored" : ""}>
            {prediction.awayWinProbability}%
          </span>
          <em>Win probability</em>
          <span className={prediction.favoredSide === "home" ? "is-favored" : ""}>
            {prediction.homeWinProbability}%
          </span>
        </div>
        <div
          className="matchup-preview__odds-bar"
          role="img"
          aria-label={`Away ${prediction.awayWinProbability}%, home ${prediction.homeWinProbability}%`}
        >
          <span
            className="matchup-preview__odds-away"
            style={
              {
                width: `${prediction.awayWinProbability}%`,
                "--team-color": away.primaryColor,
              } as CSSProperties
            }
          />
          <span
            className="matchup-preview__odds-home"
            style={
              {
                width: `${prediction.homeWinProbability}%`,
                "--team-color": home.primaryColor,
              } as CSSProperties
            }
          />
        </div>
        <div className="matchup-preview__projection">
          <span className="matchup-preview__proj-label">Projected final</span>
          <span className="matchup-preview__proj-score">
            <b>{away.abbr ?? away.teamName}</b> {prediction.predictedAwayScore}
            <span className="matchup-preview__proj-dash">-</span>
            {prediction.predictedHomeScore} <b>{home.abbr ?? home.teamName}</b>
          </span>
        </div>
        {!preview.hasSeasonData && (
          <p className="matchup-preview__note">{prediction.summary}</p>
        )}
      </div>

      {markets.length > 0 && (
        <div
          className="matchup-preview__wagers"
          style={{
            marginTop: "var(--space-3)",
            paddingTop: "var(--space-3)",
            borderTop: "1px solid var(--border)",
            display: "grid",
            gap: "10px",
          }}
        >
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span
              style={{
                fontSize: ".68rem",
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Sportsbook
            </span>
            <strong style={{ fontSize: ".92rem", textTransform: "uppercase" }}>
              Wager Lines
            </strong>
          </header>
          <div
            className="matchup-preview__wager-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
              gap: "10px",
            }}
          >
            {markets.map((market) => (
              <article
                key={market.market}
                className="matchup-preview__wager-card"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  background: "var(--surface-raised)",
                  padding: "10px",
                  display: "grid",
                  gap: "8px",
                }}
              >
                <div
                  className="matchup-preview__wager-head"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-end",
                    gap: "8px",
                  }}
                >
                  <b>{market.label}</b>
                  <small style={{ color: "var(--text-muted)" }}>
                    {market.line == null ? "No line" : `Line ${market.line}`}
                  </small>
                </div>
                <div
                  className="matchup-preview__wager-sides"
                  style={{ display: "grid", gap: "6px" }}
                >
                  {market.sides.slice(0, 3).map((side) => (
                    <span
                      key={side.pick}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "10px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <em style={{ fontStyle: "normal", color: "var(--text-muted)" }}>
                        {side.label}
                      </em>
                      <strong>
                        {side.odds > 0 ? "+" : ""}
                        {side.odds}
                      </strong>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
