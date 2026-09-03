import { useState } from "react";
import { siteApi, type ImmortalityContractView } from "../lib/site-api.js";

function contractTitle(number: number): string {
  if (number === 1) return "First Contract";
  if (number === 2) return "Second Contract";
  return "Final Contract";
}

function formatCoins(amount: number): string {
  return amount.toLocaleString("en-US");
}

function RiseContractDocument({
  contract,
  signing,
  signed,
  onSign,
}: {
  contract: ImmortalityContractView;
  signing: boolean;
  signed: boolean;
  onSign: () => void;
}) {
  const playerName = contract.playerName || "Player";
  const teamName = contract.teamName || "the Club";
  const ownerName = contract.ownerName || "the Owner";
  // "Signed" only reflects the server's confirmed status -- `signing` used to count as signed on
  // its own, so the pad claimed "Signed" the instant the tap fired, well before the (deliberately
  // delayed) API call even started. If that call failed or never completed (closed the tab during
  // the 1.1s writing animation, a 403 from a stale session, a network hiccup), the pad still
  // showed "Signed" for that whole window with nothing to contradict it -- exactly the kind of gap
  // that leaves a contract looking executed on screen while the database still says "offered."
  const isSigned = signed || contract.status === "signed";
  const showSignature = signing || isSigned;

  return (
    <article className="rise-contract" aria-label={`${contractTitle(contract.contractNumber)} for ${playerName}`}>
      <header className="rise-contract-club">
        {contract.teamLogoUrl ? (
          <img src={contract.teamLogoUrl} alt="" className="rise-contract-logo" />
        ) : (
          <span className="rise-contract-logo-fallback">{contract.teamAbbr ?? "NFL"}</span>
        )}
        <div className="rise-contract-club-copy">
          <p className="rise-contract-kicker">National Football League</p>
          <h3>{teamName}</h3>
          <p>Standard Player Contract · {contractTitle(contract.contractNumber)}</p>
        </div>
      </header>

      <div className="rise-contract-parties">
        <div className="rise-contract-player">
          <img
            src={contract.headshotUrl || "/assets/player-cards/player-silhouette.svg"}
            alt=""
            className="rise-contract-headshot"
          />
          <div>
            <span className="rise-contract-kicker">Player</span>
            <strong>{playerName}</strong>
            <span>{[contract.position, contract.side === "defense" ? "Defense" : contract.side === "offense" ? "Offense" : null].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        <div className="rise-contract-owner">
          <span className="rise-contract-kicker">Club Owner</span>
          <strong>{ownerName}</strong>
          <span>on behalf of {teamName}</span>
        </div>
      </div>

      <dl className="rise-contract-terms">
        <div>
          <dt>Term</dt>
          <dd>Seasons {contract.startSeason}–{contract.endSeason}</dd>
        </div>
        <div>
          <dt>Signing bonus</dt>
          <dd>{formatCoins(contract.coins)} REC Coins</dd>
        </div>
        <div>
          <dt>Player XP</dt>
          <dd>{contract.playerXp} Player XP</dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd>One-time at signing</dd>
        </div>
      </dl>

      <p className="rise-contract-legal">
        The Club agrees to pay the Player the signing bonus and Player XP listed above in a single installment
        upon execution. This award is not recurring and does not replace future contracts.
      </p>

      <button
        type="button"
        className={`rise-contract-sign-pad${isSigned ? " is-signed" : ""}`}
        disabled={showSignature}
        onClick={onSign}
      >
        <span className="rise-contract-sign-hint">{isSigned ? "Signed" : signing ? "Signing…" : "Tap the line to sign"}</span>
        <span className={`rise-contract-signature${signing ? " is-writing" : ""}${showSignature ? " is-visible" : ""}`}>
          {playerName}
        </span>
        <span className="rise-contract-sign-line" />
      </button>
    </article>
  );
}

export function RiseContractSigning({
  guildId,
  contracts,
  onSigned,
  setError,
}: {
  guildId: string;
  contracts: ImmortalityContractView[];
  onSigned: () => Promise<void>;
  setError: (value: string | null) => void;
}) {
  const unsigned = contracts.filter((row) => row.status !== "signed");
  const signed = contracts.filter((row) => row.status === "signed");
  const queue = unsigned.length ? unsigned : signed;
  const [index, setIndex] = useState(0);
  const [signingId, setSigningId] = useState<string | null>(null);
  const current = queue[Math.min(index, Math.max(0, queue.length - 1))] ?? null;
  if (!current) return null;

  async function signCurrent() {
    if (!current || current.status === "signed" || signingId) return;
    setSigningId(current.id);
    setError(null);
    // Fires the real request immediately -- it used to wait behind a 1.1s setTimeout purely to
    // pace the signature-writing animation, which meant closing the tab or navigating away during
    // that window meant the sign call never went out at all, even though the pad had already
    // shown the (now-fixed) "Signed" state. The animation still gets its full 1.1s; only the
    // network call's own timing no longer depends on it.
    const startedAt = Date.now();
    try {
      await siteApi.immortalitySignContract({ guildId, contractId: current.id });
      const elapsed = Date.now() - startedAt;
      if (elapsed < 1100) await new Promise((resolve) => window.setTimeout(resolve, 1100 - elapsed));
      await onSigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign that contract.");
    } finally {
      setSigningId(null);
    }
  }

  return (
    <section className="rise-contract-wrap">
      <header className="rise-contract-wrap-head">
        <h2>{unsigned.length ? "Sign your contracts" : "Executed contracts"}</h2>
        <p>
          {unsigned.length
            ? "The numbers on this page are the actual offer. Tap the signature line on each contract to execute it."
            : "These contracts are on file for this franchise."}
        </p>
        {queue.length > 1 ? (
          <div className="rise-contract-pager">
            <button type="button" className="site-btn site-btn-ghost" disabled={index <= 0} onClick={() => setIndex((value) => value - 1)}>Previous</button>
            <span>{index + 1} of {queue.length}</span>
            <button type="button" className="site-btn site-btn-ghost" disabled={index >= queue.length - 1} onClick={() => setIndex((value) => value + 1)}>Next</button>
          </div>
        ) : null}
      </header>
      <RiseContractDocument
        contract={current}
        signing={signingId === current.id}
        signed={current.status === "signed"}
        onSign={() => void signCurrent()}
      />
    </section>
  );
}
