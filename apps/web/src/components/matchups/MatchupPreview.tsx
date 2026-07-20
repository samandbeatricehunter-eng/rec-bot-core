import type { CSSProperties } from "react";
import type { MatchupPreview as MatchupPreviewData, MatchupTeamBreakdown } from "../../types/api.js";

function readableText(hex: string) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) || 0);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#080A0C" : "#F4F5F6";
}

function TeamColumn({ team, displayAsGrade, side }: { team: MatchupTeamBreakdown; displayAsGrade: boolean; side: "away" | "home" }) {
  const ratingLabel = team.coachRating == null ? null : displayAsGrade ? team.coachGrade ?? "-" : String(team.coachRating);
  return (
    <div
      className={`matchup-preview__team matchup-preview__team--${side}`}
      style={{ "--team-color": team.primaryColor, "--team-text": readableText(team.primaryColor) } as CSSProperties}
    >
      <header className="matchup-preview__team-head">
        <small>{side === "away" ? "Away" : "Home"}{team.isHuman ? "" : " · CPU"}</small>
        <strong>{team.teamName}</strong>
        <span className="matchup-preview__record">{team.record}{team.gamesPlayed ? ` · ${team.streak}` : ""}</span>
      </header>
      <dl className="matchup-preview__stats">
        <div><dt>Points / game</dt><dd>{team.gamesPlayed ? team.pointsPerGame.toFixed(1) : "-"}</dd></div>
        <div><dt>Allowed / game</dt><dd>{team.gamesPlayed ? team.pointsAllowedPerGame.toFixed(1) : "-"}</dd></div>
        <div><dt>Point diff</dt><dd>{team.gamesPlayed ? `${team.pointDifferential > 0 ? "+" : ""}${team.pointDifferential}` : "-"}</dd></div>
        {ratingLabel != null && (
          <div><dt>{displayAsGrade ? "Coach grade" : "Coach rating"}</dt><dd>{ratingLabel}{team.powerRank ? ` · #${team.powerRank}` : ""}</dd></div>
        )}
      </dl>
      <div className="matchup-preview__form" aria-label="Last five results">
        {team.last5.length
          ? team.last5.map((outcome, index) => <span key={index} className={`matchup-preview__form-chip is-${outcome.toLowerCase()}`}>{outcome}</span>)
          : <span className="matchup-preview__form-empty">No games yet</span>}
      </div>
    </div>
  );
}

export function MatchupPreview({ preview }: { preview: MatchupPreviewData }) {
  const { away, home, prediction, displayAsGrade } = preview;
  return (
    <section className="matchup-preview">
      <header className="matchup-preview__heading">
        <span>Scouting</span>
        <strong>Matchup Preview</strong>
      </header>

      <div className="matchup-preview__teams">
        <TeamColumn team={away} displayAsGrade={displayAsGrade} side="away" />
        <div className="matchup-preview__vs" aria-hidden="true">VS</div>
        <TeamColumn team={home} displayAsGrade={displayAsGrade} side="home" />
      </div>

      <div className="matchup-preview__prediction">
        <div className="matchup-preview__odds-head">
          <span className={prediction.favoredSide === "away" ? "is-favored" : ""}>{prediction.awayWinProbability}%</span>
          <em>Win probability</em>
          <span className={prediction.favoredSide === "home" ? "is-favored" : ""}>{prediction.homeWinProbability}%</span>
        </div>
        <div className="matchup-preview__odds-bar" role="img" aria-label={`Away ${prediction.awayWinProbability}%, home ${prediction.homeWinProbability}%`}>
          <span
            className="matchup-preview__odds-away"
            style={{ width: `${prediction.awayWinProbability}%`, "--team-color": away.primaryColor } as CSSProperties}
          />
          <span
            className="matchup-preview__odds-home"
            style={{ width: `${prediction.homeWinProbability}%`, "--team-color": home.primaryColor } as CSSProperties}
          />
        </div>
        <div className="matchup-preview__projection">
          <span className="matchup-preview__proj-label">Projected final</span>
          <span className="matchup-preview__proj-score">
            <b>{away.abbr ?? away.teamName}</b> {prediction.predictedAwayScore}
            <span className="matchup-preview__proj-dash">–</span>
            {prediction.predictedHomeScore} <b>{home.abbr ?? home.teamName}</b>
          </span>
        </div>
        {!preview.hasSeasonData && <p className="matchup-preview__note">{prediction.summary}</p>}
      </div>
    </section>
  );
}
