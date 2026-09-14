import type { TeamManagementSummaryRow } from "../../../../../web/src/types/api.js";
import { LoadingState } from "../../../../../web/src/components/ui/LoadingState.js";
import { ErrorState } from "../../../../../web/src/components/ui/ErrorState.js";
import {
  NflDivisionBoard,
  NflDivisionColumn,
  TeamColorBlock,
  useNflDivisionBuckets,
} from "../../../components/team/index.js";

export type DivisionTeamsBoardMode = "users" | "teams";

function formatRecord(team: TeamManagementSummaryRow) {
  const { wins, losses, ties } = team.record;
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function MgmtTeamBlock({
  team,
  mode,
  onTeamClick,
}: {
  team: TeamManagementSummaryRow;
  mode: DivisionTeamsBoardMode;
  onTeamClick?: (team: TeamManagementSummaryRow) => void;
}) {
  const open = !team.linkedUser;
  const interactive = mode === "teams" && onTeamClick;

  const details = mode === "users" ? (
    <dl className="hub-div-standing-mgmt-ids">
      <div>
        <dt>Site</dt>
        <dd>{team.linkedUser?.displayName?.trim() || "—"}</dd>
      </div>
      <div>
        <dt>Discord</dt>
        <dd>{team.linkedUser?.discordUsername?.trim() || "—"}</dd>
      </div>
      <div>
        <dt>EA</dt>
        <dd>{team.eaUsername?.trim() || "—"}</dd>
      </div>
    </dl>
  ) : (
    <small className="hub-div-standing-ea">
      {open ? "CPU - OPEN" : (team.eaUsername?.trim() || "—")}
    </small>
  );

  return (
    <TeamColorBlock
      abbreviation={team.abbreviation}
      displayAbbr={team.displayAbbr}
      originalAbbreviation={team.originalAbbreviation}
      primaryColor={team.primaryColor}
      logoUrl={team.logoUrl}
      displayCity={team.displayCity}
      displayNick={team.displayNick}
      name={team.name}
      title={team.name}
      className={open ? "is-open-team" : undefined}
      details={details}
      trailing={
        <>
          {open ? <span className="hub-div-standing-marker">OPEN</span> : null}
          <strong className="hub-div-standing-record">{formatRecord(team)}</strong>
        </>
      }
      onClick={interactive ? () => onTeamClick?.(team) : undefined}
    />
  );
}

export function DivisionTeamsBoard({
  teams,
  mode,
  loading,
  error,
  onTeamClick,
}: {
  teams: TeamManagementSummaryRow[] | null;
  mode: DivisionTeamsBoardMode;
  loading?: boolean;
  error?: string | null;
  onTeamClick?: (team: TeamManagementSummaryRow) => void;
}) {
  const board = useNflDivisionBuckets(teams ?? []);

  if (error) return <ErrorState message={error} />;
  if (loading || !teams) return <LoadingState label="Loading teams…" />;
  if (!teams.length) {
    return <p className="form-hint">No teams found for this league.</p>;
  }

  return (
    <>
      <NflDivisionBoard
        ariaLabel={mode === "users" ? "Manage users by division" : "Manage teams by division"}
        nfc={board.NFC}
        afc={board.AFC}
        renderColumn={(bucket) => (
          <NflDivisionColumn label={bucket.label}>
            {bucket.teams.map((team: TeamManagementSummaryRow) => (
              <MgmtTeamBlock
                key={team.id}
                team={team}
                mode={mode}
                onTeamClick={onTeamClick}
              />
            ))}
          </NflDivisionColumn>
        )}
      />
      {board.leftovers.length ? (
        <section className="hub-div-standing-card" style={{ marginTop: "var(--space-4)" }}>
          <header className="hub-div-standing-card-head">
            <span />
            <h3>Other</h3>
            <span />
          </header>
          <div className="hub-div-standing-stack">
            {board.leftovers.map((team) => (
              <MgmtTeamBlock
                key={team.id}
                team={team}
                mode={mode}
                onTeamClick={onTeamClick}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
