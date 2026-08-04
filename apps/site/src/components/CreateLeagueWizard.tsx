import { useState } from "react";
import { siteApi } from "../lib/site-api.js";

type GameKey = "madden_26" | "madden_27" | "cfb_27";

const GAME_OPTIONS: { value: GameKey; label: string }[] = [
  { value: "madden_26", label: "Madden 26" },
  { value: "madden_27", label: "Madden 27" },
  { value: "cfb_27", label: "CFB 27" },
];

// Only the handful of fields that genuinely define a brand-new league — everything else
// (economy, streaming, difficulty, coach mode, etc.) rides on server-side defaults and is one
// Settings edit away right after creation, same pattern as the web hub's own minimal
// first-time-setup wizard. No Discord server is required yet: the league lands "unclaimed"
// (visible under My Leagues, with the existing Connect Discord card) until the commissioner
// invites the bot.
export function CreateLeagueWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (leagueId: string) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [game, setGame] = useState<GameKey | "">("");
  const [activeRostersEnabled, setActiveRostersEnabled] = useState(true);
  const [trackRostersEnabled, setTrackRostersEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCfb = game === "cfb_27";

  async function create() {
    if (!game) return;
    setBusy(true);
    setError(null);
    try {
      const result = await siteApi.createLeague({
        name: name.trim(),
        game,
        ...(isCfb ? { activeRostersEnabled, trackRostersEnabled } : {}),
      });
      onCreated(result.league.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the league.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="site-modal" role="dialog" aria-modal="true" aria-labelledby="create-league-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="site-modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 id="create-league-title">Create League</h2>
        <p className="site-muted">Step {step} of 3</p>
        {error && <p className="site-auth-error">{error}</p>}

        {step === 1 && (
          <>
            <label className="site-field">
              <span>League name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. REC OG" />
            </label>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="site-btn site-btn-primary" disabled={!name.trim()} onClick={() => setStep(2)}>Next</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <label className="site-field">
              <span>Game</span>
              <select className="site-select" value={game} onChange={(event) => setGame(event.target.value as GameKey)}>
                <option value="">Select a game</option>
                {GAME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={!game} onClick={() => setStep(3)}>Next</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {isCfb && (
              <>
                <label className="site-field site-field-checkbox">
                  <input type="checkbox" checked={activeRostersEnabled} onChange={(event) => setActiveRostersEnabled(event.target.checked)} />
                  <span>Seed active rosters from the current CFB baseline dataset</span>
                </label>
                <label className="site-field site-field-checkbox">
                  <input type="checkbox" checked={trackRostersEnabled} onChange={(event) => setTrackRostersEnabled(event.target.checked)} />
                  <span>Track rosters (recruiting, transfer portal, roster progression)</span>
                </label>
              </>
            )}
            <p className="site-muted">
              Everything else — economy, streaming rules, difficulty, and more — starts at
              sensible defaults and can be changed anytime from League Management → Settings
              once the league is created.
            </p>
            <div className="site-modal-actions">
              <button type="button" className="site-btn site-btn-ghost" onClick={() => setStep(2)}>Back</button>
              <button type="button" className="site-btn site-btn-primary" disabled={busy} onClick={() => void create()}>{busy ? "Creating…" : "Create League"}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
