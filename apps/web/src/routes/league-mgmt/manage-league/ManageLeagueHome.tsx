import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, ChevronRight, GraduationCap, ListOrdered, Newspaper, Settings, Shield, ShieldAlert, Trophy, UserPlus, Users, Wrench } from "lucide-react";
import { CONFERENCE_ORDER } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { useLeagueTheme } from "../../../lib/league-theme-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { TeamManagementSummaryRow } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { SearchInput } from "../../../components/ui/SearchInput.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge, type BadgeStatus } from "../../../components/ui/Badge.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { PendingRosterAddRequests } from "./PendingRosterAddRequests.js";
import { RepairGameChannelsModal } from "./RepairGameChannelsModal.js";

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
  const [summary, setSummary] = useState<{ teams: TeamManagementSummaryRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repairChannelsOpen, setRepairChannelsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleFilter>("all");
  const [missing, setMissing] = useState<MissingFilter>("all");
  const [conferenceFilter, setConferenceFilter] = useState<string>("all");
  const [draftOrderOpen, setDraftOrderOpen] = useState(false);
  const isMadden = game === "madden_26" || game === "madden_27";

  useEffect(() => {
    recApi
      .getTeamManagementSummary(guildId)
      .then((res) => setSummary(res))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load teams."));
  }, [guildId]);

  function handleGameChannelsRepaired(message: string) {
    setRepairChannelsOpen(false);
    setNotice(message);
  }

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
      if (q && !t.name.toLowerCase().includes(q)) return false;
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
        title={mode === "roster" ? "Edit Rosters" : "Manage League"}
        subtitle={mode === "roster" ? "Find a team and add or review players on its roster." : "Find a team, see its schedule and box-score health, and enter its games and scores."}
        actions={
          mode === "roster" ? undefined : (
            <div className="manage-league-header-actions">
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/manage-league/teams")}>
                <Users size={16} /> Link/Unlink Teams
              </Button>
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/manage-league/roles")}>
                <Shield size={16} /> Manage Roles
              </Button>
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/manage-league/player-stats")}><BarChart3 size={16}/> Player Stats</Button>
              {isMadden && <Button variant="secondary" onClick={() => setDraftOrderOpen((open) => !open)}><ListOrdered size={16}/> Upcoming Draft Order</Button>}
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/manage-league/postseason")}><Trophy size={16}/> CFP, Bowls & Top 25</Button>
              {game === "cfb_27" && <Button variant="secondary" onClick={() => navigate("/league-mgmt/recruiting")}><GraduationCap size={16}/> Recruits</Button>}
              {isMadden && <Button variant="secondary" onClick={() => navigate("/league-mgmt/manage-league/rosters")}><UserPlus size={16}/> Edit Rosters</Button>}
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/settings?category=moderation")}><ShieldAlert size={16}/> Bans & Restrictions</Button>
              <Button variant="secondary" onClick={() => setRepairChannelsOpen(true)}>
                <Wrench size={16}/> Repair Game Channels
              </Button>
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/settings")}>
                <Settings size={16} /> Settings
              </Button>
              <Button variant="secondary" onClick={() => navigate("/league-mgmt/publishing")}>
                <Newspaper size={16} /> Media
              </Button>
            </div>
          )
        }
      />
      {mode === "roster" && <PendingRosterAddRequests guildId={guildId} />}
      {mode === "schedule" && isMadden && draftOrderOpen && summary && <UpcomingDraftOrder guildId={guildId} teams={summary.teams} />}
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
                          <div
                            key={team.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "var(--space-3)",
                              borderBottom: "1px solid var(--border)",
                              padding: "var(--space-1) var(--space-2) var(--space-1) var(--space-4)",
                            }}
                          >
                            <button
                              onClick={() => navigate(mode === "roster" ? `/league-mgmt/manage-league/rosters/${team.id}` : `/league-mgmt/manage-league/${team.id}`)}
                              className="btn btn-ghost"
                              style={{ flex: 1, justifyContent: "flex-start", textAlign: "left", padding: "var(--space-2)" }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 700 }}>{team.name}</span>
                                <span style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                                  {team.linkedUser?.displayName ?? "Open"}
                                </span>
                                {mode === "schedule" && (
                                  <Badge status={SCHEDULE_STATUS_BADGE[team.scheduleStatus]}>
                                    {team.gamesScheduled}/{team.gamesExpected} games
                                  </Badge>
                                )}
                                {mode === "schedule" && team.missingBoxScoreCount > 0 && (
                                  <Badge status="denied">{team.missingBoxScoreCount} missing box score{team.missingBoxScoreCount === 1 ? "" : "s"}</Badge>
                                )}
                                {mode === "schedule" && team.awaitingReviewCount > 0 && (
                                  <Badge status="pending">{team.awaitingReviewCount} awaiting review</Badge>
                                )}
                                <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                                  {team.record.wins}-{team.record.losses}{team.record.ties > 0 ? `-${team.record.ties}` : ""}
                                </span>
                              </div>
                            </button>
                            {!team.linkedUser && (
                              <Button
                                variant="secondary"
                                onClick={() => navigate(`/league-mgmt/manage-league/teams/link?teamId=${team.id}`)}
                              >
                                <UserPlus size={14} /> Link
                              </Button>
                            )}
                            <ChevronRight size={16} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                          </div>
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
      {repairChannelsOpen && (
        <RepairGameChannelsModal
          guildId={guildId}
          onClose={() => setRepairChannelsOpen(false)}
          onDone={handleGameChannelsRepaired}
        />
      )}
    </div>
  );
}

