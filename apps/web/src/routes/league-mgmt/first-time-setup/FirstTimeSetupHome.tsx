import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useReadyAuth } from "../../../lib/auth-context.js";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LeagueWeekView } from "../../../types/api.js";
import { PageHeader } from "../../../components/ui/PageHeader.js";
import { Card } from "../../../components/ui/Card.js";
import { Button } from "../../../components/ui/Button.js";
import { LoadingState } from "../../../components/ui/LoadingState.js";
import { ErrorState } from "../../../components/ui/ErrorState.js";

const GAME_OPTIONS = [
  { value: "madden_26", label: "Madden 26" },
  { value: "madden_27", label: "Madden 27" },
  { value: "cfb_27", label: "College Football 27" },
];
const LEAGUE_TYPE_OPTIONS = [
  { value: "fantasy_draft", label: "Fantasy Draft" },
  { value: "regular_rosters", label: "Regular Rosters" },
  { value: "custom_rosters", label: "Custom Rosters" },
];

// createLeagueForServer (apps/api/src/modules/setup/setup.service.ts) does everything in one
// call: registers the server if needed, creates the league + a fully-defaulted config row
// (every field CreateLeagueSchema doesn't get here falls back to its Zod default — the same
// sensible defaults a Discord-native fresh setup would produce), links it to this server, and
// auto-seeds default teams. So this screen only needs the handful of fields that genuinely
// define a NEW league; everything else — economy, rules, gameplay, play-call limits — is one
// click away on Settings right after creation, using the exact same fields either way.
export function FirstTimeSetupHome() {
  const { guildId } = useReadyAuth();
  const [existing, setExisting] = useState<LeagueWeekView | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [game, setGame] = useState("madden_26");
  const [leagueType, setLeagueType] = useState("regular_rosters");
  const [activeRostersEnabled, setActiveRostersEnabled] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ leagueName: string; teamCount: number } | null>(null);

  useEffect(() => {
    recApi
      .viewLeagueWeek(guildId)
      .then((res) => setExisting(res))
      .catch((err) => {
        // No league linked yet is the normal, expected case for a server that hasn't run
        // First-Time Setup — not an error. Anything else (403, 500, network) is real.
        const message = err instanceof Error ? err.message : "Failed to check for an existing league.";
        if (message.includes("404")) setExisting({ league: null, server: null });
        else setError(message);
      })
      .finally(() => setChecked(true));
  }, [guildId]);

  const hasExistingLeague = Boolean(existing?.league);
  const existingName = existing?.league?.name ?? "";
  const rebuildConfirmed = !hasExistingLeague || confirmText.trim().toLowerCase() === existingName.trim().toLowerCase();
  const canSubmit = name.trim().length > 0 && rebuildConfirmed;

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await recApi.createLeague({
        guildId,
        name: name.trim(),
        game,
        ...(game === "cfb_27" ? { activeRostersEnabled } : { leagueType }),
      });
      setResult({ leagueName: res.league.name, teamCount: res.defaultTeams?.length ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the league.");
      setBusy(false);
    }
  }

  if (!checked) return <LoadingState />;

  return (
    <div>
      <PageHeader title="First-Time Setup" subtitle="Create a new league for this server." />
      {error && <ErrorState message={error} />}

      {result && (
        <Card>
          <h2 style={{ marginTop: 0, color: "var(--success)" }}>League Created</h2>
          <p>{result.leagueName} — {result.teamCount} default team(s) created.</p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-4)" }}>
            <Link to="/league-mgmt/settings"><Button variant="primary">Configure Settings</Button></Link>
            <Link to="/league-mgmt/teams"><Button variant="secondary">Link Teams</Button></Link>
            <Link to="/league-mgmt/manage-league"><Button variant="secondary">Set Schedule</Button></Link>
          </div>
        </Card>
      )}

      {!result && existing && (
        <Card style={hasExistingLeague ? { borderColor: "var(--error)" } : undefined}>
          {hasExistingLeague && (
            <>
              <h2 style={{ marginTop: 0, color: "var(--error)" }}>WARNING: A league already exists</h2>
              <p>Running this again <strong>deletes every record</strong> of <strong>{existingName}</strong> and starts fresh — same as Delete League, plus creates the new one immediately after. This cannot be undone.</p>
            </>
          )}

          <div className="form-field">
            <label className="form-label" htmlFor="league-name">League Name</label>
            <input id="league-name" className="form-input" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="game-select">Game</label>
            <select id="game-select" className="form-select" value={game} disabled={busy} onChange={(e) => setGame(e.target.value)}>
              {GAME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {game === "cfb_27" ? (
            <div className="form-field">
              <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <input type="checkbox" checked={activeRostersEnabled} disabled={busy} onChange={(e) => setActiveRostersEnabled(e.target.checked)} />
                Active Rosters Enabled
              </label>
            </div>
          ) : (
            <div className="form-field">
              <label className="form-label" htmlFor="league-type-select">League Type</label>
              <select id="league-type-select" className="form-select" value={leagueType} disabled={busy} onChange={(e) => setLeagueType(e.target.value)}>
                {LEAGUE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {hasExistingLeague && (
            <div className="form-field">
              <label className="form-label" htmlFor="confirm-rebuild">Type the existing league name to confirm: {existingName}</label>
              <input id="confirm-rebuild" className="form-input" value={confirmText} disabled={busy} onChange={(e) => setConfirmText(e.target.value)} placeholder={existingName} />
            </div>
          )}

          <Button variant={hasExistingLeague ? "danger" : "primary"} onClick={handleCreate} disabled={!canSubmit || busy}>
            {busy ? "Creating…" : hasExistingLeague ? "Delete Existing & Create New League" : "Create League"}
          </Button>
        </Card>
      )}
    </div>
  );
}
