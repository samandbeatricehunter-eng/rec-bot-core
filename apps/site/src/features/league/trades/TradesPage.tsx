import { useEffect, useMemo, useState } from "react";
import { useHubChrome, useReadyAuth } from "@rec/hub-ui";
import { recApi } from "../../../../../web/src/lib/rec-api-client.js";
import { Button } from "../../../../../web/src/components/ui/Button.js";
import { Card } from "../../../../../web/src/components/ui/Card.js";
import { ErrorState } from "../../../../../web/src/components/ui/ErrorState.js";
import type { TeamRosterResponse, TradeEvaluatorReport, TradeLegInput } from "../../../../../web/src/types/api.js";

type TradeTeam = { id: string; name: string; abbreviation: string; isCpu: boolean };
type MaddenAcceptanceBand = "very_unlikely" | "unlikely" | "coin_flip" | "likely" | "very_likely";
type PredictorBreakdown = {
  id: string;
  type: "player" | "pick" | "coins";
  label: string;
  value: number;
  baseValue: number;
  modifiers: Record<string, number>;
};
type CpuPrediction = {
  version: string;
  applicable: boolean;
  reason: string | null;
  cpuTeamId: string | null;
  cpuTeamName: string | null;
  humanTeamId: string | null;
  teamWindow: "rebuild" | "neutral" | "contend" | null;
  tradeDifficulty: string;
  acceptanceProbability: number | null;
  acceptanceBand: MaddenAcceptanceBand | null;
  confidence: "low" | "medium";
  confidenceScore: number;
  valueRatio: number | null;
  humanOfferValue: number | null;
  cpuRequiredValue: number | null;
  cpuOutgoingRawValue: number | null;
  difficultyMultiplier: number;
  retentionPremium: number;
  estimatedAdditionalValueNeeded: number | null;
  humanOfferBreakdown: PredictorBreakdown[];
  cpuOutgoingBreakdown: PredictorBreakdown[];
  reasons: string[];
  warnings: string[];
  evidenceBasis: string[];
};
type CalculatorReport = TradeEvaluatorReport & { cpuPrediction?: CpuPrediction };

type Side = 0 | 1;

const BAND_LABEL: Record<MaddenAcceptanceBand, string> = {
  very_unlikely: "Very unlikely",
  unlikely: "Unlikely",
  coin_flip: "Borderline",
  likely: "Likely",
  very_likely: "Very likely",
};

