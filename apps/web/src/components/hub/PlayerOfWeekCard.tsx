import { TeamLogo } from "../ui/TeamLogo.js";
import { PlayerPhoto } from "./PlayerPhoto.js";

type StatLine = {
  passYards: number; rushYards: number; receivingYards: number;
  passTds: number; rushTds: number; receivingTds: number;
  interceptionsThrown: number; rushingFumbles: number;
  sacks: number; interceptions: number; forcedFumbles: number; fumbleRecoveries: number;
  tacklesForLoss: number; defensiveTds: number; tackles: number;
};

export type PlayerOfWeekCardWinner = {
  conference: "AFC" | "NFC";
  side: "offense" | "defense";
  playerName: string;
  position: string | null;
  teamName: string;
  teamAbbr: string | null;
  teamLogoUrl: string | null;
  photoUrl: string | null;
  statLine: StatLine;
};

// Mirrors the in-game "Top Players" card's line-by-line stat presentation as closely as our
// data allows -- EA's export doesn't give us attempts/completions/carries/averages, only the
// canonical totals (passYards, rushTds, etc.), so lines are built from what we actually have
// rather than trying to fake the missing granularity.
function offenseLines(s: StatLine): string[] {
  const lines: string[] = [];
  if (s.passYards > 0 || s.passTds > 0) lines.push(`${s.passYards} PASS YDS, ${s.passTds} PASS TD`);
  if (s.rushYards > 0 || s.rushTds > 0) lines.push(`${s.rushYards} RUSH YDS, ${s.rushTds} RUSH TD`);
  if (s.receivingYards > 0 || s.receivingTds > 0) lines.push(`${s.receivingYards} REC YDS, ${s.receivingTds} REC TD`);
  const turnovers = s.interceptionsThrown + s.rushingFumbles;
  if (turnovers > 0) lines.push(`${turnovers} TURNOVER${turnovers === 1 ? "" : "S"}`);
  return lines.length ? lines : ["No offensive stats logged"];
}

function defenseLines(s: StatLine): string[] {
  const parts: string[] = [];
  if (s.tackles > 0) parts.push(`${s.tackles} TKL`);
  if (s.sacks > 0) parts.push(`${s.sacks} SACK${s.sacks === 1 ? "" : "S"}`);
  if (s.interceptions > 0) parts.push(`${s.interceptions} INT`);
  if (s.forcedFumbles > 0) parts.push(`${s.forcedFumbles} FF`);
  if (s.fumbleRecoveries > 0) parts.push(`${s.fumbleRecoveries} FR`);
  if (s.tacklesForLoss > 0) parts.push(`${s.tacklesForLoss} TFL`);
  if (s.defensiveTds > 0) parts.push(`${s.defensiveTds} TD`);
  return parts.length ? [parts.join(", ")] : ["No defensive stats logged"];
}

function Panel({ label, winner }: { label: string; winner: PlayerOfWeekCardWinner | undefined }) {
  const confClass = winner?.conference === "AFC" ? "afc" : winner?.conference === "NFC" ? "nfc" : "";
  return (
    <div className="potw-panel">
      <header className={confClass}>{label}</header>
      {winner ? (
        <div className="potw-panel-body">
          <PlayerPhoto
            photoUrl={winner.photoUrl}
            alt={winner.playerName}
            className="potw-photo"
            fallback={
              <div className={`potw-conf-badge ${confClass}`}>
                {winner.conference === "AFC" ? "A" : "N"}
              </div>
            }
          />
          <div className="potw-panel-info">
            {winner.position ? <small>{winner.position}</small> : null}
            <strong>{winner.playerName}</strong>
            <div className="potw-panel-stats">
              {(winner.side === "offense" ? offenseLines(winner.statLine) : defenseLines(winner.statLine)).map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>
          </div>
          <TeamLogo abbreviation={winner.teamAbbr} logoUrl={winner.teamLogoUrl} alt={winner.teamName} className="potw-team-logo" priority />
        </div>
      ) : (
        <div className="potw-panel-body potw-panel-empty">No qualifying performance</div>
      )}
    </div>
  );
}

export function PlayerOfWeekCard({ weekNumber, winners }: { weekNumber: number; winners: PlayerOfWeekCardWinner[] }) {
  const find = (conference: "AFC" | "NFC", side: "offense" | "defense") =>
    winners.find((w) => w.conference === conference && w.side === side);

  return (
    <div className="potw-card" data-potw-render>
      <div className="potw-grid">
        <Panel label="AFC Offense" winner={find("AFC", "offense")} />
        <Panel label="NFC Offense" winner={find("NFC", "offense")} />
        <Panel label="AFC Defense" winner={find("AFC", "defense")} />
        <Panel label="NFC Defense" winner={find("NFC", "defense")} />
      </div>
      <footer className="potw-footer">Player of the Week &middot; Week {weekNumber}</footer>
    </div>
  );
}
