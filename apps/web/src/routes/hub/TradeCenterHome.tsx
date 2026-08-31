import { useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { MADDEN_PICK_BASELINE_META, normalizeMaddenDevTrait } from "@rec/shared";
import { useReadyAuth } from "../../lib/auth-context.js";
import { useHubChrome } from "../../lib/hub-chrome-context.js";
import { recApi } from "../../lib/rec-api-client.js";
import type { Trade, TradeBlockListing, TradeLegInput, TeamRosterResponse, RosterPlayer, TeamDraftPick, TradeEvaluatorReport, TradeAssetDisplay } from "../../types/api.js";
import { LoadingState } from "../../components/ui/LoadingState.js";
import { ErrorState } from "../../components/ui/ErrorState.js";
import { Modal } from "../../components/ui/Modal.js";
import { Button } from "../../components/ui/Button.js";
import { ATTRIBUTE_ALL_KEYS, attributeFullName, attributeLabel } from "../../lib/attribute-columns.js";
import { PlayerPhoto } from "../../components/hub/PlayerPhoto.js";

const MAX_LEGS = 7;
const ROSTER_ACTIVE_STATUSES = new Set(["active", "transferred_in"]);

// "normal" is the baseline trait every player who isn't Star/Superstar/X-Factor has -- it gets
// no badge at all (matches the full player card's traitBadgeSrc), not the "hidden"/unscouted icon.
function DevTraitIcon({ devTrait }: { devTrait: string | null | undefined }) {
  const tier = normalizeMaddenDevTrait(devTrait);
  if (tier == null || tier === "normal") return null;
  return <img className="hub-trade-devtrait-icon" src={`/assets/dev-traits/${tier}.png`} alt={tier} title={tier} loading="lazy" />;
}

function CollapsibleSection({ title, count, defaultOpen = true, flash = false, children }: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  flash?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="hub-trade-collapsible">
      <button type="button" className={`hub-trade-collapsible-header${flash ? " hub-trade-collapsible-header--alert" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span>{title}{count != null ? ` (${count})` : ""}</span>
        <span className="hub-trade-collapsible-chevron">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && <div className="hub-trade-collapsible-body">{children}</div>}
    </section>
  );
}

function describeTradeAssets(trade: Trade, myTeamId: string, myRoster: TeamRosterResponse): { youReceive: string; theyReceive: string } {
  const vs = trade.value_snapshot;
  if (!vs) {
    const amSender = trade.proposing_team_id === myTeamId;
    return {
      youReceive: amSender ? "Waiting for evaluator data…" : "Waiting for evaluator data…",
      theyReceive: amSender ? "Waiting for evaluator data…" : "Waiting for evaluator data…",
    };
  }
  const fmt = (assets: TradeAssetDisplay[]) =>
    assets.map((a) => {
      const parts = [a.label];
      if (a.position) parts[0] = `${a.label} (${a.position})`;
      if (a.overallRating != null) parts.push(`${a.overallRating} OVR`);
      return parts.join(" \u2014 ");
    });
  const amSender = trade.proposing_team_id === myTeamId;
  const senderAssets = amSender ? vs.proposingAssets : vs.receivingAssets;
  const receiverAssets = amSender ? vs.receivingAssets : vs.proposingAssets;
  const senderCoins = amSender ? trade.proposing_coins : trade.receiving_coins;
  const receiverCoins = amSender ? trade.receiving_coins : trade.proposing_coins;
  const senderStr = fmt(senderAssets).join(", ") + (senderCoins > 0 ? ` + ${senderCoins} coins` : "");
  const receiverStr = fmt(receiverAssets).join(", ") + (receiverCoins > 0 ? ` + ${receiverCoins} coins` : "");
  return { youReceive: receiverStr || "Nothing", theyReceive: senderStr || "Nothing" };
}

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
        <PlayerPhoto
          photoUrl={player.photoUrl}
          alt={player.fullName}
          className="fantasy-draft-player-card-photo"
          fallback={<div className="fantasy-draft-player-card-photo fantasy-draft-player-photo-empty">{player.position}</div>}
        />
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
  const [sortKey, setSortKey] = useState("overallRating");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
    .sort((a, b) => {
      const av = sortKey === "overallRating" ? a.overallRating ?? -1 : a.attributes[sortKey] ?? -1;
      const bv = sortKey === "overallRating" ? b.overallRating ?? -1 : b.attributes[sortKey] ?? -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });

  function handleHeaderClick(key: string) {
    if (sortKey !== key) { setSortKey(key); setSortDir("desc"); return; }
    if (sortDir === "desc") { setSortDir("asc"); return; }
    setSortKey("overallRating"); setSortDir("desc");
  }
  function sortIndicator(key: string) {
    if (sortKey !== key) return null;
    return sortDir === "desc" ? "▼" : "▲";
  }
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
            {/* roster.positionGroups (the source of `groups`) already includes a synthetic
                "Draft Picks" entry for Madden rosters -- this used to also add its own literal
                option ahead of that map, rendering "Draft Picks" twice in the same dropdown. */}
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
              <tr>
                <th className="fantasy-draft-pool-table-name-col">Player</th>
                <th className="is-sortable" onClick={() => handleHeaderClick("overallRating")}>OVR {sortIndicator("overallRating")}</th>
                {ATTRIBUTE_ALL_KEYS.map((key) => (
                  <th key={key} className="is-sortable" title={attributeFullName(key)} onClick={() => handleHeaderClick(key)}>
                    {attributeLabel(key)} {sortIndicator(key)}
                  </th>
                ))}
                <th className="fantasy-draft-pool-table-action-col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((player) => {
                const checked = selectedKeys.has(legKey({ type: "player", playerId: player.id }));
                return (
                  <tr key={player.id}>
                    <td className="fantasy-draft-pool-table-name-col">
                      <button type="button" className="fantasy-draft-player-name-btn" onClick={() => setOpenPlayer(player)}>
                        <PlayerPhoto
                          photoUrl={player.photoUrl}
                          loading="lazy"
                          className="fantasy-draft-player-photo"
                          fallback={<div className="fantasy-draft-player-photo fantasy-draft-player-photo-empty">{player.position}</div>}
                        />
                        <DevTraitIcon devTrait={player.devTrait} />
                        <span><strong>{player.fullName}</strong><small>{player.position}</small></span>
                      </button>
                    </td>
                    <td>{player.overallRating ?? "—"}</td>
                    {ATTRIBUTE_ALL_KEYS.map((key) => <td key={key}>{player.attributes[key] ?? "—"}</td>)}
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
              <li key={player.id}><span><DevTraitIcon devTrait={player.devTrait} /><strong>{player.fullName}</strong> · {player.position} · {player.overallRating ?? "—"} OVR</span><button type="button" aria-label={`Remove ${player.fullName}`} onClick={() => onToggle({ type: "player", playerId: player.id })}><Trash2 size={14} /></button></li>
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

function seasonNumberToYear(seasonNumber: number, game: string): number {
  const meta = MADDEN_PICK_BASELINE_META[game as keyof typeof MADDEN_PICK_BASELINE_META];
  return meta ? meta.firstDraftYear + seasonNumber - 1 : seasonNumber;
}

function describeListingOffer(listing: TradeBlockListing, myRoster: TeamRosterResponse, game: string): string {
  const parts = listing.offeredLegs.map((leg) => {
    if (leg.type === "player") {
      const playerName = listing.playerNamesById[leg.playerId];
      return playerName ?? "a player";
    }
    const pick = myRoster.draftPicks.find((p) => p.id === leg.draftPickId);
    if (!pick) return "a draft pick";
    const year = seasonNumberToYear(pick.seasonNumber, game);
    const pickNum = pick.pickNumber ? `, Pick ${pick.pickNumber}` : "";
    return `${year} Round ${pick.round}${pickNum}`;
  });
  if (listing.offeredCoins > 0) parts.push(`${listing.offeredCoins} coins`);
  return parts.length ? parts.join(", ") : "nothing yet";
}

/** Open "package offer" board: post up to 7 players/picks + coins with a free-text "looking
 * for", visible league-wide and announced to Discord's trade-block channel — distinct from
 * the simple single-player TradeBlockSection below, which just flags one player as available. */
function TradeBlockPanel({ guildId, myRoster, game, onChanged, onPropose }: {
  guildId: string;
  myRoster: TeamRosterResponse;
  game: string;
  onChanged: () => void;
  onPropose: (listing: TradeBlockListing) => void;
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
            <span><strong>{listing.teamName}</strong> is ISO <strong>{listing.lookingFor}</strong> and is offering: {describeListingOffer(listing, myRoster, game)}</span>
            {listing.teamId === myRoster.team.id && (
              <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void withdraw(listing.id)}>Withdraw</button>
            )}
            {listing.teamId !== myRoster.team.id && (
              <button type="button" className="btn btn-success btn-compact" onClick={() => onPropose(listing)}>Propose Offer</button>
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

function evaluatorBadge(report: TradeEvaluatorReport, proposingLabel: string, receivingLabel: string): { text: string; tone: "fair" | "lean" } {
  if (report.verdict === "balanced") return { text: "FAIR TRADE", tone: "fair" };
  const leaningTeam = report.verdict === "favors_proposing" ? proposingLabel : receivingLabel;
  return { text: `LEAN: ${leaningTeam.toUpperCase()}`, tone: "lean" };
}

function assetLine(asset: TradeAssetDisplay): string {
  if (asset.type === "pick" || asset.type === "coins") return asset.label;
  const parts = [`${asset.overallRating ?? "—"} OVR`];
  if (asset.devTrait) parts.push(asset.devTrait.replace(/\b\w/g, (c) => c.toUpperCase()));
  const specs: string[] = [];
  if (asset.speed != null) specs.push(`${asset.speed} SPD`);
  const specSuffix = specs.length ? ` (${specs.join(", ")})` : "";
  const ageSuffix = asset.age != null ? ` Age ${asset.age}` : "";
  return `${asset.label} — ${parts.join(" ")}${specSuffix}${ageSuffix}`;
}

/** Always-visible trade evaluator while building a trade — recomputed on every leg/coin change
 * against the REC trade value model (OVR, position, dev trait, contract/cap, and each side's
 * positional need). Madden-only; silently hides for CFB leagues. */
function TradeEvaluatorPanel({ guildId, proposingTeamId, receivingTeamId, proposingLabel, receivingLabel, offeredLegs, requestedLegs, offeredCoins, requestedCoins }: {
  guildId: string;
  proposingTeamId: string;
  receivingTeamId: string;
  proposingLabel: string;
  receivingLabel: string;
  offeredLegs: TradeLegInput[];
  requestedLegs: TradeLegInput[];
  offeredCoins: number;
  requestedCoins: number;
}) {
  const [report, setReport] = useState<TradeEvaluatorReport | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!receivingTeamId || (offeredLegs.length === 0 && requestedLegs.length === 0 && !offeredCoins && !requestedCoins)) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      recApi.getTradeFairnessPreview({ guildId, proposingTeamId, receivingTeamId, offeredLegs, requestedLegs, offeredCoins, requestedCoins })
        .then((res) => { if (!cancelled) { setReport(res); setUnavailable(false); } })
        .catch(() => { if (!cancelled) setUnavailable(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [guildId, proposingTeamId, receivingTeamId, offeredLegs, requestedLegs, offeredCoins, requestedCoins]);

  if (unavailable) return null;
  if (!receivingTeamId) return null;

  if (loading && !report) return <div className="hub-trade-evaluator-card"><p className="hub-empty">Calculating…</p></div>;
  if (!report) return <div className="hub-trade-evaluator-card"><p className="hub-empty">Add players, picks, or coins to see a live value estimate.</p></div>;

  const badge = evaluatorBadge(report, proposingLabel, receivingLabel);
  // 50% = perfectly centered; positive deltaPct favors the proposing (left) side, so the marker
  // — and the colored "lean" fill behind it — shifts toward whichever side is winning the trade.
  const markerPct = Math.max(4, Math.min(96, 50 - report.deltaPct / 2));
  const fillStyle = report.verdict === "favors_receiving"
    ? { left: `${markerPct}%`, width: `${100 - markerPct}%` }
    : { left: 0, width: `${report.verdict === "balanced" ? 100 : markerPct}%` };

  return (
    <div className="hub-trade-evaluator-card">
      <div className="hub-trade-evaluator-header">
        <span className={`hub-trade-evaluator-badge hub-trade-evaluator-badge-${badge.tone}`}>{badge.text}</span>
      </div>
      <div className={`hub-trade-evaluator-bar-track hub-trade-evaluator-bar-track-${badge.tone}`}>
        <div className="hub-trade-evaluator-bar-fill" style={fillStyle} />
        <div className="hub-trade-evaluator-bar-marker" style={{ left: `${markerPct}%` }} />
      </div>
      <div className="hub-trade-evaluator-sides">
        {/* Each team's header score is the value of what THAT team receives — same total the
            RECEIVE list below it sums to (offeredLegs flow proposing→receiving, so receivingAssets
            is what the proposing side gets, valued via report.receiving; and vice versa). */}
        <div className="hub-trade-evaluator-side">
          <h5 className="hub-trade-evaluator-team hub-trade-evaluator-team-a">{proposingLabel} <span>{report.receiving.needAdjustedTotal}</span></h5>
          <p className="hub-trade-evaluator-receive">RECEIVE</p>
          {report.receivingAssets.length === 0 ? <p className="hub-empty">Nothing yet.</p> : report.receivingAssets.map((asset) => <p key={asset.id}>{assetLine(asset)}</p>)}
        </div>
        <div className="hub-trade-evaluator-side">
          <h5 className="hub-trade-evaluator-team hub-trade-evaluator-team-b">{receivingLabel} <span>{report.proposing.needAdjustedTotal}</span></h5>
          <p className="hub-trade-evaluator-receive">RECEIVE</p>
          {report.proposingAssets.length === 0 ? <p className="hub-empty">Nothing yet.</p> : report.proposingAssets.map((asset) => <p key={asset.id}>{assetLine(asset)}</p>)}
        </div>
      </div>
    </div>
  );
}

/** Committee-vote widget for a pending_review trade under competition_committee_review — every
 * commissioner/co-commissioner casts approve/reject; once everyone eligible has voted the
 * majority auto-applies. The head commissioner can force an early close, but only after
 * confirming in a popup that not everyone has voted yet. */
function TradeVotePanel({ guildId, tradeId, isHeadCommissioner, busy, onChanged }: {
  guildId: string;
  tradeId: string;
  isHeadCommissioner: boolean;
  busy: boolean;
  onChanged: () => void;
}) {
  const [tally, setTally] = useState<{ electorCount: number; votedCount: number; approve: number; reject: number; allVoted: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    recApi.getTradeVoteStatus({ guildId, tradeId }).then(setTally).catch(() => undefined);
  }
  useEffect(load, [guildId, tradeId]);

  async function vote(choice: "approve" | "reject") {
    setError(null);
    try {
      await recApi.castTradeVote({ guildId, tradeId, vote: choice });
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cast your vote.");
    }
  }

  async function forceClose(action: "approve" | "reject") {
    if (!window.confirm(`${tally?.votedCount ?? 0}/${tally?.electorCount ?? 0} commissioners have voted. Force-${action} this trade now without waiting for the rest?`)) return;
    setError(null);
    try {
      await recApi.forceCloseTradeVote({ guildId, tradeId, action });
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to force-close the vote.");
    }
  }

  return (
    <div className="hub-trade-vote-panel">
      {error && <p className="hub-error">{error}</p>}
      {tally && <p className="hub-trade-vote-tally">{tally.votedCount}/{tally.electorCount} voted · {tally.approve} approve · {tally.reject} reject</p>}
      <div className="hub-trade-row-actions">
        <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void vote("approve")}>Cast Approve Vote</button>
        <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void vote("reject")}>Cast Reject Vote</button>
        {isHeadCommissioner && (
          <>
            <button type="button" className="btn btn-ghost btn-compact" disabled={busy} onClick={() => void forceClose("approve")}>Force Approve</button>
            <button type="button" className="btn btn-ghost btn-compact" disabled={busy} onClick={() => void forceClose("reject")}>Force Reject</button>
          </>
        )}
      </div>
    </div>
  );
}

const TRADE_TARGET_POSITIONS = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LE", "RE", "DT", "LOLB", "MLB", "ROLB", "CB", "FS", "SS", "K", "P"];

/** Third Trade Center tab, between Trade Block and Trade Builder. Set a position + attribute
 * floors, search the league's other rosters for matches, then ask the trade evaluator to
 * generate a few realistic offer packages (need-aware in both directions — see
 * trade-targets.service.ts) built from the user's own roster/picks. "Propose This Trade"
 * hands the pick straight to the Trade Builder instead of making the user rebuild it by hand. */
function TradeTargetsPanel({ guildId, onProposeSuggested }: {
  guildId: string;
  onProposeSuggested: (opponentTeamId: string, offeredLegs: TradeLegInput[], requestedLegs: TradeLegInput[], offeredCoins: number) => void;
}) {
  const [position, setPosition] = useState("QB");
  const [filters, setFilters] = useState<Array<{ id: string; code: string; min: number }>>([]);
  const [draftKey, setDraftKey] = useState(ATTRIBUTE_ALL_KEYS[0]!);
  const [draftMin, setDraftMin] = useState(80);
  const [results, setResults] = useState<import("../../types/api.js").TradeTargetPlayer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTargetId, setOpenTargetId] = useState<string | null>(null);
  const [offers, setOffers] = useState<import("../../types/api.js").TradeTargetOffersResponse | null>(null);
  const [offersLoading, setOffersLoading] = useState(false);

  function addFilter() {
    if (filters.some((f) => f.code === draftKey)) return;
    setFilters((current) => [...current, { id: crypto.randomUUID(), code: draftKey, min: draftMin }]);
  }

  async function search() {
    setSearching(true); setError(null); setResults(null); setOpenTargetId(null); setOffers(null);
    try {
      const res = await recApi.searchTradeTargets({ guildId, position, filters: filters.map((f) => ({ code: f.code, min: f.min })) });
      setResults(res.players);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to search Trade Targets.");
    } finally {
      setSearching(false);
    }
  }

  async function findOffers(playerId: string) {
    setOpenTargetId(playerId); setOffers(null); setOffersLoading(true); setError(null);
    try {
      const res = await recApi.suggestTradeOffers({ guildId, targetPlayerId: playerId });
      setOffers(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate offers.");
    } finally {
      setOffersLoading(false);
    }
  }

  return (
    <section className="hub-trade-targets">
      <p className="form-hint">Set a position and attribute floors to scout the league's rosters, then get a few realistic offer packages built from your own team.</p>

      <div className="hub-trade-targets-filters">
        <label className="form-field">
          <span className="form-label">Position</span>
          <select className="form-input" value={position} onChange={(event) => setPosition(event.target.value)}>
            {TRADE_TARGET_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
          </select>
        </label>
        <div className="hub-trade-targets-attr-picker">
          <select className="form-input" value={draftKey} onChange={(event) => setDraftKey(event.target.value)}>
            {ATTRIBUTE_ALL_KEYS.map((key) => <option key={key} value={key}>{attributeLabel(key)} — {attributeFullName(key)}</option>)}
          </select>
          <input className="form-input" type="number" min={0} max={99} value={draftMin} onChange={(event) => setDraftMin(Math.max(0, Math.min(99, Number(event.target.value) || 0)))} />
          <Button variant="secondary" size="compact" onClick={addFilter}>Add Filter</Button>
        </div>
        {filters.length > 0 && (
          <div className="hub-trade-targets-attr-chips">
            {filters.map((f) => (
              <span key={f.id} className="hub-trade-targets-attr-chip">
                {attributeLabel(f.code)} ≥ {f.min}
                <button type="button" aria-label={`Remove ${attributeLabel(f.code)} filter`} onClick={() => setFilters((current) => current.filter((x) => x.id !== f.id))}>×</button>
              </span>
            ))}
          </div>
        )}
        <Button variant="primary" disabled={searching} onClick={() => void search()}>{searching ? "Searching…" : "Search"}</Button>
      </div>

      {error && <p className="hub-error">{error}</p>}

      {results && (
        results.length === 0 ? <p className="hub-empty">No players at this position clear those filters.</p> : (
          <div className="hub-trade-targets-results">
            {results.map((player) => (
              <div key={player.id} className="hub-trade-targets-result">
                <div className="hub-trade-targets-result-info">
                  <strong>{player.fullName}</strong>
                  <span>{player.position} · {player.teamName}{player.overallRating != null ? ` · ${player.overallRating} OVR` : ""}{player.devTrait ? ` · ${player.devTrait.replaceAll("_", " ")}` : ""}</span>
                  {player.attributes.length > 0 && (
                    <span className="hub-trade-targets-result-attrs">{player.attributes.map((a) => `${attributeLabel(a.code)} ${a.value}`).join(" · ")}</span>
                  )}
                </div>
                <Button variant="secondary" size="compact" disabled={offersLoading && openTargetId === player.id} onClick={() => void findOffers(player.id)}>
                  {offersLoading && openTargetId === player.id ? "Thinking…" : "Find Offers"}
                </Button>

                {openTargetId === player.id && offers && (
                  offers.noRealisticOffer ? (
                    <p className="hub-empty">Nothing on your roster makes a realistic offer for this player right now.</p>
                  ) : (
                    <div className="hub-trade-targets-offers">
                      {offers.offers.map((offer) => (
                        <div key={offer.label} className="hub-trade-targets-offer">
                          <div className="hub-trade-targets-offer-header">
                            <strong>{offer.label}</strong>
                            <span className={`hub-trade-evaluator-badge hub-trade-evaluator-badge-${offer.verdict === "balanced" ? "fair" : "lean"}`}>
                              {offer.verdict === "balanced" ? "Fair" : offer.verdict === "favors_receiving" ? "Generous" : "Favors You"}
                            </span>
                          </div>
                          <p className="hub-trade-targets-offer-legs">
                            You send: {[...offer.legs.map((leg) => leg.label), offer.offeredCoins > 0 ? `${offer.offeredCoins.toLocaleString()} coins` : null].filter(Boolean).join(" + ")} ({offer.iGive} pts) for {player.fullName} ({offer.iGet} pts)
                          </p>
                          <Button
                            variant="primary" size="compact"
                            onClick={() => onProposeSuggested(
                              offers.otherTeamId,
                              offer.legs,
                              [{ type: "player", playerId: player.id }],
                              offer.offeredCoins,
                            )}
                          >
                            Propose This Trade
                          </Button>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

export function TradeCenterHome() {
  const { guildId } = useReadyAuth();
  const hub = useHubChrome();
  const isCommissioner = hub.currentLeague?.isCommissioner ?? false;

  const [myRoster, setMyRoster] = useState<TeamRosterResponse | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string; abbreviation: string; isCpu: boolean; hasSiteAccount: boolean }>>([]);
  const [opponentTeamId, setOpponentTeamId] = useState<string>("");
  const [opponentRoster, setOpponentRoster] = useState<TeamRosterResponse | null>(null);
  const [offeredLegs, setOfferedLegs] = useState<TradeLegInput[]>([]);
  const [requestedLegs, setRequestedLegs] = useState<TradeLegInput[]>([]);
  const [offeredCoins, setOfferedCoins] = useState(0);
  const [requestedCoins, setRequestedCoins] = useState(0);
  const [myTrades, setMyTrades] = useState<Trade[] | null>(null);
  const [reviewTrades, setReviewTrades] = useState<Trade[] | null>(null);
  const [tradeCounts, setTradeCounts] = useState<Array<{ teamId: string; teamName: string; abbreviation: string | null; coachName: string; humanTrades: number; cpuTrades: number; totalTrades: number }> | null>(null);
  const [tradeBlock, setTradeBlock] = useState<Array<{ id: string; fullName: string; position: string; overallRating: number | null; teamId: string; teamName: string; note: string | null }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"block" | "targets" | "builder">("block");
  const [builderReminder, setBuilderReminder] = useState<string | null>(null);

  function loadCore() {
    recApi.getTeamRoster({ guildId }).then(setMyRoster).catch((err) => setError(err instanceof Error ? err.message : "Failed to load your roster."));
    recApi.listTradeableTeams(guildId).then(setTeams).catch(() => undefined);
    recApi.getMyTrades(guildId).then((r) => setMyTrades(r.trades)).catch(() => undefined);
    recApi.listTradeBlockPlayers(guildId).then(setTradeBlock).catch(() => undefined);
    if (isCommissioner) {
      recApi.getPendingReviewTrades(guildId).then((r) => setReviewTrades(r.trades)).catch(() => undefined);
      recApi.getSeasonTradeCounts(guildId).then((r) => setTradeCounts(r.teams)).catch(() => undefined);
    }
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
  const opponent = teams.find((team) => team.id === opponentTeamId);
  const opponentIsDiscordOnly = Boolean(opponent && !opponent.isCpu && !opponent.hasSiteAccount);

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
      setBuilderReminder(null);
      loadCore();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to propose trade.");
    } finally {
      setBusy(false);
    }
  }

  // From a trade-block listing's "Propose Offer" button: jump to the builder with the
  // listing's offered assets pre-loaded as what we'd request, and their "looking for" text
  // surfaced as a reminder of what to actually offer in return.
  function proposeForListing(listing: TradeBlockListing) {
    setOpponentTeamId(listing.teamId);
    setOfferedLegs([]);
    setOfferedCoins(0);
    setRequestedLegs(listing.offeredLegs);
    setRequestedCoins(listing.offeredCoins);
    setBuilderReminder(`${listing.teamName} is looking for: ${listing.lookingFor}`);
    setViewMode("builder");
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
        <button type="button" className={viewMode === "targets" ? "active" : ""} onClick={() => setViewMode("targets")}>Trade Targets</button>
        <button type="button" className={viewMode === "builder" ? "active" : ""} onClick={() => setViewMode("builder")}>Trade Builder</button>
      </div>

      {viewMode === "targets" && (
        <TradeTargetsPanel
          guildId={guildId}
          onProposeSuggested={(nextOpponentTeamId, nextOffered, nextRequested, nextOfferedCoins) => {
            setOpponentTeamId(nextOpponentTeamId);
            setOfferedLegs(nextOffered);
            setRequestedLegs(nextRequested);
            setOfferedCoins(nextOfferedCoins);
            setViewMode("builder");
          }}
        />
      )}

      {viewMode === "block" && (<>
        <CollapsibleSection title="Pending Offers" count={pendingReceived.length + pendingSent.length} flash={pendingReceived.length > 0}>
          {pendingReceived.length === 0 && pendingSent.length === 0 && <p className="hub-empty">No active trades.</p>}
          {pendingReceived.map((trade) => {
            const { youReceive, theyReceive } = describeTradeAssets(trade, myRoster.team.id, myRoster);
            const vs = trade.value_snapshot;
            const badge = vs ? evaluatorBadge(vs, trade.proposing_team_id === myRoster.team.id ? myRoster.team.name ?? "Your team" : (teams.find((t) => t.id === trade.proposing_team_id)?.name ?? "Opponent"), trade.receiving_team_id === myRoster.team.id ? myRoster.team.name ?? "Your team" : (teams.find((t) => t.id === trade.receiving_team_id)?.name ?? "Opponent")) : null;
            return (
              <div key={trade.id} className="hub-trade-pending-card">
                <div className="hub-trade-pending-card-header">
                  <span>{statusLabel(trade.status)}</span>
                  {badge && <span className={`hub-trade-evaluator-badge hub-trade-evaluator-badge-${badge.tone}`} style={{ fontSize: "0.65rem" }}>{badge.text}</span>}
                </div>
                <div className="hub-trade-pending-sides">
                  <div className="hub-trade-pending-side">
                    <h5>You receive</h5>
                    <p>{youReceive}</p>
                  </div>
                  <div className="hub-trade-pending-side">
                    <h5>They receive</h5>
                    <p>{theyReceive}</p>
                  </div>
                </div>
                {vs && (
                  <div className="hub-trade-pending-evaluator">
                    <div className="hub-trade-evaluator-bar-track" style={{ height: 4, marginBottom: 8 }}>
                      <div className="hub-trade-evaluator-bar-fill" style={{
                        left: 0,
                        width: `${Math.max(4, Math.min(96, 50 - vs.deltaPct / 2))}%`,
                        background: vs.verdict === "balanced" ? "linear-gradient(90deg, #3b6bd8, #3fbf6f)" : "linear-gradient(90deg, #d0451f, #f0923c)"
                      }} />
                    </div>
                    <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                      Value: {vs.proposing.needAdjustedTotal} vs {vs.receiving.needAdjustedTotal} ({vs.deltaPct > 0 ? "+" : ""}{vs.deltaPct}%)
                    </p>
                  </div>
                )}
                <div className="hub-trade-row-actions" style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void respond(trade.id, "accept")}>Accept</button>
                  <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void respond(trade.id, "decline")}>Decline</button>
                </div>
              </div>
            );
          })}
          {pendingSent.map((trade) => {
            const { youReceive, theyReceive } = describeTradeAssets(trade, myRoster.team.id, myRoster);
            const vs = trade.value_snapshot;
            const badge = vs ? evaluatorBadge(vs, trade.proposing_team_id === myRoster.team.id ? myRoster.team.name ?? "Your team" : (teams.find((t) => t.id === trade.proposing_team_id)?.name ?? "Opponent"), trade.receiving_team_id === myRoster.team.id ? myRoster.team.name ?? "Your team" : (teams.find((t) => t.id === trade.receiving_team_id)?.name ?? "Opponent")) : null;
            return (
              <div key={trade.id} className="hub-trade-pending-card">
                <div className="hub-trade-pending-card-header">
                  <span>Sent to {teams.find((t) => t.id === trade.receiving_team_id)?.name ?? "Opponent"} \u2014 {statusLabel(trade.status)}</span>
                  {badge && <span className={`hub-trade-evaluator-badge hub-trade-evaluator-badge-${badge.tone}`} style={{ fontSize: "0.65rem" }}>{badge.text}</span>}
                </div>
                <div className="hub-trade-pending-sides">
                  <div className="hub-trade-pending-side">
                    <h5>You offer</h5>
                    <p>{theyReceive}</p>
                  </div>
                  <div className="hub-trade-pending-side">
                    <h5>You request</h5>
                    <p>{youReceive}</p>
                  </div>
                </div>
                {vs && (
                  <div className="hub-trade-pending-evaluator">
                    <div className="hub-trade-evaluator-bar-track" style={{ height: 4, marginBottom: 8 }}>
                      <div className="hub-trade-evaluator-bar-fill" style={{
                        left: 0,
                        width: `${Math.max(4, Math.min(96, 50 - vs.deltaPct / 2))}%`,
                        background: vs.verdict === "balanced" ? "linear-gradient(90deg, #3b6bd8, #3fbf6f)" : "linear-gradient(90deg, #d0451f, #f0923c)"
                      }} />
                    </div>
                    <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                      Value: {vs.proposing.needAdjustedTotal} vs {vs.receiving.needAdjustedTotal} ({vs.deltaPct > 0 ? "+" : ""}{vs.deltaPct}%)
                    </p>
                  </div>
                )}
                {trade.status !== "pending_review" && (
                  <div className="hub-trade-row-actions" style={{ marginTop: 8 }}>
                    <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void withdraw(trade.id)}>Withdraw</button>
                  </div>
                )}
              </div>
            );
          })}
        </CollapsibleSection>

        <CollapsibleSection title="Open Trade Block Offers">
          <TradeBlockPanel guildId={guildId} myRoster={myRoster} game={hub.currentLeague?.game ?? ""} onChanged={loadCore} onPropose={proposeForListing} />
        </CollapsibleSection>

        <CollapsibleSection title="Trade Block" defaultOpen={false}>
          <TradeBlockSection guildId={guildId} myTeamId={myRoster.team.id} myPlayers={myRoster.players.filter((p) => p.rosterStatus === "active" || p.rosterStatus === "transferred_in")} tradeBlock={tradeBlock} busy={busy} onRemove={removeFromTradeBlock} onChanged={loadCore} />
        </CollapsibleSection>
      </>)}

      {viewMode === "builder" && (<>
        <section className="hub-trade-propose">
          <h3>Propose a Trade</h3>
          {builderReminder && <p className="hub-notice">{builderReminder}</p>}
          <label className="form-field">
            <span className="form-label">Trade with</span>
            <select className="form-input" value={opponentTeamId} onChange={(event) => {
              const nextTeamId = event.target.value;
              const nextTeam = teams.find((team) => team.id === nextTeamId);
              setOpponentTeamId(nextTeamId);
              setRequestedLegs([]);
              setBuilderReminder(null);
              if (!nextTeam?.hasSiteAccount) { setOfferedCoins(0); setRequestedCoins(0); }
            }}>
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
                <input type="number" min={0} className="form-input" value={offeredCoins} onChange={(event) => setOfferedCoins(Math.max(0, Number(event.target.value) || 0))} disabled={opponentIsDiscordOnly} />
              </label>
            </div>
            <div className="hub-trade-side">
              <h4>You request ({requestedLegs.length}/{MAX_LEGS})</h4>
              <TradeAssetPool sideLabel="Selected to request" roster={opponentRoster} selected={requestedLegs} onToggle={toggleRequested} disabled={requestedLegs.length >= MAX_LEGS} />
              <label className="form-field">
                <span className="form-label">Coins to request</span>
                <input type="number" min={0} className="form-input" value={requestedCoins} onChange={(event) => setRequestedCoins(Math.max(0, Number(event.target.value) || 0))} disabled={!opponentTeamId || opponent?.isCpu || opponentIsDiscordOnly} />
              </label>
            </div>
          </div>

          {opponentIsDiscordOnly && (
            <p className="form-hint">Coins are unavailable for this trade because the other coach does not have a REC site account.</p>
          )}

          {opponentTeamId && (
            <section className="hub-trade-evaluator">
              <h4>Trade Evaluator</h4>
              <TradeEvaluatorPanel
                guildId={guildId}
                proposingTeamId={myRoster.team.id}
                receivingTeamId={opponentTeamId}
                proposingLabel={myRoster.team.name ?? "Your team"}
                receivingLabel={otherTeams.find((t) => t.id === opponentTeamId)?.name ?? "Other team"}
                offeredLegs={offeredLegs}
                requestedLegs={requestedLegs}
                offeredCoins={offeredCoins}
                requestedCoins={requestedCoins}
              />
            </section>
          )}

          <button type="button" className="btn btn-primary" disabled={busy || !opponentTeamId || (offeredLegs.length === 0 && requestedLegs.length === 0 && offeredCoins === 0 && requestedCoins === 0)} onClick={() => void submitProposal()}>
            Propose Trade
          </button>
        </section>

        {isCommissioner && reviewTrades && reviewTrades.length > 0 && (
          <section className="hub-trade-review">
            <h3>Pending Committee/Commissioner Review ({reviewTrades.length})</h3>
            {reviewTrades.map((trade) => (
              <div key={trade.id} className="hub-trade-row hub-trade-row-review">
                <span>
                  Trade {trade.id.slice(0, 8)} · {trade.proposing_coins > 0 ? `+${trade.proposing_coins} coins` : ""} {trade.receiving_coins > 0 ? `/ -${trade.receiving_coins} coins` : ""}
                  {trade.value_snapshot && (
                    <> · {evaluatorBadge(trade.value_snapshot, "proposing team", "receiving team").text} ({trade.value_snapshot.deltaPct > 0 ? "+" : ""}{trade.value_snapshot.deltaPct}%) — proposing gives {trade.value_snapshot.proposing.needAdjustedTotal}, gets {trade.value_snapshot.receiving.needAdjustedTotal}</>
                  )}
                </span>
                {trade.approval_policy_snapshot === "competition_committee_review" ? (
                  <TradeVotePanel guildId={guildId} tradeId={trade.id} isHeadCommissioner={true} busy={busy} onChanged={loadCore} />
                ) : (
                  <div className="hub-trade-row-actions">
                    <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void review(trade.id, "approve")}>Approve</button>
                    <button type="button" className="btn btn-secondary btn-compact" disabled={busy} onClick={() => void review(trade.id, "reject")}>Reject</button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {isCommissioner && tradeCounts && (
          <section className="hub-trade-review">
            <h3>Season Trade Counts</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="fantasy-draft-pool-table">
                <thead><tr><th>Team</th><th>Coach</th><th>Human</th><th>CPU</th><th>Total</th></tr></thead>
                <tbody>{tradeCounts.map((row) => <tr key={row.teamId}><td>{row.abbreviation || row.teamName}</td><td>{row.coachName}</td><td>{row.humanTrades}</td><td>{row.cpuTrades}</td><td>{row.totalTrades}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}

        <section className="hub-trade-mine">
          <h3>History</h3>
          {history.length === 0 && <p className="hub-empty">No settled trades yet.</p>}
          {history.map((trade) => (
            <div key={trade.id} className="hub-trade-row">
              <span>Trade {trade.id.slice(0, 8)} · {statusLabel(trade.status)}</span>
            </div>
          ))}
        </section>
      </>)}
    </div>
  );
}