function legKey(leg: TradeLegInput) {
  return leg.type === "player" ? `player:${leg.playerId}` : `pick:${leg.draftPickId}`;
}

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function number(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function verdictLabel(value: CalculatorReport["verdict"]) {
  if (value === "favors_proposing") return "Favors Team A";
  if (value === "favors_receiving") return "Favors Team B";
  return "Balanced";
}

function modifierSummary(modifiers: Record<string, number>) {
  return Object.entries(modifiers)
    .filter(([, value]) => Math.abs(value - 1) >= 0.015)
    .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1")}: ${value.toFixed(2)}×`)
    .join(" · ");
}

function AssetPicker({
  side,
  team,
  roster,
  selected,
  coins,
  onTeamChange,
  onToggle,
  onCoinsChange,
  teams,
  busy,
}: {
  side: Side;
  team: TradeTeam | null;
  roster: TeamRosterResponse | null;
  selected: TradeLegInput[];
  coins: number;
  onTeamChange: (teamId: string) => void;
  onToggle: (leg: TradeLegInput) => void;
  onCoinsChange: (value: number) => void;
  teams: TradeTeam[];
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const players = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (roster?.players ?? [])
      .filter((player) => ["active", "transferred_in"].includes(player.rosterStatus))
      .filter((player) => position === "ALL" || player.position === position)
      .filter((player) => !normalized || `${player.position} ${player.fullName}`.toLowerCase().includes(normalized))
      .sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0) || a.fullName.localeCompare(b.fullName));
  }, [roster, query, position]);
  const positions = useMemo(() => Array.from(new Set((roster?.players ?? []).map((player) => player.position).filter(Boolean))).sort(), [roster]);
  const selectedKeys = useMemo(() => new Set(selected.map(legKey)), [selected]);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>{side === 0 ? "Team A sends" : "Team B sends"}</h2>
          <p className="form-hint" style={{ margin: 0 }}>{team ? `${team.isCpu ? "CPU" : "User"} controlled` : "Select a team"}</p>
        </div>
        <strong>{selected.length}/7 assets</strong>
      </div>

      <label className="form-field">
        <span className="form-label">Team</span>
        <select className="form-select" value={team?.id ?? ""} disabled={busy} onChange={(event) => onTeamChange(event.target.value)}>
          <option value="">Select team</option>
          {teams.map((item) => <option key={item.id} value={item.id}>{item.name}{item.isCpu ? " — CPU" : ""}</option>)}
        </select>
      </label>

      {roster && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(120px, .42fr)", gap: 8 }}>
            <label className="form-field" style={{ margin: 0 }}>
              <span className="form-label">Find player</span>
              <input className="form-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or position" />
            </label>
            <label className="form-field" style={{ margin: 0 }}>
              <span className="form-label">Position</span>
              <select className="form-select" value={position} onChange={(event) => setPosition(event.target.value)}>
                <option value="ALL">All</option>
                {positions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 12, maxHeight: 330, overflow: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
            {players.length === 0 ? <p className="form-hint" style={{ padding: 12 }}>No matching players.</p> : players.map((player) => {
              const leg: TradeLegInput = { type: "player", playerId: player.id };
              const checked = selectedKeys.has(legKey(leg));
              return (
                <label key={player.id} style={{ display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) auto", gap: 8, alignItems: "center", padding: "9px 10px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                  <input type="checkbox" checked={checked} disabled={!checked && selected.length >= 7} onChange={() => onToggle(leg)} />
                  <span style={{ minWidth: 0 }}><strong>{player.position}</strong> {player.fullName}<span className="form-hint" style={{ display: "block", margin: 0 }}>{player.devTrait ? `${player.devTrait} dev` : ""}</span></span>
                  <strong>{player.overallRating ?? "—"}</strong>
                </label>
              );
            })}
          </div>

          {(roster.draftPicks ?? []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>Draft picks</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {roster.draftPicks.map((pick) => {
                  const leg: TradeLegInput = { type: "pick", draftPickId: pick.id };
                  const checked = selectedKeys.has(legKey(leg));
                  return (
                    <label key={pick.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid var(--border)", borderRadius: 999, padding: "7px 10px", cursor: "pointer" }}>
                      <input type="checkbox" checked={checked} disabled={!checked && selected.length >= 7} onChange={() => onToggle(leg)} />
                      <span>S{pick.seasonNumber} R{pick.round}{pick.pickNumber ? ` #${pick.pickNumber}` : ""}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <label className="form-field" style={{ marginTop: 12 }}>
        <span className="form-label">REC coins included</span>
        <input className="form-input" type="number" min={0} step={100} value={coins} onChange={(event) => onCoinsChange(Math.max(0, Number(event.target.value) || 0))} />
      </label>
    </Card>
  );
}

function FairnessResult({ report }: { report: CalculatorReport }) {
  const teamA = report.proposing.needAdjustedTotal;
  const teamB = report.receiving.needAdjustedTotal;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p className="form-hint" style={{ margin: 0 }}>REC FAIRNESS MODEL</p>
          <h2 style={{ margin: "2px 0" }}>{verdictLabel(report.verdict)}</h2>
        </div>
        <strong>{Math.abs(report.deltaPct).toFixed(1)}% spread</strong>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
        <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}><span className="form-hint">Team A sends</span><div style={{ fontSize: 24, fontWeight: 800 }}>{number(teamA)}</div></div>
        <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}><span className="form-hint">Team B sends</span><div style={{ fontSize: 24, fontWeight: 800 }}>{number(teamB)}</div></div>
      </div>
      <p className="form-hint" style={{ marginBottom: 0 }}>Fairness and CPU acceptance are intentionally separate. A deal can be fair to users while still failing Madden's CPU trade logic.</p>
    </Card>
  );
}

function BreakdownList({ title, rows }: { title: string; rows: PredictorBreakdown[] }) {
  return (
    <div>
      <strong>{title}</strong>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.length === 0 ? <span className="form-hint">No assets.</span> : rows.map((row) => {
          const modifiers = modifierSummary(row.modifiers);
          return (
            <div key={`${row.type}:${row.id}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ minWidth: 0 }}>{row.label}{modifiers && <span className="form-hint" style={{ display: "block", margin: 0 }}>{modifiers}</span>}</span>
              <strong>{number(row.value)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CpuPredictionResult({ prediction }: { prediction: CpuPrediction }) {
  if (!prediction.applicable) {
    return <Card><p className="form-hint" style={{ margin: 0 }}>MADDEN CPU ACCEPTANCE</p><h2>Not applicable</h2><p>{prediction.reason}</p></Card>;
  }
  const probability = prediction.acceptanceProbability ?? 0;
  return (
    <Card>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16, alignItems: "start" }}>
        <div>
          <p className="form-hint" style={{ margin: 0 }}>MADDEN CPU ACCEPTANCE · {prediction.version}</p>
          <h2 style={{ margin: "2px 0" }}>{prediction.acceptanceBand ? BAND_LABEL[prediction.acceptanceBand] : "Prediction unavailable"}</h2>
          <p className="form-hint" style={{ margin: 0 }}>{prediction.cpuTeamName} · {prediction.teamWindow} · {prediction.tradeDifficulty.replace(/_/g, " ")} trade difficulty · {prediction.confidence} confidence</p>
        </div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1 }}>{pct(probability)}</div><span className="form-hint">predicted</span></div>
      </div>

      <div style={{ marginTop: 14, height: 10, borderRadius: 999, overflow: "hidden", background: "color-mix(in srgb, var(--text-secondary) 18%, transparent)" }}>
        <div style={{ width: `${probability}%`, height: "100%", background: "var(--accent)", borderRadius: 999 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9, marginTop: 14 }}>
        <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}><span className="form-hint">Offer value</span><strong style={{ display: "block", fontSize: 20 }}>{number(prediction.humanOfferValue)}</strong></div>
        <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}><span className="form-hint">CPU requirement</span><strong style={{ display: "block", fontSize: 20 }}>{number(prediction.cpuRequiredValue)}</strong></div>
        <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}><span className="form-hint">Value ratio</span><strong style={{ display: "block", fontSize: 20 }}>{prediction.valueRatio?.toFixed(2) ?? "—"}×</strong></div>
        <div style={{ padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}><span className="form-hint">Value still needed</span><strong style={{ display: "block", fontSize: 20 }}>{number(prediction.estimatedAdditionalValueNeeded)}</strong></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, marginTop: 18 }}>
        <BreakdownList title="What the CPU receives" rows={prediction.humanOfferBreakdown} />
        <BreakdownList title="What the CPU gives up" rows={prediction.cpuOutgoingBreakdown} />
      </div>

      <div style={{ marginTop: 18 }}>
        <strong>Why the model landed here</strong>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{prediction.reasons.map((reason) => <li key={reason} style={{ marginBottom: 5 }}>{reason}</li>)}</ul>
      </div>
      {prediction.warnings.length > 0 && <details style={{ marginTop: 14 }}><summary style={{ cursor: "pointer", fontWeight: 700 }}>Model limitations and confidence</summary><ul style={{ paddingLeft: 20 }}>{prediction.warnings.map((warning) => <li key={warning} style={{ marginBottom: 5 }}>{warning}</li>)}</ul></details>}
    </Card>
  );
}

export function TradesPage() {
  const { guildId } = useReadyAuth();
  const hub = useHubChrome();
  const isMadden = Boolean(hub.currentLeague?.game?.startsWith("madden"));
  const [teams, setTeams] = useState<TradeTeam[]>([]);
  const [teamIds, setTeamIds] = useState<[string, string]>(["", ""]);
  const [rosters, setRosters] = useState<[TeamRosterResponse | null, TeamRosterResponse | null]>([null, null]);
  const [legs, setLegs] = useState<[TradeLegInput[], TradeLegInput[]]>([[], []]);
  const [coins, setCoins] = useState<[number, number]>([0, 0]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [busySide, setBusySide] = useState<Side | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [report, setReport] = useState<CalculatorReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isMadden) { setLoadingTeams(false); return; }
    let cancelled = false;
    setLoadingTeams(true);
    recApi.listTradeableTeams(guildId)
      .then((rows) => { if (!cancelled) setTeams(rows); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load trade teams."); })
      .finally(() => { if (!cancelled) setLoadingTeams(false); });
    return () => { cancelled = true; };
  }, [guildId, isMadden]);

  const selectedTeams = useMemo<[TradeTeam | null, TradeTeam | null]>(() => [
    teams.find((team) => team.id === teamIds[0]) ?? null,
    teams.find((team) => team.id === teamIds[1]) ?? null,
  ], [teams, teamIds]);

  async function selectTeam(side: Side, teamId: string) {
    setReport(null); setError(null); setBusySide(side);
    const nextIds: [string, string] = [...teamIds]; nextIds[side] = teamId; setTeamIds(nextIds);
    const nextLegs: [TradeLegInput[], TradeLegInput[]] = [...legs]; nextLegs[side] = []; setLegs(nextLegs);
    const nextRosters: [TeamRosterResponse | null, TeamRosterResponse | null] = [...rosters]; nextRosters[side] = null; setRosters(nextRosters);
    try {
      if (teamId) {
        const roster = await recApi.getTeamRoster({ guildId, teamId });
        setRosters((current) => { const next: [TeamRosterResponse | null, TeamRosterResponse | null] = [...current]; next[side] = roster; return next; });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load that roster.");
    } finally { setBusySide(null); }
  }

  function toggleLeg(side: Side, leg: TradeLegInput) {
    setReport(null);
    setLegs((current) => {
      const key = legKey(leg);
      const sideLegs = current[side];
      const exists = sideLegs.some((item) => legKey(item) === key);
      const next: [TradeLegInput[], TradeLegInput[]] = [...current];
      next[side] = exists ? sideLegs.filter((item) => legKey(item) !== key) : sideLegs.length < 7 ? [...sideLegs, leg] : sideLegs;
      return next;
    });
  }

  function updateCoins(side: Side, value: number) {
    setReport(null);
    setCoins((current) => { const next: [number, number] = [...current]; next[side] = value; return next; });
  }

  async function evaluate() {
    if (!teamIds[0] || !teamIds[1]) return;
    setEvaluating(true); setError(null);
    try {
      const result = await recApi.getTradeFairnessPreview({
        guildId,
        proposingTeamId: teamIds[0],
        receivingTeamId: teamIds[1],
        offeredLegs: legs[0],
        requestedLegs: legs[1],
        offeredCoins: coins[0],
        requestedCoins: coins[1],
      });
      setReport(result as CalculatorReport);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Trade evaluation failed.");
    } finally { setEvaluating(false); }
  }

  const duplicateTeam = Boolean(teamIds[0] && teamIds[0] === teamIds[1]);
  const hasAssets = legs[0].length + legs[1].length > 0 || coins[0] > 0 || coins[1] > 0;
  const canEvaluate = Boolean(teamIds[0] && teamIds[1] && !duplicateTeam && hasAssets && busySide === null && !evaluating);

  if (!isMadden) {
    return <div className="hub-page"><section className="hub-section" aria-label="Trade Center"><Card><h2>Trade Center</h2><p className="form-hint">The Madden trade-value and CPU-acceptance calculator is available for Madden leagues only.</p></Card></section></div>;
  }

  return (
    <div className="hub-page">
      <section className="hub-section" aria-label="Trade Center">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <p className="form-hint" style={{ margin: 0 }}>TRADE CENTER</p>
            <h1 style={{ margin: "2px 0 4px" }}>Madden Trade Calculator</h1>
            <p className="form-hint" style={{ maxWidth: 760, margin: 0 }}>Build any two-team package. REC scores user-to-user fairness separately from Madden CPU acceptance so the calculator does not confuse a fair trade with one the game is likely to accept.</p>
          </div>
          {loadingTeams && <span className="form-hint">Loading teams…</span>}
        </div>

        {error && <ErrorState message={error} />}
        {duplicateTeam && <ErrorState message="Choose two different teams." />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
          <AssetPicker side={0} team={selectedTeams[0]} roster={rosters[0]} selected={legs[0]} coins={coins[0]} onTeamChange={(id) => void selectTeam(0, id)} onToggle={(leg) => toggleLeg(0, leg)} onCoinsChange={(value) => updateCoins(0, value)} teams={teams.filter((team) => team.id !== teamIds[1])} busy={busySide === 0} />
          <AssetPicker side={1} team={selectedTeams[1]} roster={rosters[1]} selected={legs[1]} coins={coins[1]} onTeamChange={(id) => void selectTeam(1, id)} onToggle={(leg) => toggleLeg(1, leg)} onCoinsChange={(value) => updateCoins(1, value)} teams={teams.filter((team) => team.id !== teamIds[0])} busy={busySide === 1} />
        </div>

        <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
          <Button variant="tactical" disabled={!canEvaluate} onClick={() => void evaluate()}>{evaluating ? "Evaluating…" : "Evaluate Trade"}</Button>
        </div>

        {report && (
          <div style={{ display: "grid", gap: 14 }}>
            <FairnessResult report={report} />
            {report.cpuPrediction && <CpuPredictionResult prediction={report.cpuPrediction} />}
          </div>
        )}
      </section>
    </div>
  );
}
