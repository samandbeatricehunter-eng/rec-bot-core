import { useMemo } from "react";
import { CONFERENCE_ORDER } from "@rec/shared";
import type { TeamManagementSummaryRow } from "../../../../../web/src/types/api.js";
import { Card } from "../../../../../web/src/components/ui/Card.js";
import { LoadingState } from "../../../../../web/src/components/ui/LoadingState.js";
import { ErrorState } from "../../../../../web/src/components/ui/ErrorState.js";

function conferenceSortKey(conference: string): number {
  const idx = CONFERENCE_ORDER.indexOf(conference as (typeof CONFERENCE_ORDER)[number]);
  return idx === -1 ? CONFERENCE_ORDER.length : idx;
}

function groupByConferenceDivision(teams: TeamManagementSummaryRow[]) {
  const byConference = new Map<string, TeamManagementSummaryRow[]>();
  for (const team of teams) {
    const conference = team.conference?.trim() || "Other";
    const list = byConference.get(conference) ?? [];
    list.push(team);
    byConference.set(conference, list);
  }

  return [...byConference.entries()]
    .sort(([a], [b]) => conferenceSortKey(a) - conferenceSortKey(b) || a.localeCompare(b))
    .map(([conference, confTeams]) => {
      const byDivision = new Map<string, TeamManagementSummaryRow[]>();
      for (const team of confTeams) {
        let div = team.division?.trim() || "Other";
        const confPrefix = `${conference.toUpperCase()} `;
        if (div.toUpperCase().startsWith(confPrefix)) div = div.slice(confPrefix.length).trim();
        if (!div) div = "Other";
        const list = byDivision.get(div) ?? [];
        list.push(team);
        byDivision.set(div, list);
      }
      const groups = [...byDivision.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([division, divTeams]) => ({
          division,
          teams: [...divTeams].sort((a, b) => a.name.localeCompare(b.name)),
        }));
      return { conference, groups };
    });
}

export type DivisionTeamsBoardMode = "users" | "teams";

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
  const grouped = useMemo(
    () => (teams ? groupByConferenceDivision(teams) : []),
    [teams],
  );

  if (error) return <ErrorState message={error} />;
  if (loading || !teams) return <LoadingState label="Loading teams…" />;
  if (!grouped.length) {
    return (
      <Card>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>No teams found.</p>
      </Card>
    );
  }

  return (
    <div className="mgmt-division-board">
      {grouped.map(({ conference, groups }) => (
        <section key={conference} className="mgmt-division-conference">
          <h3 className="mgmt-division-conference-title">{conference}</h3>
          <div className="mgmt-division-grid">
            {groups.map(({ division, teams: divTeams }) => (
              <Card key={division} className="mgmt-division-card">
                <header className="mgmt-division-card-head">{division}</header>
                <div className="mgmt-division-team-list">
                  {divTeams.map((team) => {
                    const open = !team.linkedUser;
                    const interactive = mode === "teams" && onTeamClick;
                    const body = (
                      <>
                        <div className="mgmt-division-team-title">
                          <strong>{team.name}</strong>
                          {open ? <span className="mgmt-division-open-tag">CPU - OPEN</span> : null}
                        </div>
                        {mode === "users" ? (
                          <dl className="mgmt-division-identity-list">
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
                          <dl className="mgmt-division-identity-list mgmt-division-identity-list-compact">
                            <div>
                              <dt>EA</dt>
                              <dd>{open ? "CPU - OPEN" : (team.eaUsername?.trim() || "—")}</dd>
                            </div>
                          </dl>
                        )}
                      </>
                    );

                    if (interactive) {
                      return (
                        <button
                          key={team.id}
                          type="button"
                          className="mgmt-division-team-block is-clickable"
                          onClick={() => onTeamClick(team)}
                        >
                          {body}
                        </button>
                      );
                    }

                    return (
                      <article key={team.id} className="mgmt-division-team-block">
                        {body}
                      </article>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
