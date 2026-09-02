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
  const showSignature = signing || signed || contract.status === "signed";

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
        className={`rise-contract-sign-pad${showSignature ? " is-signed" : ""}`}
        disabled={showSignature}
        onClick={onSign}
      >
        <span className="rise-contract-sign-hint">{showSignature ? "Signed" : "Tap the line to sign"}</span>
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
    window.setTimeout(() => {
      void (async () => {
        try {
          await siteApi.immortalitySignContract({ guildId, contractId: current.id });
          await onSigned();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not sign that contract.");
        } finally {
          setSigningId(null);
        }
      })();
    }, 1100);
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
