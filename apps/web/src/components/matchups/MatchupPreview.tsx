import type { CSSProperties } from "react";
import { americanFromDecimal } from "@rec/shared";
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

function displayOdds(odds: number) {
  return americanFromDecimal(Number(odds));
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
    team.userRating == null
      ? null
      : displayAsGrade
        ? team.userGrade ?? "-"
        : String(team.userRating);

  return (
    <div
      className={"matchup-preview__team matchup-preview__team--" + side}
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
          {team.gamesPlayed ? " · " + team.streak : ""}
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
              ? (team.pointDifferential > 0 ? "+" : "") + team.pointDifferential
              : "-"}
          </dd>
        </div>
        {ratingLabel != null && (
          <div>
            <dt>{displayAsGrade ? "User grade" : "User rating"}</dt>
            <dd>
              {ratingLabel}
              {team.userRank ? " · #" + team.userRank : ""}
            </dd>
          </div>
        )}
      </dl>

      <div className="matchup-preview__form" aria-label="Last five results">
        {team.last5.length ? (
          team.last5.map((outcome, index) => (
            <span
              key={index}
              className={"matchup-preview__form-chip is-" + outcome.toLowerCase()}
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
        (side) =>
          side.pick.toLowerCase() === "over" ||
          side.pick.toLowerCase() === "under",
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
          aria-label={
            "Away " +
            prediction.awayWinProbability +
            "%, home " +
            prediction.homeWinProbability +
            "%"
          }
        >
          <span
            className="matchup-preview__odds-away"
            style={
              {
                width: prediction.awayWinProbability + "%",
                "--team-color": away.primaryColor,
              } as CSSProperties
            }
          />
          <span
            className="matchup-preview__odds-home"
            style={
              {
                width: prediction.homeWinProbability + "%",
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
        <section className="matchup-preview__wagers">
          <header className="matchup-preview__wagers-head">
            <span>Sportsbook</span>
            <strong>Wager Lines</strong>
          </header>
          <div className="matchup-preview__wager-grid">
            {markets.map((market) => (
              <article key={market.market} className="matchup-preview__wager-card">
                <div className="matchup-preview__wager-head">
                  <b>{market.label}</b>
                  <small>
                    {market.line != null
                      ? "Line " + String(market.line)
                      : market.kind === "moneyline" && market.sides.length
                        ? "Favorite " + market.sides.reduce((fav, side) => (side.odds < fav.odds ? side : fav)).label
                        : "No line"}
                  </small>
                </div>
                <div className="matchup-preview__wager-sides">
                  {market.sides.slice(0, 3).map((side) => (
                    <span key={side.pick}>
                      <em>{side.label}</em>
                      <strong>{displayOdds(side.odds)}</strong>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {wagerOptions?.matchup?.units?.length ? (
        <section className="matchup-preview__lanes">
          <header className="matchup-preview__wagers-head">
            <span>Roster</span>
            <strong>Position Matchups</strong>
          </header>
          <div className="matchup-preview__lane-grid">
            {wagerOptions.matchup.units.map((unit) => {
              const favor = unit.edge > 0.1 ? "home" : unit.edge < -0.1 ? "away" : null;
              return (
                <article key={unit.key} className="matchup-preview__lane">
                  <span className="matchup-preview__lane-label">{unit.label}</span>
                  <span className="matchup-preview__lane-bar" aria-hidden="true">
                    <span
                      className={unit.edge > 0 ? "is-home" : "is-away"}
                      style={{ width: Math.min(100, Math.abs(unit.edge) * 2.5) + "%" }}
                    />
                  </span>
                  <small className={"matchup-preview__lane-edge" + (favor ? " is-" + favor : "")}>
                    {favor ? `${favor === "home" ? home.abbr : away.abbr} +${Math.abs(Math.round(unit.edge))}` : "Even"}
                  </small>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </section>
  );
}
