import type { MatchupPreview, MatchupTeamBreakdown } from "../../types/api.js";

function ranked(value: number, rank: number | null, suffix = "") {
  if (rank == null) return <><strong>—</strong><small>No data</small></>;
  const signed = suffix === " signed" && value > 0 ? "+" : "";
  return <><strong>{signed}{value.toFixed(Number.isInteger(value) ? 0 : 1)}</strong><small>#{rank} in league</small></>;
}

function comparisonRows(team: MatchupTeamBreakdown) {
  return [
    { key: "pass-for", label: "Passing yards / game", value: ranked(team.passingYardsPerGame, team.passingYardsRank) },
    { key: "pass-allowed", label: "Passing yards allowed / game", value: ranked(team.passingYardsAllowedPerGame, team.passingYardsAllowedRank) },
    { key: "rush-for", label: "Rushing yards / game", value: ranked(team.rushingYardsPerGame, team.rushingYardsRank) },
    { key: "rush-allowed", label: "Rushing yards allowed / game", value: ranked(team.rushingYardsAllowedPerGame, team.rushingYardsAllowedRank) },
    { key: "point-diff", label: "Point differential", value: ranked(team.pointDifferential, team.pointDifferentialRank, " signed") },
    { key: "turnover-diff", label: "Turnover differential", value: ranked(team.turnoverDifferential, team.turnoverDifferentialRank, " signed") },
  ];
}

export function HeroMatchupBreakdown({ preview }: { preview: MatchupPreview }) {
  const awayRows = comparisonRows(preview.away);
  const homeRows = comparisonRows(preview.home);
  return <section className="hub-hero-breakdown" aria-label="Matchup stat comparison">
    <div className="hub-hero-breakdown-head">
      <div><small>Away</small><strong>{preview.away.abbr ?? preview.away.teamName}</strong></div>
      <span>Matchup Breakdown</span>
      <div><small>Home</small><strong>{preview.home.abbr ?? preview.home.teamName}</strong></div>
    </div>
    <div className="hub-hero-comparison-grid">
      {awayRows.map((awayRow, index) => <div className="hub-hero-comparison-row" key={awayRow.key}>
        <div>{awayRow.value}</div>
        <span>{awayRow.label}</span>
        <div>{homeRows[index].value}</div>
      </div>)}
    </div>
    <footer className="hub-hero-prediction">
      <span>Predicted Score</span>
      <strong>{preview.away.abbr ?? preview.away.teamName} {preview.prediction.predictedAwayScore} <em>–</em> {preview.prediction.predictedHomeScore} {preview.home.abbr ?? preview.home.teamName}</strong>
      <small>{preview.prediction.awayWinProbability}% away · {preview.prediction.homeWinProbability}% home</small>
    </footer>
  </section>;
}
