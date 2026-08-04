import { useEffect, useMemo, useState } from "react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { Trade, TradeLegInput, TeamRosterResponse } from "../../types/api.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";

const MAX_LEGS = 7;

function legKey(leg: TradeLegInput) {
  return leg.type === "player" ? `player:${leg.playerId}` : `pick:${leg.draftPickId}`;
}

function AssetPicker({
  roster,
  selected,
  onToggle,
  disabled,
}: {
  roster: TeamRosterResponse | null;
  selected: TradeLegInput[];
  onToggle: (leg: TradeLegInput) => void;
  disabled: boolean;
}) {
  if (!roster) return <p className="hub-empty">Select a team to see their assets.</p>;
  const selectedKeys = new Set(selected.map(legKey));
  return (
    <div className="hub-trade-asset-list">
      <div className="hub-trade-asset-group">
        <h5>Players</h5>
        {roster.players.filter((p) => p.rosterStatus === "active" || p.rosterStatus === "transferred_in").map((player) => {
          const leg: TradeLegInput = { type: "player", playerId: player.id };
          const checked = selectedKeys.has(legKey(leg));
          return (
            <label key={player.id} className="hub-trade-asset-row">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled && !checked}
                onChange={() => onToggle(leg)}
              />
              <span>{player.fullName}</span>
              <span className="hub-trade-asset-meta">{player.position} · {player.overallRating ?? "—"} OVR</span>
            </label>
          );
        })}
      </div>
      {roster.draftPicks.length > 0 && (
        <div className="hub-trade-asset-group">
          <h5>Draft Picks</h5>
          {roster.draftPicks.map((pick) => {
            const leg: TradeLegInput = { type: "pick", draftPickId: pick.id };
            const checked = selectedKeys.has(legKey(leg));
            return (
              <label key={pick.id} className="hub-trade-asset-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled && !checked}
                  onChange={() => onToggle(leg)}
                />
                <span>Season {pick.seasonNumber} · Round {pick.round}</span>
                <span className="hub-trade-asset-meta">{pick.isOwnPick ? "Own pick" : `via ${pick.originalTeamName}`}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TradeCenterHome() {
  const { guildId } = useReadyAuth();
  const hub = useHubChrome();
  const isCommissioner = hub.currentLeague?.isCommissioner ?? false;

  const [myRoster, setMyRoster] = useState<TeamRosterResponse | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; abbreviation: string; isCpu: boolean }>>([]);
  const [opponentTeamId, setOpponentTeamId] = useState<string>("");
  const [opponentRoster, setOpponentRoster] = useState<TeamRosterResponse | null>(null);
  const [offeredLegs, setOfferedLegs] = useState<TradeLegInput[]>([]);
  const [requestedLegs, setRequestedLegs] = useState<TradeLegInput[]>([]);
  const [offeredCoins, setOfferedCoins] = useState(0);
  const [requestedCoins, setRequestedCoins] = useState(0);
  const [myTrades, setMyTrades] = useState<Trade[] | null>(null);
  const [reviewTrades, setReviewTrades] = useState<Trade[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function loadCore() {
    recApi.getTeamRoster({ guildId }).then(setMyRoster).catch((err) => setError(err instanceof Error ? err.message : "Failed to load your roster."));
    recApi.listTradeableTeams(guildId).then(setTeams).catch(() => undefined);
    recApi.getMyTrades(guildId).then((r) => setMyTrades(r.trades)).catch(() => undefined);
    if (isCommissioner) recApi.getPendingReviewTrades(guildId).then((r) => setReviewTrades(r.trades)).catch(() => undefined);
  }

  useEffect(loadCore, [guildId, isCommissioner]);

  useEffect(() => {
    if (!opponentTeamId) { setOpponentRoster(null); return; }
    recApi.getTeamRoster({ guildId, teamId: opponentTeamId }).then(setOpponentRoster).catch(() => setOpponentRoster(null));
  }, [guildId, opponentTeamId]);

  function toggleOffered(leg: TradeLegInput) {
    setOfferedLegs((current) => {
      const key = legKey(leg);
      if (current.some((l) => legKey(l) === key)) return current.filter((l) => legKey(l) !== key);
      if (current.length >= MAX_LEGS) return current;
      return [...current, leg];
    });
  }
  function toggleRequested(leg: TradeLegInput) {
    setRequestedLegs((current) => {
      const key = legKey(leg);
      if (current.some((l) => legKey(l) === key)) return current.filter((l) => legKey(l) !== key);
      if (current.length >= MAX_LEGS) return current;
      return [...current, leg];
    });
  }

  const otherTeams = useMemo(() => teams.filter((t) => t.id !== myRoster?.team.id), [teams, myRoster]);

  async function submitProposal() {
    if (!opponentTeamId) { setError("Pick a team to trade with."); return; }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recApi.proposeTrade({
        guildId, receivingTeamId: opponentTeamId,
        offeredLegs, requestedLegs, offeredCoins, requestedCoins,
      });
      setNotice("status" in result && result.status === "applied" ? "Trade applied immediately." : "Trade proposed.");
      setOfferedLegs([]); setRequestedLegs([]); setOfferedCoins(0); setRequestedCoins(0); setOpponentTeamId("");
      loadCore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose trade.");
    } finally {
      setBusy(false);
    }
  }

  async function respond(tradeId: string, action: "accept" | "decline") {
    setBusy(true);
    try {
      await recApi.respondToTrade({ guildId, tradeId, action });
      loadCore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to respond to trade.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(tradeId: string) {
    setBusy(true);
    try {
      await recApi.withdrawTrade({ guildId, tradeId });
      loadCore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to withdraw trade.");
    } finally {
      setBusy(false);
    }
  }

  async function review(tradeId: string, action: "approve" | "reject") {
    setBusy(true);
    try {
      await recApi.reviewTrade({ guildId, tradeId, action });
      loadCore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review trade.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !myRoster) return <ErrorState message={error} />;
  if (!myRoster) return <LoadingState label="Loading Trade Center…" />;

  const pendingSent = (myTrades ?? []).filter((t) => t.proposing_team_id === myRoster.team.id && ["pending_response", "accepted", "pending_review"].includes(t.status));
  const pendingReceived = (myTrades ?? []).filter((t) => t.receiving_team_id === myRoster.team.id && t.status === "pending_response");
  const history = (myTrades ?? []).filter((t) => ["applied", "declined", "withdrawn", "rejected"].includes(t.status));

  return (
    <div className="hub-section hub-trade-center">
      <div className="hub-section-heading">
        <div>
          <p className="hub-eyebrow">Trade Center</p>
          <h2>{myRoster.team.name ?? "Your team"}</h2>
        </div>
      </div>

      {error && <p className="hub-error">{error}</p>}
      {notice && <p className="hub-notice">{notice}</p>}

      <section className="hub-trade-propose">
        <h3>Propose a Trade</h3>
        <label className="form-field">
          <span className="form-label">Trade with</span>
          <select className="form-input" value={opponentTeamId} onChange={(event) => { setOpponentTeamId(event.target.value); setRequestedLegs([]); }}>
            <option value="">Select a team…</option>
            {otherTeams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}{team.isCpu ? " (CPU)" : ""}</option>
            ))}
          </select>
        </label>

        <div className="hub-trade-sides">
          <div className="hub-trade-side">
            <h4>You offer ({offeredLegs.length}/{MAX_LEGS})</h4>
            <AssetPicker roster={myRoster} selected={offeredLegs} onToggle={toggleOffered} disabled={offeredLegs.length >= MAX_LEGS} />
            <label className="form-field">
              <span className="form-label">Coins to include</span>
              <input type="number" min={0} className="form-input" value={offeredCoins} onChange={(event) => setOfferedCoins(Math.max(0, Number(event.target.value) || 0))} />
            </label>
          </div>
          <div className="hub-trade-side">
            <h4>You request ({requestedLegs.length}/{MAX_LEGS})</h4>
            <AssetPicker roster={opponentRoster} selected={requestedLegs} onToggle={toggleRequested} disabled={requestedLegs.length >= MAX_LEGS} />
            <label className="form-field">
              <span className="form-label">Coins to request</span>
              <input type="number" min={0} className="form-input" value={requestedCoins} onChange={(event) => setRequestedCoins(Math.max(0, Number(event.target.value) || 0))} disabled={!opponentTeamId || teams.find((t) => t.id === opponentTeamId)?.isCpu} />
            </label>
          </div>
        </div>

        <button type="button" className="btn btn-primary" disabled={busy || !opponentTeamId || (offeredLegs.length === 0 && requestedLegs.length === 0 && offeredCoins === 0 && requestedCoins === 0)} onClick={() => void submitProposal()}>
          Propose Trade
        </button>
      </section>

      {isCommissioner && reviewTrades && reviewTrades.length > 0 && (
        <section className="hub-trade-review">
          <h3>Pending Committee/Commissioner Review ({reviewTrades.length})</h3>
          {reviewTrades.map((trade) => (
            <div key={trade.id} className="hub-trade-row">
              <span>Trade {trade.id.slice(0, 8)} · {trade.proposing_coins > 0 ? `+${trade.proposing_coins} coins` : ""} {trade.receiving_coins > 0 ? `/ -${trade.receiving_coins} coins` : ""}</span>
              <div className="hub-trade-row-actions">
                <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void review(trade.id, "approve")}>Approve</button>
                <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void review(trade.id, "reject")}>Reject</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="hub-trade-mine">
        <h3>Trades Awaiting Your Response ({pendingReceived.length})</h3>
        {pendingReceived.length === 0 && <p className="hub-empty">Nothing waiting on you.</p>}
        {pendingReceived.map((trade) => (
          <div key={trade.id} className="hub-trade-row">
            <span>Trade {trade.id.slice(0, 8)}</span>
            <div className="hub-trade-row-actions">
              <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void respond(trade.id, "accept")}>Accept</button>
              <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void respond(trade.id, "decline")}>Decline</button>
            </div>
          </div>
        ))}

        <h3>Sent / In Progress ({pendingSent.length})</h3>
        {pendingSent.length === 0 && <p className="hub-empty">No active proposals.</p>}
        {pendingSent.map((trade) => (
          <div key={trade.id} className="hub-trade-row">
            <span>Trade {trade.id.slice(0, 8)} · {statusLabel(trade.status)}</span>
            {trade.status !== "pending_review" && (
              <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void withdraw(trade.id)}>Withdraw</button>
            )}
          </div>
        ))}

        <h3>History</h3>
        {history.length === 0 && <p className="hub-empty">No settled trades yet.</p>}
        {history.map((trade) => (
          <div key={trade.id} className="hub-trade-row">
            <span>Trade {trade.id.slice(0, 8)} · {statusLabel(trade.status)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