function UpcomingDraftOrder({ guildId, teams }: { guildId: string; teams: TeamManagementSummaryRow[] }) {
  const [picks, setPicks] = useState<Array<{ season_number: number; round: number; original_team_id: string; pick_number: number | null }>>([]);
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [slots, setSlots] = useState<string[]>(Array(32).fill(""));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void recApi.listLeagueDraftPicks(guildId).then(setPicks); }, [guildId]);
  const seasons = useMemo(() => [...new Set(picks.map((pick) => pick.season_number))].sort((a, b) => a - b), [picks]);
  useEffect(() => { if (seasons.length && !seasons.includes(seasonNumber)) setSeasonNumber(seasons[0]); }, [seasons, seasonNumber]);
  useEffect(() => {
    const classPicks = picks.filter((pick) => pick.season_number === seasonNumber);
    const seeded = Array(32).fill("") as string[];
    for (const pick of [...classPicks].sort((a, b) => a.round - b.round)) {
      if (pick.pick_number && !seeded[pick.pick_number - 1]) seeded[pick.pick_number - 1] = pick.original_team_id;
    }
    const assigned = new Set(seeded.filter(Boolean));
    const remaining = teams.map((team) => team.id).filter((id) => !assigned.has(id));
    for (let index = 0; index < seeded.length; index++) if (!seeded[index]) seeded[index] = remaining.shift() ?? "";
    setSlots(seeded);
  }, [picks, seasonNumber, teams]);
  const complete = slots.length === 32 && new Set(slots.filter(Boolean)).size === 32;
  async function save() {
    setBusy(true); setMessage(null);
    try {
      const result = await recApi.setUpcomingDraftOrder({ guildId, seasonNumber, orderedTeamIds: slots });
      setMessage(`Saved Season ${result.seasonNumber} order across ${result.updated} standard picks.`);
      setPicks(await recApi.listLeagueDraftPicks(guildId));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Failed to save draft order."); }
    finally { setBusy(false); }
  }
  return <Card style={{ marginBottom: "var(--space-4)" }}>
    <h3 style={{ marginTop: 0 }}>Upcoming Draft Order</h3>
    <p className="form-hint">The generated NFL-style order is preloaded from the league's current pick positions. Assigning a team to a slot applies that pick number in all seven rounds; traded ownership stays intact.</p>
    <label className="form-field" style={{ maxWidth: 220 }}><span className="form-label">Draft year</span><select className="form-select" value={seasonNumber} onChange={(event) => setSeasonNumber(Number(event.target.value))}>{seasons.map((season) => <option key={season} value={season}>Season {season}</option>)}</select></label>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "var(--space-2)" }}>
      {slots.map((teamId, index) => <label className="form-field" style={{ margin: 0 }} key={index}><span className="form-label">{index + 1}{index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"}</span>
        <select className="form-select" value={teamId} onChange={(event) => setSlots((current) => current.map((value, slotIndex) => slotIndex === index ? event.target.value : value))}>
          <option value="">Select team</option>{teams.filter((team) => team.id === teamId || !slots.includes(team.id)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select></label>)}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-4)" }}><Button disabled={!complete || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save Draft Order"}</Button>{message && <span className="form-hint">{message}</span>}</div>
  </Card>;
}
