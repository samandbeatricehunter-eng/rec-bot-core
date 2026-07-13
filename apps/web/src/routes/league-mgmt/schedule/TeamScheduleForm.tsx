import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { canonicalConferenceName, stageForWeek, stageLabel } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CfbTeamScheduleManualState, CfbTeamScheduleManualWeek, ScheduleTeam } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { Badge } from "../../../components/ui/Badge.js";
import { Table, Th, Td } from "../../../components/ui/Table.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";
import { Tooltip } from "../../../components/ui/Tooltip.js";
import { ReviewBoxScoreModal } from "../../../components/box-score/ReviewBoxScoreModal.js";
import { UploadBoxScoreModal } from "./UploadBoxScoreModal.js";
import { EnterFinalScoreModal } from "./EnterFinalScoreModal.js";

type WeekPick = { isBye: boolean; conference: string | null; opponentTeamId: string | null; homeAway: "home" | "away" | null };
type SavedResult = { weekNumber: number; skipped: boolean; reason?: string };

type ActiveModal =
  | { type: "upload"; week: CfbTeamScheduleManualWeek }
  | { type: "review"; week: CfbTeamScheduleManualWeek; submissionId: string }
  | { type: "score"; week: CfbTeamScheduleManualWeek };

// "home"/"away" describe the scheduled game's actual home/away team, not this row's team —
// resolve real names once so the score-entry modal and result badge never show "Home Win"
// for a team that's actually on the road this week.
function homeAwayLabels(week: CfbTeamScheduleManualWeek, thisTeamName: string): { homeLabel: string; awayLabel: string } {
  const opponent = week.confirmedOpponentName ?? "Opponent";
  return week.confirmedHomeAway === "home" ? { homeLabel: thisTeamName, awayLabel: opponent } : { homeLabel: opponent, awayLabel: thisTeamName };
}

