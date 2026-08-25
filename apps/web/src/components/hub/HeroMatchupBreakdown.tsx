import type { CSSProperties } from "react";
import type { MatchupPreview, MatchupTeamBreakdown, WagerOptionsResponse } from "../../types/api.js";
import { PositionMatchupAdvantages } from "../matchups/PositionMatchupAdvantages.js";

const FALLBACK_PRIMARY = "#8a94a6";

function rankLabel(rank: number | null, missingRankLabel = "Rank unavailable") {
  return rank == null ? missingRankLabel : `#${rank} in league`;
}

function formatValue(value: number, suffix = "") {
  const signed = suffix === " signed" && value > 0 ? "+" : "";
  return `${signed}${value.toFixed(Number.isInteger(value) ? 0 : 1)}`;
}

type StatRow = { key: string; label: string; awayValue: number; awayRank: number | null; homeValue: number; homeRank: number | null; suffix?: string };

function statRows(away: MatchupTeamBreakdown, home: MatchupTeamBreakdown) {
  return [
    { label: null as string | null, rows: [
      { key: "points-for", label: "Points / game", awayValue: away.pointsPerGame, awayRank: away.pointsPerGameRank, homeValue: home.pointsPerGame, homeRank: home.pointsPerGameRank },
      { key: "points-allowed", label: "Points allowed / game", awayValue: away.pointsAllowedPerGame, awayRank: away.pointsAllowedPerGameRank, homeValue: home.pointsAllowedPerGame, homeRank: home.pointsAllowedPerGameRank },
      { key: "point-diff", label: "Point differential", awayValue: away.pointDifferential, awayRank: away.pointDifferentialRank, homeValue: home.pointDifferential, homeRank: home.pointDifferentialRank, suffix: " signed" },
    ] as StatRow[] },
    { label: "Offensive", rows: [
      { key: "pass-for", label: "Passing yards / game", awayValue: away.passingYardsPerGame, awayRank: away.passingYardsRank, homeValue: home.passingYardsPerGame, homeRank: home.passingYardsRank },
      { key: "rush-for", label: "Rushing yards / game", awayValue: away.rushingYardsPerGame, awayRank: away.rushingYardsRank, homeValue: home.rushingYardsPerGame, homeRank: home.rushingYardsRank },
    ] as StatRow[] },
    { label: "Defensive", rows: [
      { key: "pass-allowed", label: "Passing yards allowed / game", awayValue: away.passingYardsAllowedPerGame, awayRank: away.passingYardsAllowedRank, homeValue: home.passingYardsAllowedPerGame, homeRank: home.passingYardsAllowedRank },
      { key: "rush-allowed", label: "Rushing yards allowed / game", awayValue: away.rushingYardsAllowedPerGame, awayRank: away.rushingYardsAllowedRank, homeValue: home.rushingYardsAllowedPerGame, homeRank: home.rushingYardsAllowedRank },
      { key: "turnover-diff", label: "Turnover differential", awayValue: away.turnoverDifferential, awayRank: away.turnoverDifferentialRank, homeValue: home.turnoverDifferential, homeRank: home.turnoverDifferentialRank, suffix: " signed" },
    ] as StatRow[] },
  ];
}

// Bar length reflects each side's magnitude relative to whichever side is larger for that row
// (not "which side is better" -- a bigger Points Allowed bar just means a bigger number, same
// as the reference design). A floor keeps a genuine 0 from rendering as an invisible sliver.
function barWidthPct(value: number, other: number): number {
  const max = Math.max(Math.abs(value), Math.abs(other));
  if (max <= 0) return 6;
  return Math.max(6, Math.round((Math.abs(value) / max) * 100));
}

export function HeroMatchupBreakdown({ preview, wagerOptions }: { preview: MatchupPreview; wagerOptions?: WagerOptionsResponse | null }) {
  const { away, home } = preview;
  const awayPrimary = away.primaryColor && away.primaryColor !== "#FFFFFF" ? away.primaryColor : FALLBACK_PRIMARY;
  const homePrimary = home.primaryColor && home.primaryColor !== "#FFFFFF" ? home.primaryColor : FALLBACK_PRIMARY;
  const cardStyle = {
    "--away-primary": awayPrimary,
    "--home-primary": homePrimary,
    "--away-secondary": away.secondaryColor ?? awayPrimary,
    "--home-secondary": home.secondaryColor ?? homePrimary,
  } as CSSProperties;

  return <section className="hub-hero-breakdown" aria-label="Matchup stat comparison" style={cardStyle}>
    <div className="hub-hero-breakdown-head">
      <div className="hub-hero-breakdown-side away"><small>Away</small><strong>{away.abbr ?? away.teamName}</strong></div>
      <span>Matchup Breakdown</span>
      <div className="hub-hero-breakdown-side home"><small>Home</small><strong>{home.abbr ?? home.teamName}</strong></div>
    </div>
    <div className="hub-hero-comparison-grid">
      {statRows(away, home).map((group) => <div className="hub-hero-comparison-group" key={group.label ?? "scoring"}>
        {group.label ? <h3>{group.label}</h3> : null}
        {group.rows.map((row) => {
          const awayPct = barWidthPct(row.awayValue, row.homeValue);
          const homePct = barWidthPct(row.homeValue, row.awayValue);
          return <div className="hub-hero-comparison-row" key={row.key}>
            <div className="hub-hero-comparison-figure away">
              <strong>{formatValue(row.awayValue, row.suffix)}</strong>
              <small>{rankLabel(row.awayRank)}</small>
            </div>
            <div className="hub-hero-comparison-bar away"><span style={{ width: `${awayPct}%` }} /></div>
            <span className="hub-hero-comparison-label">{row.label}</span>
            <div className="hub-hero-comparison-bar home"><span style={{ width: `${homePct}%` }} /></div>
            <div className="hub-hero-comparison-figure home">
              <strong>{formatValue(row.homeValue, row.suffix)}</strong>
              <small>{rankLabel(row.homeRank)}</small>
            </div>
          </div>;
        })}
      </div>)}
    </div>
    <PositionMatchupAdvantages away={preview.away} home={preview.home} wagerOptions={wagerOptions} />
    <footer className="hub-hero-prediction">
      <span>Predicted Score</span>
      <strong>{away.abbr ?? away.teamName} {preview.prediction.predictedAwayScore} <em>–</em> {preview.prediction.predictedHomeScore} {home.abbr ?? home.teamName}</strong>
      <small>{preview.prediction.awayWinProbability}% away · {preview.prediction.homeWinProbability}% home</small>
    </footer>
  </section>;
}
