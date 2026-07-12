import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { canonicalConferenceName, stageForWeek, stageLabel } from "@rec/shared";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { CfbTeamScheduleManualState, ScheduleTeam } from "../../../types/api.js";

type WeekPick = { isBye: boolean; conference: string | null; opponentTeamId: string | null; homeAway: "home" | "away" | null };
type SavedResult = { weekNumber: number; skipped: boolean; reason?: string };

// The whole-season, single-page form this Activity exists to demonstrate — every week is
// a row here instead of Discord's forced one-week-at-a-time wizard (apps/bot/src/flows/
// cfb-team-schedule-manual.ts), and there's no 25-option select cap to work around.
export function TeamScheduleForm() {
  const { teamId } = useParams<{ teamId: string }>();
  const { guildId } = useReadyAuth();
  const [state, setState] = useState<CfbTeamScheduleManualState | null>(null);
  const [teams, setTeams] = useState<ScheduleTeam[] | null>(null);
  const [picks, setPicks] = useState<Record<number, WeekPick>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<SavedResult[] | null>(null);

  useEffect(() => {
    if (!teamId) return;
    Promise.all([recApi.getCfbTeamScheduleManualState({ guildId, teamId }), recApi.listScheduleTeams(guildId)])
      .then(([manualState, teamsRes]) => {
        setState(manualState);
        setTeams(teamsRes.teams);
        const initial: Record<number, WeekPick> = {};
        for (const week of manualState.weeks) {
          initial[week.weekNumber] = { isBye: false, conference: null, opponentTeamId: null, homeAway: null };
        }
        setPicks(initial);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load schedule."));
  }, [guildId, teamId]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!state || !teams) return <p>Loading schedule…</p>;

  const resultByWeek = new Map(results?.map((r) => [r.weekNumber, r]));

  return (
    <div>
      <h2>{state.team.name} — Season Schedule</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={cellStyle}>Week</th>
            <th style={cellStyle}>BYE</th>
            <th style={cellStyle}>Conference</th>
            <th style={cellStyle}>Opponent</th>
            <th style={cellStyle}>Home/Away</th>
            <th style={cellStyle}>Status</th>
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
                  <td style={cellStyle}>{label}</td>
                  <td style={cellStyle} colSpan={4}>
                    Already set: {week.confirmedHomeAway === "home" ? "vs" : "at"} {week.confirmedOpponentName}
                  </td>
                  <td style={cellStyle}>locked</td>
                </tr>
              );
            }

            const opponentsInConference = pick?.conference
              ? teams.filter((t) => t.id !== teamId && canonicalConferenceName(t.conference) === pick.conference)
              : [];

            return (
              <tr key={week.weekNumber}>
                <td style={cellStyle}>{label}</td>
                <td style={cellStyle}>
                  <input
                    type="checkbox"
                    checked={pick?.isBye ?? false}
                    onChange={(e) => updatePick(week.weekNumber, { isBye: e.target.checked, opponentTeamId: null, homeAway: null })}
                  />
                </td>
                <td style={cellStyle}>
                  <select
                    disabled={pick?.isBye}
                    value={pick?.conference ?? ""}
                    onChange={(e) => updatePick(week.weekNumber, { conference: e.target.value || null, opponentTeamId: null })}
                  >
                    <option value="">—</option>
                    {conferences.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td style={cellStyle}>
                  <select
                    disabled={pick?.isBye || !pick?.conference}
                    value={pick?.opponentTeamId ?? ""}
                    onChange={(e) => updatePick(week.weekNumber, { opponentTeamId: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {opponentsInConference.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </td>
                <td style={cellStyle}>
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
                </td>
                <td style={cellStyle}>
                  {savedResult ? (savedResult.skipped ? `skipped (${savedResult.reason})` : "saved") : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button onClick={handleSave} disabled={saving} style={{ marginTop: 16, padding: "8px 16px" }}>
        {saving ? "Saving…" : "Save Season"}
      </button>
    </div>
  );
}

const cellStyle: CSSProperties = { border: "1px solid #ccc", padding: 6, textAlign: "left" };
