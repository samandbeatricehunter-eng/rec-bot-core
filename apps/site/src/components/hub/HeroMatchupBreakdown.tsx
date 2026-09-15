import type { MatchupPreview, MatchupTeamBreakdown } from "../../types/api.js";

function rankLabel(rank: number | null, missingRankLabel = "Unranked") {
  return rank == null ? missingRankLabel : `#${rank}`;
}

function ranked(value: number, rank: number | null, suffix = "") {
  const signed = suffix === " signed" && value > 0 ? "+" : "";
  return <><strong>{signed}{value.toFixed(Number.isInteger(value) ? 0 : 1)}</strong><small>{rankLabel(rank)}</small></>;
}

function comparisonGroups(team: MatchupTeamBreakdown) {
  return [
    { label: null, rows: [
    { key: "points-for", label: "Points / game", value: ranked(team.pointsPerGame, team.pointsPerGameRank) },
    { key: "points-allowed", label: "Points allowed / game", value: ranked(team.pointsAllowedPerGame, team.pointsAllowedPerGameRank) },
    { key: "point-diff", label: "Point differential", value: ranked(team.pointDifferential, team.pointDifferentialRank, " signed") },
    ] },
    { label: "Offensive", rows: [
    { key: "pass-for", label: "Passing yards / game", value: ranked(team.passingYardsPerGame, team.passingYardsRank) },
    { key: "rush-for", label: "Rushing yards / game", value: ranked(team.rushingYardsPerGame, team.rushingYardsRank) },
    ] },
    { label: "Defensive", rows: [
    { key: "pass-allowed", label: "Passing yards allowed / game", value: ranked(team.passingYardsAllowedPerGame, team.passingYardsAllowedRank) },
    { key: "rush-allowed", label: "Rushing yards allowed / game", value: ranked(team.rushingYardsAllowedPerGame, team.rushingYardsAllowedRank) },
    { key: "turnover-diff", label: "Turnover differential", value: ranked(team.turnoverDifferential, team.turnoverDifferentialRank, " signed") },
    ] },
  ];
}

export function HeroMatchupBreakdown({ preview }: { preview: MatchupPreview }) {
  const awayGroups = comparisonGroups(preview.away);
  const homeGroups = comparisonGroups(preview.home);
  return <section className="hub-hero-breakdown" aria-label="Matchup stat comparison">
    <div className="hub-hero-breakdown-head">
      <div><small>Away</small><strong>{preview.away.abbr ?? preview.away.teamName}</strong></div>
      <span>Matchup Breakdown</span>
      <div><small>Home</small><strong>{preview.home.abbr ?? preview.home.teamName}</strong></div>
    </div>
    <div className="hub-hero-comparison-grid">
      {awayGroups.map((group, groupIndex) => <div className="hub-hero-comparison-group" key={group.label ?? "scoring"}>
        {group.label ? <h3>{group.label}</h3> : null}
        {group.rows.map((awayRow, rowIndex) => <div className="hub-hero-comparison-row" key={awayRow.key}>
          <div>{awayRow.value}</div><span>{awayRow.label}</span><div>{homeGroups[groupIndex].rows[rowIndex].value}</div>
        </div>)}
      </div>)}
    </div>
    <footer className="hub-hero-prediction">
      <span>Predicted Score</span>
      <strong>{preview.away.abbr ?? preview.away.teamName} {preview.prediction.predictedAwayScore} <em>–</em> {preview.prediction.predictedHomeScore} {preview.home.abbr ?? preview.home.teamName}</strong>
      <small>{preview.prediction.awayWinProbability}% away · {preview.prediction.homeWinProbability}% home</small>
    </footer>
  </section>;
}