// The whole-season, single-page form this Activity exists to demonstrate — every week is
// a row here instead of Discord's forced one-week-at-a-time wizard (apps/bot/src/flows/
// cfb-team-schedule-manual.ts), and there's no 25-option select cap to work around. Weeks
// that already have a real matchup are also where box-score upload, review, and manual
// final-score entry live — a commissioner opening this screen for an in-progress team sees
// real, populated data immediately, and can resolve that week's result right from this row.
export function TeamScheduleForm() {
  const { teamId } = useParams<{ teamId: string }>();
  const { guildId, discordId } = useReadyAuth();
  const [state, setState] = useState<CfbTeamScheduleManualState | null>(null);
  const [teams, setTeams] = useState<ScheduleTeam[] | null>(null);
  const [picks, setPicks] = useState<Record<number, WeekPick>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<SavedResult[] | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!teamId) return Promise.resolve();
    return Promise.all([recApi.getCfbTeamScheduleManualState({ guildId, teamId }), recApi.listScheduleTeams(guildId)])
      .then(([manualState, teamsRes]) => {
        setState(manualState);
        setTeams(teamsRes.teams);
        setPicks((prev) => {
          const next: Record<number, WeekPick> = {};
          for (const week of manualState.weeks) {
            next[week.weekNumber] = prev[week.weekNumber] ?? { isBye: false, conference: null, opponentTeamId: null, homeAway: null };
          }
          return next;
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load schedule."));
  }, [guildId, teamId]);

  useEffect(() => {
    load();
  }, [load]);

  const conferences = useMemo(() => {
    if (!teams) return [];
    return [...new Set(teams.filter((t) => t.id !== teamId).map((t) => canonicalConferenceName(t.conference)).filter(Boolean))];
  }, [teams, teamId]);

  function updatePick(weekNumber: number, patch: Partial<WeekPick>) {
    setPicks((prev) => ({ ...prev, [weekNumber]: { ...prev[weekNumber], ...patch } }));
  }

  async function handleSave() {
    if (!state || !teamId) return;
    setSaving(true);
    setError(null);
    setResults(null);
    const decisions = Object.entries(picks)
      .filter(([, pick]) => !pick.isBye && pick.opponentTeamId && pick.homeAway)
      .map(([weekNumber, pick]) => ({ weekNumber: Number(weekNumber), opponentTeamId: pick.opponentTeamId!, homeAway: pick.homeAway! }));
    try {
      const result = await recApi.commitCfbTeamSchedule({ guildId, teamId, decisions });
      setResults(result.saved);
      // Newly-confirmed weeks need to switch over to their populated, box-score-ready
      // display without a manual page reload.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  }

  function closeModal() {
    setActiveModal(null);
  }

  async function afterResolved(message: string) {
    setNotice(message);
    closeModal();
    await load();
  }

  if (error) return <ErrorState message={error} />;
  if (!state || !teams) return <LoadingState label="Loading schedule…" />;

  const resultByWeek = new Map(results?.map((r) => [r.weekNumber, r]));

  return (
    <div>
      <PageHeader title={`${state.team.name} — Season Schedule`} subtitle="Set matchups week by week, then resolve results as games are played." />
      {notice && <p style={{ color: "var(--success)", marginTop: 0 }}>{notice}</p>}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Week</Th>
              <Th>BYE</Th>
              <Th>Conference</Th>
              <Th>Opponent</Th>
              <Th>Home/Away</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {state.weeks.map((week) => {
              const label = stageLabel(stageForWeek(week.weekNumber, "cfb_27"), week.weekNumber, "cfb_27");
              const pick = picks[week.weekNumber];
              const savedResult = resultByWeek.get(week.weekNumber);

              if (week.alreadyConfirmed) {
                return (
                  <tr key={week.weekNumber}>
                    <Td>{label}</Td>
                    <Td colSpan={4}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                        <span>{week.confirmedHomeAway === "home" ? "vs" : "at"} {week.confirmedOpponentName}</span>
                        {week.result && (
                          <Badge status="approved">
                            {week.result.isTie ? `Tie ${week.result.homeScore}–${week.result.awayScore}` : `Final ${week.result.homeScore}–${week.result.awayScore}`}
                          </Badge>
                        )}
                        {week.pendingBoxScoreSubmissionId && <Badge status="pending">Box Score Pending Review</Badge>}
                      </div>
                    </Td>
                    <Td>
                      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {week.pendingBoxScoreSubmissionId ? (
                          <Button
                            variant="secondary"
                            onClick={() => setActiveModal({ type: "review", week, submissionId: week.pendingBoxScoreSubmissionId! })}
                          >
                            Review Pending
                          </Button>
                        ) : (
                          <>
                            <Tooltip text="Upload a screenshot — stats are parsed automatically and sent here for your approval.">
                              <Button variant="secondary" onClick={() => setActiveModal({ type: "upload", week })}>
                                Upload Box Score
                              </Button>
                            </Tooltip>
                            <Button variant="secondary" onClick={() => setActiveModal({ type: "score", week })}>
                              {week.result ? "Correct Score" : "Enter Final Score"}
                            </Button>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              }

              const opponentsInConference = pick?.conference
                ? teams.filter((t) => t.id !== teamId && canonicalConferenceName(t.conference) === pick.conference)
                : [];

              return (
                <tr key={week.weekNumber}>
                  <Td>{label}</Td>
                  <Td>
                    <input
                      type="checkbox"
                      checked={pick?.isBye ?? false}
                      onChange={(e) => updatePick(week.weekNumber, { isBye: e.target.checked, opponentTeamId: null, homeAway: null })}
                    />
                  </Td>
                  <Td>
                    <select
                      className="form-select"
                      disabled={pick?.isBye}
                      value={pick?.conference ?? ""}
                      onChange={(e) => updatePick(week.weekNumber, { conference: e.target.value || null, opponentTeamId: null })}
                    >
                      <option value="">—</option>
                      {conferences.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    <select
                      className="form-select"
                      disabled={pick?.isBye || !pick?.conference}
                      value={pick?.opponentTeamId ?? ""}
                      onChange={(e) => updatePick(week.weekNumber, { opponentTeamId: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {opponentsInConference.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    <label>
                      <input
                        type="radio"
                        name={`homeaway-${week.weekNumber}`}
                        disabled={pick?.isBye}
                        checked={pick?.homeAway === "home"}
                        onChange={() => updatePick(week.weekNumber, { homeAway: "home" })}
                      />
                      Home
                    </label>{" "}
                    <label>
                      <input
                        type="radio"
                        name={`homeaway-${week.weekNumber}`}
                        disabled={pick?.isBye}
                        checked={pick?.homeAway === "away"}
                        onChange={() => updatePick(week.weekNumber, { homeAway: "away" })}
                      />
                      Away
                    </label>
                  </Td>
                  <Td>
                    {savedResult ? (savedResult.skipped ? <Badge status="denied">skipped ({savedResult.reason})</Badge> : <Badge status="approved">saved</Badge>) : ""}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <div style={{ marginTop: "var(--space-4)" }}>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Season"}
        </Button>
      </div>

      {activeModal?.type === "upload" && (
        <UploadBoxScoreModal
          guildId={guildId}
          discordId={discordId}
          weekNumber={activeModal.week.weekNumber}
          seasonNumber={state.seasonNumber}
          gameId={activeModal.week.gameId!}
          onClose={closeModal}
          onSubmitted={(submissionId) => setActiveModal({ type: "review", week: activeModal.week, submissionId })}
        />
      )}

      {activeModal?.type === "review" && (
        <ReviewBoxScoreModal
          submissionId={activeModal.submissionId}
          onClose={closeModal}
          onResolved={(action) => afterResolved(action === "approve" ? "Box score approved." : "Box score denied.")}
        />
      )}

      {activeModal?.type === "score" && (
        <EnterFinalScoreModal
          guildId={guildId}
          gameId={activeModal.week.gameId!}
          existing={activeModal.week.result}
          {...homeAwayLabels(activeModal.week, state.team.name)}
          onClose={closeModal}
          onSaved={() => afterResolved("Final score saved.")}
        />
      )}
    </div>
  );
}
