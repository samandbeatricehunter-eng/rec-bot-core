import { useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { Trade, TradeBlockListing, TradeLegInput, TeamRosterResponse, RosterPlayer, TeamDraftPick } from "../../types/api.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { Modal } from "../../components/ui/Modal.js";
import { Button } from "../../components/ui/Button.js";

const MAX_LEGS = 7;
const ROSTER_ACTIVE_STATUSES = new Set(["active", "transferred_in"]);

function legKey(leg: TradeLegInput) {
  return leg.type === "player" ? `player:${leg.playerId}` : `pick:${leg.draftPickId}`;
}

/** Modal opened by tapping a player in a trade pool — mirrors the fantasy draft room's player
 * card, minus the attributes/abilities tabs (RosterPlayer doesn't carry a full attribute map).
 * The one action here is toggling this player into/out of the side of the trade being built. */
function TradePlayerCardModal({ player, isSelected, onToggle, onClose }: {
  player: RosterPlayer;
  isSelected: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={player.fullName} onClose={onClose} panelClassName="fantasy-draft-player-card">
      <div className="fantasy-draft-player-card-header">
        {player.photoUrl ? (
          <img className="fantasy-draft-player-card-photo" src={player.photoUrl} alt={player.fullName} />
        ) : (
          <div className="fantasy-draft-player-card-photo fantasy-draft-player-photo-empty">{player.position}</div>
        )}
        <div className="fantasy-draft-player-card-bio">
          <p className="fantasy-draft-player-card-position">{player.position} · {player.overallRating ?? "—"} OVR</p>
          {player.devTrait && <p className="fantasy-draft-player-card-devtrait">{player.devTrait.replaceAll("_", " ")}</p>}
          <dl className="fantasy-draft-player-card-facts">
            <div><dt>Height / Weight</dt><dd>{player.heightInches ? `${Math.floor(player.heightInches / 12)}'${player.heightInches % 12}"` : "—"}{player.weightLbs ? ` · ${player.weightLbs} lbs` : ""}</dd></div>
            <div><dt>Class</dt><dd>{player.classYear ?? "—"}</dd></div>
            <div><dt>Hand</dt><dd>{player.handedness ?? "—"}</dd></div>
          </dl>
        </div>
      </div>
      <div className="fantasy-draft-form-actions">
        <Button variant={isSelected ? "secondary" : "primary"} onClick={onToggle}>
          {isSelected ? "Remove from Trade" : "Add to Trade"}
        </Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

/** One side of the trade builder: a sortable/filterable pool table of that team's roster
 * (position tabs + search, tap a name to open the player card) plus their available draft
 * picks below it, and — mirroring the draft room's board — a running list of the up to 7
 * items selected so far for this side, each removable without reopening the card. */
function TradeAssetPool({ sideLabel, roster, selected, onToggle, disabled }: {
  sideLabel: string;
  roster: TeamRosterResponse | null;
  selected: TradeLegInput[];
  onToggle: (leg: TradeLegInput) => void;
  disabled: boolean;
}) {
  const [positionFilter, setPositionFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [openPlayer, setOpenPlayer] = useState<RosterPlayer | null>(null);

  const players = useMemo(
    () => (roster?.players ?? []).filter((p) => ROSTER_ACTIVE_STATUSES.has(p.rosterStatus)),
    [roster],
  );
  const groups = useMemo(() => (roster?.positionGroups ?? []).map((g) => g.group), [roster]);
  const selectedKeys = new Set(selected.map(legKey));

  const query = searchQuery.trim().toLowerCase();
  const showingDraftPicks = positionFilter === "Draft Picks";
  const rows = showingDraftPicks ? [] : players
    .filter((p) => positionFilter === "All" || p.positionGroup === positionFilter)
    .filter((p) => !query || p.fullName.toLowerCase().includes(query))
    .sort((a, b) => (b.overallRating ?? -1) - (a.overallRating ?? -1));
  const picksBySeason = useMemo(() => {
    const groups: Record<number, TeamDraftPick[]> = {};
    for (const pick of [...(roster?.draftPicks ?? [])].sort((a, b) => a.seasonNumber - b.seasonNumber || a.round - b.round)) {
      (groups[pick.seasonNumber] ??= []).push(pick);
    }
    return Object.entries(groups);
  }, [roster]);

  const selectedPlayers = selected
    .filter((leg): leg is Extract<TradeLegInput, { type: "player" }> => leg.type === "player")
    .map((leg) => players.find((p) => p.id === leg.playerId))
    .filter((p): p is RosterPlayer => p != null);
  const selectedPicks = selected
    .filter((leg): leg is Extract<TradeLegInput, { type: "pick" }> => leg.type === "pick")
    .map((leg) => (roster?.draftPicks ?? []).find((pick) => pick.id === leg.draftPickId))
    .filter((pick): pick is TeamDraftPick => pick != null);

  if (!roster) return <p className="hub-empty">Select a team to see their assets.</p>;

  return (
    <div className="hub-trade-pool">
      <div className="fantasy-draft-toolbar">
        <label className="form-field hub-trade-pool-position-select">
          <span className="form-label">Position</span>
          <select className="form-input" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
            <option value="All">All positions</option>
            {roster.draftPicks.length > 0 && <option value="Draft Picks">Draft Picks</option>}
            {groups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
        </label>
        {!showingDraftPicks && (
          <label className="fantasy-draft-search">
            <Search size={14} />
            <input className="form-input" placeholder="Search players…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </label>
        )}
      </div>

      {showingDraftPicks ? (
        picksBySeason.length === 0 ? (
          <p className="hub-empty">No draft picks on this roster.</p>
        ) : (
          picksBySeason.map(([seasonNumber, picks]) => (
            <div key={seasonNumber} className="hub-trade-pick-season-group">
              <h5>Season {seasonNumber}</h5>
              {picks.map((pick) => {
                const leg: TradeLegInput = { type: "pick", draftPickId: pick.id };
                const checked = selectedKeys.has(legKey(leg));
                return (
                  <label key={pick.id} className="hub-trade-asset-row">
                    <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={() => onToggle(leg)} />
                    <span>Round {pick.round} · Pick {pick.pickNumber ?? "TBD"}</span>
                    <span className="hub-trade-asset-meta">{pick.isOwnPick ? "Own pick" : `via ${pick.originalTeamName}`}</span>
                  </label>
                );
              })}
            </div>
          ))
        )
      ) : rows.length === 0 ? (
        <p className="hub-empty">No roster players match this filter.</p>
      ) : (
        <div className="fantasy-draft-pool-table-scroll">
          <table className="fantasy-draft-pool-table hub-trade-pool-table">
            <thead>
              <tr><th className="fantasy-draft-pool-table-name-col">Player</th><th>OVR</th><th className="fantasy-draft-pool-table-action-col" /></tr>
            </thead>
            <tbody>
              {rows.map((player) => {
                const checked = selectedKeys.has(legKey({ type: "player", playerId: player.id }));
                return (
                  <tr key={player.id}>
                    <td className="fantasy-draft-pool-table-name-col">
                      <button type="button" className="fantasy-draft-player-name-btn" onClick={() => setOpenPlayer(player)}>
                        {player.photoUrl ? <img className="fantasy-draft-player-photo" src={player.photoUrl} alt="" loading="lazy" /> : <div className="fantasy-draft-player-photo fantasy-draft-player-photo-empty">{player.position}</div>}
                        <span><strong>{player.fullName}</strong><small>{player.position}</small></span>
                      </button>
                    </td>
                    <td>{player.overallRating ?? "—"}</td>
                    <td className="fantasy-draft-pool-table-action-col">
                      <Button variant={checked ? "secondary" : "primary"} size="compact" disabled={disabled && !checked} onClick={() => onToggle({ type: "player", playerId: player.id })}>
                        {checked ? "Remove" : "Add"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="hub-trade-selected-items">
        <h5>{sideLabel} ({selected.length}/{MAX_LEGS})</h5>
        {selected.length === 0 ? (
          <p className="hub-empty">Nothing selected yet — tap a player or pick above to add it.</p>
        ) : (
          <ul>
            {selectedPlayers.map((player) => (
              <li key={player.id}><span><strong>{player.fullName}</strong> · {player.position} · {player.overallRating ?? "—"} OVR</span><button type="button" aria-label={`Remove ${player.fullName}`} onClick={() => onToggle({ type: "player", playerId: player.id })}><Trash2 size={14} /></button></li>
            ))}
            {selectedPicks.map((pick) => (
              <li key={pick.id}><span>Season {pick.seasonNumber} · Round {pick.round}</span><button type="button" aria-label="Remove pick" onClick={() => onToggle({ type: "pick", draftPickId: pick.id })}><Trash2 size={14} /></button></li>
            ))}
          </ul>
        )}
      </div>

      {openPlayer && (
        <TradePlayerCardModal
          player={openPlayer}
          isSelected={selectedKeys.has(legKey({ type: "player", playerId: openPlayer.id }))}
          onToggle={() => onToggle({ type: "player", playerId: openPlayer.id })}
          onClose={() => setOpenPlayer(null)}
        />
      )}
    </div>
  );
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function describeListingOffer(listing: TradeBlockListing, myRoster: TeamRosterResponse): string {
  const parts = listing.offeredLegs.map((leg) => {
    if (leg.type === "player") {
      const player = myRoster.players.find((p) => p.id === leg.playerId);
      return player ? `${player.fullName} (${player.position})` : "a player";
    }
    const pick = myRoster.draftPicks.find((p) => p.id === leg.draftPickId);
    return pick ? `Season ${pick.seasonNumber} Round ${pick.round} pick` : "a draft pick";
  });
  if (listing.offeredCoins > 0) parts.push(`${listing.offeredCoins} coins`);
  return parts.length ? parts.join(", ") : "nothing yet";
}

/** Open "package offer" board: post up to 7 players/picks + coins with a free-text "looking
 * for", visible league-wide and announced to Discord's trade-block channel — distinct from
 * the simple single-player TradeBlockSection below, which just flags one player as available. */
function TradeBlockPanel({ guildId, myRoster, onChanged }: {
  guildId: string;
  myRoster: TeamRosterResponse;
  onChanged: () => void;
}) {
  const [listings, setListings] = useState<TradeBlockListing[] | null>(null);
  const [legs, setLegs] = useState<TradeLegInput[]>([]);
  const [coins, setCoins] = useState(0);
  const [lookingFor, setLookingFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    recApi.listTradeBlockListings(guildId).then((res) => setListings(res.listings)).catch((err) => setError(err instanceof Error ? err.message : "Failed to load the trade block."));
  }
  useEffect(load, [guildId]);

  function toggleLeg(leg: TradeLegInput) {
    setLegs((current) => {
      const key = legKey(leg);
      if (current.some((l) => legKey(l) === key)) return current.filter((l) => legKey(l) !== key);
      if (current.length >= MAX_LEGS) return current;
      return [...current, leg];
    });
  }

  async function post() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await recApi.createTradeBlockListing({ guildId, legs, coins, lookingFor });
      setLegs([]); setCoins(0); setLookingFor("");
      setNotice("Posted to the trade block.");
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post to the trade block.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(listingId: string) {
    setBusy(true); setError(null);
    try {
      await recApi.withdrawTradeBlockListing({ guildId, listingId });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to withdraw the listing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hub-trade-block-panel">
      <h3>Open Trade Block Offers</h3>
      {error && <p className="hub-error">{error}</p>}
      {listings === null ? (
        <p className="hub-empty">Loading the trade block...</p>
      ) : listings.length === 0 ? (
        <p className="hub-empty">No open offers right now.</p>
      ) : (
        listings.map((listing) => (
          <div key={listing.id} className="hub-trade-row">
            <span><strong>{listing.teamName}</strong> is ISO <strong>{listing.lookingFor}</strong> and is offering: {describeListingOffer(listing, myRoster)}</span>
            {listing.teamId === myRoster.team.id && (
              <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void withdraw(listing.id)}>Withdraw</button>
            )}
          </div>
        ))
      )}

      <h4>Post an Offer</h4>
      {notice && <p className="hub-notice">{notice}</p>}
      <TradeAssetPool sideLabel="Offering" roster={myRoster} selected={legs} onToggle={toggleLeg} disabled={legs.length >= MAX_LEGS} />
      <label className="form-field">
        <span className="form-label">Coins to include</span>
        <input type="number" min={0} className="form-input" value={coins} onChange={(event) => setCoins(Math.max(0, Number(event.target.value) || 0))} />
      </label>
      <label className="form-field">
        <span className="form-label">Looking for</span>
        <input className="form-input" maxLength={300} placeholder="e.g. A starting WR or a 2027 1st round pick" value={lookingFor} onChange={(event) => setLookingFor(event.target.value)} />
      </label>
      <button type="button" className="btn btn-primary" disabled={busy || !lookingFor.trim() || (legs.length === 0 && coins === 0)} onClick={() => void post()}>
        Post to Trade Block
      </button>
    </section>
  );
}

type TradeBlockEntry = { id: string; fullName: string; position: string; overallRating: number | null; teamId: string; teamName: string; note: string | null };

function TradeBlockSection({
  guildId,
  myTeamId,
  myPlayers,
  tradeBlock,
  busy,
  onRemove,
  onChanged,
}: {
  guildId: string;
  myTeamId: string;
  myPlayers: RosterPlayer[];
  tradeBlock: TradeBlockEntry[] | null;
  busy: boolean;
  onRemove: (playerId: string) => void;
  onChanged: () => void;
}) {
  const [listing, setListing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const listedIds = new Set((tradeBlock ?? []).filter((p) => p.teamId === myTeamId).map((p) => p.id));

  async function add(playerId: string) {
    await recApi.setPlayerTradeBlock({ guildId, playerId, listed: true, note: note.trim() || undefined });
    setListing(null);
    setNote("");
    onChanged();
  }

  return (
    <section className="hub-trade-block">
      <h3>Trade Block ({(tradeBlock ?? []).length})</h3>
      {(tradeBlock ?? []).length === 0 && <p className="hub-empty">No players on the trade block right now.</p>}
      {(tradeBlock ?? []).map((player) => (
        <div key={player.id} className="hub-trade-row">
          <span><strong>{player.fullName}</strong> · {player.position} · {player.overallRating ?? "—"} OVR · {player.teamName}{player.note ? ` — ${player.note}` : ""}</span>
          {player.teamId === myTeamId && (
            <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => onRemove(player.id)}>Remove</button>
          )}
        </div>
      ))}

      <h4>Put one of your players on the block</h4>
      <div className="hub-trade-asset-list">
        {myPlayers.filter((p) => !listedIds.has(p.id)).map((player) => (
          <div key={player.id} className="hub-trade-asset-row">
            <span>{player.fullName}</span>
            <span className="hub-trade-asset-meta">{player.position} · {player.overallRating ?? "—"} OVR</span>
            {listing === player.id ? (
              <>
                <input className="form-input" placeholder="Optional note" value={note} onChange={(event) => setNote(event.target.value)} style={{ maxWidth: 160 }} />
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => void add(player.id)}>Confirm</button>
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => { setListing(null); setNote(""); }}>Cancel</button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => setListing(player.id)}>List</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
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
  const [tradeBlock, setTradeBlock] = useState<Array<{ id: string; fullName: string; position: string; overallRating: number | null; teamId: string; teamName: string; note: string | null }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"block" | "builder">("block");

  function loadCore() {
    recApi.getTeamRoster({ guildId }).then(setMyRoster).catch((err) => setError(err instanceof Error ? err.message : "Failed to load your roster."));
    recApi.listTradeableTeams(guildId).then(setTeams).catch(() => undefined);
    recApi.getMyTrades(guildId).then((r) => setMyTrades(r.trades)).catch(() => undefined);
    recApi.listTradeBlockPlayers(guildId).then(setTradeBlock).catch(() => undefined);
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

  async function removeFromTradeBlock(playerId: string) {
    setBusy(true);
    try {
      await recApi.setPlayerTradeBlock({ guildId, playerId, listed: false });
      loadCore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update trade-block listing.");
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

      <div className="hub-trade-view-switch">
        <button type="button" className={viewMode === "block" ? "active" : ""} onClick={() => setViewMode("block")}>Trade Block</button>
        <button type="button" className={viewMode === "builder" ? "active" : ""} onClick={() => setViewMode("builder")}>Trade Builder</button>
      </div>

      {viewMode === "block" && (
        <>
          <TradeBlockPanel guildId={guildId} myRoster={myRoster} onChanged={loadCore} />
          <TradeBlockSection guildId={guildId} myTeamId={myRoster.team.id} myPlayers={myRoster.players.filter((p) => p.rosterStatus === "active" || p.rosterStatus === "transferred_in")} tradeBlock={tradeBlock} busy={busy} onRemove={removeFromTradeBlock} onChanged={loadCore} />
        </>
      )}

      {viewMode === "builder" && <>
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
            <TradeAssetPool sideLabel="Selected to offer" roster={myRoster} selected={offeredLegs} onToggle={toggleOffered} disabled={offeredLegs.length >= MAX_LEGS} />
            <label className="form-field">
              <span className="form-label">Coins to include</span>
              <input type="number" min={0} className="form-input" value={offeredCoins} onChange={(event) => setOfferedCoins(Math.max(0, Number(event.target.value) || 0))} />
            </label>
          </div>
          <div className="hub-trade-side">
            <h4>You request ({requestedLegs.length}/{MAX_LEGS})</h4>
            <TradeAssetPool sideLabel="Selected to request" roster={opponentRoster} selected={requestedLegs} onToggle={toggleRequested} disabled={requestedLegs.length >= MAX_LEGS} />
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
      </>}
    </div>
  );
}
