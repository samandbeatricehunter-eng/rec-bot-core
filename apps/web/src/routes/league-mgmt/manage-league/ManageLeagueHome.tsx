import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { CONFERENCE_ORDER } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { Card } from "../../../components/ui/Card.js";
import { Badge, type BadgeStatus } from "../../../components/ui/Badge.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

type OwnershipFilter = "all" | "linked" | "unlinked";
type ScheduleFilter = "all" | "empty" | "partial" | "complete";
type MissingFilter = "all" | "has_missing";

const SCHEDULE_STATUS_BADGE: Record<TeamManagementSummaryRow["scheduleStatus"], BadgeStatus> = {
  empty: "locked",
  partial: "pending",
  complete: "approved",
};

function conferenceSortKey(conference: string): number {
  const idx = CONFERENCE_ORDER.indexOf(conference as (typeof CONFERENCE_ORDER)[number]);
  return idx === -1 ? CONFERENCE_ORDER.length : idx;
}

// The main hub for finding a team, seeing its schedule/box-score health at a glance, and
// jumping into its full season entry + score actions (TeamScheduleForm.tsx). Team identity
// actions (link/unlink/relocate/rename) still live on the separate Teams tile for now — see
// the plan's Phase B for folding those in here too.
export function ManageLeagueHome() {
  const { guildId } = useReadyAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<{ teams: TeamManagementSummaryRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleFilter>("all");
  const [missing, setMissing] = useState<MissingFilter>("all");

  useEffect(() => {
    recApi
      .getTeamManagementSummary(guildId)
      .then((res) => setSummary(res))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load teams."));
  }, [guildId]);

  const filtered = useMemo(() => {
    if (!summary) return [];
    const q = query.trim().toLowerCase();
    return summary.teams.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (ownership === "linked" && !t.linkedUser) return false;
      if (ownership === "unlinked" && t.linkedUser) return false;
      if (scheduleStatus !== "all" && t.scheduleStatus !== scheduleStatus) return false;
      if (missing === "has_missing" && t.missingBoxScoreCount === 0) return false;
      return true;
    });
  }, [summary, query, ownership, scheduleStatus, missing]);

  const grouped = useMemo(() => {
    const byConference = new Map<string, TeamManagementSummaryRow[]>();
    for (const team of filtered) {
      const list = byConference.get(team.conference) ?? [];
      list.push(team);
      byConference.set(team.conference, list);
    }
    return [...byConference.entries()]
      .sort(([a], [b]) => conferenceSortKey(a) - conferenceSortKey(b) || a.localeCompare(b))
      .map(([conference, teams]) => {
        const divisions = new Set(teams.map((t) => t.division).filter(Boolean));
        const byDivision = divisions.size > 1
          ? [...new Set(teams.map((t) => t.division ?? "Other"))]
              .sort()
              .map((division) => ({ division, teams: teams.filter((t) => (t.division ?? "Other") === division) }))
          : [{ division: null, teams }];
        return { conference, groups: byDivision };
      });
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Manage League"
        subtitle="Find a team, see its schedule and box-score health, and enter its games and scores."
      />
      {error && <ErrorState message={error} />}
      {!summary && !error && <LoadingState label="Loading teams…" />}
      {summary && (
        <>
          <Card style={{ marginBottom: "var(--space-4)" }}>
            <SearchInput
              placeholder="Search teams…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ marginBottom: "var(--space-3)" }}
            />
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
                <label className="form-label" htmlFor="filter-ownership">Ownership</label>
                <select id="filter-ownership" className="form-select" value={ownership} onChange={(e) => setOwnership(e.target.value as OwnershipFilter)}>
                  <option value="all">All teams</option>
                  <option value="linked">Linked to a user</option>
                  <option value="unlinked">Open (unlinked)</option>
                </select>
              </div>
              <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
                <label className="form-label" htmlFor="filter-schedule">Schedule status</label>
                <select id="filter-schedule" className="form-select" value={scheduleStatus} onChange={(e) => setScheduleStatus(e.target.value as ScheduleFilter)}>
                  <option value="all">Any status</option>
                  <option value="empty">Empty</option>
                  <option value="partial">Partial</option>
                  <option value="complete">Complete</option>
                </select>
              </div>
              <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
                <label className="form-label" htmlFor="filter-missing">Box scores</label>
                <select id="filter-missing" className="form-select" value={missing} onChange={(e) => setMissing(e.target.value as MissingFilter)}>
                  <option value="all">All teams</option>
                  <option value="has_missing">Missing a box score</option>
                </select>
              </div>
            </div>
          </Card>

          {grouped.length === 0 && (
            <Card>
              <p style={{ margin: 0, color: "var(--text-secondary)" }}>No teams match.</p>
            </Card>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {grouped.map(({ conference, groups }) => (
              <div key={conference}>
                <h3 style={{ margin: "0 0 var(--space-2)", color: "var(--gold)" }}>{conference}</h3>
                {groups.map(({ division, teams }) => (
                  <div key={division ?? "flat"} style={{ marginBottom: "var(--space-3)" }}>
                    {division && (
                      <div style={{ margin: "0 0 var(--space-1)", color: "var(--text-secondary)", fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        {division}
                      </div>
                    )}
                    <Card style={{ padding: 0 }}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {teams.map((team) => (
                          <button
                            key={team.id}
                            onClick={() => navigate(`/league-mgmt/manage-league/${team.id}`)}
                            className="btn btn-ghost"
                            style={{
                              justifyContent: "space-between",
                              width: "100%",
                              textAlign: "left",
                              borderRadius: 0,
                              borderBottom: "1px solid var(--border)",
                              padding: "var(--space-3) var(--space-4)",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700 }}>{team.name}</span>
                              <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                                {team.linkedUser?.displayName ?? (team.linkedUser ? "Linked" : "Open")}
                              </span>
                              <Badge status={SCHEDULE_STATUS_BADGE[team.scheduleStatus]}>
                                {team.gamesScheduled}/{team.gamesExpected} games
                              </Badge>
                              {team.missingBoxScoreCount > 0 && (
                                <Badge status="denied">{team.missingBoxScoreCount} missing box score{team.missingBoxScoreCount === 1 ? "" : "s"}</Badge>
                              )}
                              {team.awaitingReviewCount > 0 && (
                                <Badge status="pending">{team.awaitingReviewCount} awaiting review</Badge>
                              )}
                              <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                                {team.record.wins}-{team.record.losses}{team.record.ties > 0 ? `-${team.record.ties}` : ""}
                              </span>
                            </div>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    </Card>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
