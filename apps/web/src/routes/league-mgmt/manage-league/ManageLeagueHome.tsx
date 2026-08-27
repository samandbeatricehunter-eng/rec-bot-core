import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Database, Inbox, Newspaper, Settings, UserPlus, Wrench } from "lucide-react";
import { CONFERENCE_ORDER } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { useLeagueTheme } from "../../../lib/league-theme-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { TeamManagementSummary, TeamManagementSummaryRow } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge, type BadgeStatus } from "../../../components/ui/Badge.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { PendingRosterAddRequests } from "./PendingRosterAddRequests.js";
import { RosterEditProposalQueue } from "./RosterEditProposalQueue.js";
import { ImportDataModal } from "./ImportDataModal.js";
import { ManualEntryPage } from "./ManualEntryPage.js";
import { TroubleshootModal } from "./TroubleshootModal.js";
import { ReportIssueModal } from "./ReportIssueModal.js";
import { TeamDropdown } from "./TeamDropdown.js";

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
// jumping into its full season entry + score actions (TeamScheduleForm.tsx). Roles and team
// linking are reachable from here (RolesHome.tsx/TeamOwnershipTable.tsx/LinkTeamForm.tsx,
// moved under this same route prefix) rather than being separate top-level nav destinations.
// Deep relocate/rename/custom-team actions per row are still future work — see the plan.
export function ManageLeagueHome({ mode = "schedule" }: { mode?: "schedule" | "roster" }) {
  const { guildId } = useReadyAuth();
  const { game } = useLeagueTheme();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<TeamManagementSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importDataOpen, setImportDataOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [troubleshootOpen, setTroubleshootOpen] = useState(false);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleFilter>("all");
  const [missing, setMissing] = useState<MissingFilter>("all");
  const [conferenceFilter, setConferenceFilter] = useState<string>("all");
  const isMadden = Boolean(game?.startsWith("madden_"));
  const dataMode = summary?.league.dataMode ?? null;

  useEffect(() => {
    recApi
      .getTeamManagementSummary(guildId)
      .then((res) => setSummary(res))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load teams."));
  }, [guildId]);

  // Built off the full team list (not the filtered subset) so picking a conference never
  // makes other conferences disappear from the dropdown itself.
  const availableConferences = useMemo(() => {
    if (!summary) return [];
    return [...new Set(summary.teams.map((t) => t.conference))].sort(
      (a, b) => conferenceSortKey(a) - conferenceSortKey(b) || a.localeCompare(b),
    );
  }, [summary]);

  const filtered = useMemo(() => {
    if (!summary) return [];
    const q = query.trim().toLowerCase();
    return summary.teams.filter((t) => {
      if (
        q &&
        !t.name.toLowerCase().includes(q) &&
        !(t.eaUsername ?? "").toLowerCase().includes(q) &&
        !(t.linkedUser?.displayName ?? "").toLowerCase().includes(q) &&
        !(t.linkedUser?.discordUsername ?? "").toLowerCase().includes(q)
      ) return false;
      if (conferenceFilter !== "all" && t.conference !== conferenceFilter) return false;
      if (ownership === "linked" && !t.linkedUser) return false;
      if (ownership === "unlinked" && t.linkedUser) return false;
      if (scheduleStatus !== "all" && t.scheduleStatus !== scheduleStatus) return false;
      if (missing === "has_missing" && t.missingBoxScoreCount === 0) return false;
      return true;
    });
  }, [summary, query, conferenceFilter, ownership, scheduleStatus, missing]);

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
        const byDivision = new Map<string, TeamManagementSummaryRow[]>();
        for (const team of teams) {
          // Normalize division: strip conference prefix if present (e.g. "AFC West" -> "West")
          let div = team.division && team.division.trim() ? team.division : "Other";
          const confPrefix = conference.toUpperCase() + " ";
          if (div.toUpperCase().startsWith(confPrefix)) div = div.slice(confPrefix.length).trim();
          if (!div) div = "Other";
          const list = byDivision.get(div) ?? [];
          list.push(team);
          byDivision.set(div, list);
        }
        const groups = [...byDivision.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([division, divTeams]) => ({ division, teams: divTeams }));
        return { conference, groups };
      });
  }, [filtered]);

  // Manual entry replaces the division-card view until the user navigates back.
  if (manualEntry && summary) {
    return <ManualEntryPage summary={summary} onBack={() => setManualEntry(false)} />;
  }

  return (
    <div>
      <PageHeader
        title={mode === "roster" ? "Edit Rosters" : "Manage League"}
        subtitle={mode === "roster" ? "Find a team and add or review players on its roster." : "Find a team, see its schedule and box-score health, and enter its games and scores."}
        actions={
          mode === "roster" ? undefined : (
            <div className="manage-league-header-actions">
              {isMadden && dataMode === "import" && summary && (
                <Button variant="secondary" onClick={() => setImportDataOpen(true)}>
                  <Database size={16} /> Import Data
                </Button>
              )}
              {dataMode === "manual" && summary && (
                <Button variant="secondary" onClick={() => setManualEntry(true)}>
                  <Database size={16} /> Manual Entry
                </Button>
              )}
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/notifications")}>
                <Inbox size={16} /> Pending Items
              </Button>
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/publishing")}>
                <Newspaper size={16} /> Generate Media
              </Button>
              <Button variant="secondary" onClick={() => setTroubleshootOpen(true)}>
                <Wrench size={16} /> Tools
              </Button>
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/settings")}>
                <Settings size={16} /> Settings
              </Button>
              <Button variant="secondary" onClick={() => setReportIssueOpen(true)}>
                <AlertTriangle size={16} /> Report Issue
              </Button>
            </div>
          )
        }
      />
      {mode === "roster" && <PendingRosterAddRequests guildId={guildId} />}
      {mode === "roster" && dataMode === "manual" && <RosterEditProposalQueue guildId={guildId} />}
      {error && <ErrorState message={error} />}
      {notice && <p className="form-hint">{notice}</p>}
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
                <label className="form-label" htmlFor="filter-conference">Conference</label>
                <select id="filter-conference" className="form-select" value={conferenceFilter} onChange={(e) => setConferenceFilter(e.target.value)}>
                  <option value="all">All conferences</option>
                  {availableConferences.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="form-field" style={{ margin: 0, minWidth: 160 }}>
                <label className="form-label" htmlFor="filter-ownership">Ownership</label>
                <select id="filter-ownership" className="form-select" value={ownership} onChange={(e) => setOwnership(e.target.value as OwnershipFilter)}>
                  <option value="all">All teams</option>
                  <option value="linked">Linked to a user</option>
                  <option value="unlinked">Open (unlinked)</option>
                </select>
              </div>
              {mode === "schedule" && (
                <>
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
                </>
              )}
            </div>
          </Card>

          {grouped.length === 0 && (
            <Card>
              <p style={{ margin: 0, color: "var(--text-secondary)" }}>No teams match.</p>
            </Card>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            {grouped.map(({ conference, groups }) => (
              <section key={conference}>
                <h3 style={{ margin: "0 0 var(--space-3)", color: "var(--gold)", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.06em" }}>{conference}</h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "var(--space-3)",
                  }}
                >
                  {groups.map(({ division, teams }) => (
                    <Card key={division ?? "flat"} style={{ padding: 0 }}>
                      {division && (
                        <div style={{ padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", textAlign: "center" }}>
                          {division}
                        </div>
                      )}
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        {teams.map((team) => (
                          <div
                            key={team.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "var(--space-2)",
                              borderBottom: "1px solid var(--border)",
                              padding: "var(--space-2) var(--space-2) var(--space-2) var(--space-3)",
                            }}
                          >
                            <button
                              onClick={() => navigate(mode === "roster" ? `/league-mgmt/manage-league/rosters/${team.id}` : `/league-mgmt/manage-league/${team.id}`)}
                              className="btn btn-ghost"
                              style={{ flex: 1, justifyContent: "flex-start", textAlign: "left", padding: "var(--space-1) var(--space-2)", minWidth: 0 }}
                            >
                              <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
                                  <span style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team.name}</span>
                                  <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                                    {team.linkedUser?.displayName ?? "CPU"}
                                  </span>
                                  {team.linkedUser?.discordId && (
                                    <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                                      ({team.linkedUser.discordUsername ?? team.linkedUser.displayName ?? team.linkedUser.discordId})
                                    </span>
                                  )}
                                  {team.eaUsername && (
                                    <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                                      (EA Name: {team.eaUsername})
                                    </span>
                                  )}
                                  {team.linkedUser?.role && team.linkedUser.role !== "member" && (
                                    <span style={{ color: "var(--gold)", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>
                                      {team.linkedUser.role === "co_commissioner" ? "Co-Commish" : team.linkedUser.role === "commissioner" ? "Commish" : team.linkedUser.role}
                                    </span>
                                  )}
                                  <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                                    {team.record.wins}-{team.record.losses}{team.record.ties > 0 ? `-${team.record.ties}` : ""}
                                  </span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                                  {team.pendingRequest && (
                                    <Badge status="pending">request pending</Badge>
                                  )}
                                  {mode === "schedule" && (
                                    <Badge status={SCHEDULE_STATUS_BADGE[team.scheduleStatus]}>
                                      {team.gamesScheduled}/{team.gamesExpected}
                                    </Badge>
                                  )}
                                  {mode === "schedule" && team.missingBoxScoreCount > 0 && (
                                    <Badge status="denied">{team.missingBoxScoreCount} missing</Badge>
                                  )}
                                </div>
                              </div>
                            </button>
                            <TeamDropdown
                              team={team}
                              guildId={guildId}
                              leagueId={summary.league.id}
                              isMadden={isMadden}
                              onAction={(message) => {
                                setNotice(message);
                                void recApi.getTeamManagementSummary(guildId).then(setSummary);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
      {importDataOpen && summary && (
        <ImportDataModal
          guildId={guildId}
          leagueId={summary.league.id}
          onClose={() => setImportDataOpen(false)}
        />
      )}
      {troubleshootOpen && (
        <TroubleshootModal
          guildId={guildId}
          leagueId={summary?.league.id}
          showImportAudit={isMadden && dataMode === "import"}
          onClose={() => setTroubleshootOpen(false)}
        />
      )}
      {reportIssueOpen && (
        <ReportIssueModal guildId={guildId} onClose={() => setReportIssueOpen(false)} />
      )}
    </div>
  );
}
