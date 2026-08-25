import { useEffect, useMemo, useRef, useState } from "react";
import {
  TOURNAMENT_INJURY_OPTIONS,
  TOURNAMENT_PAYOUT_SCOPES,
  TOURNAMENT_PLAYSTYLES,
  TOURNAMENT_TIMEZONES,
  tournamentDifficultyOptions,
  type TournamentRules,
} from "@rec/shared";
import { siteApi, type SiteRosterLibrary, type SiteTournamentSummary } from "../lib/site-api.js";
import { isoFromZonedLocal, localInputInZone } from "./Tournaments.js";

/** Same field set as CreateTournamentForm, minus the bracket-type picker (never editable after
 *  creation -- changing it would break seeding math for any entrants already registered) and
 *  plus a logo upload and the scheduling-window setting. Locked/complete tournaments only allow
 *  title/description/logo/scheduling-window to change (enforced server-side too). */
export function EditTournamentForm({ tournament, onUpdated }: { tournament: SiteTournamentSummary; onUpdated: (next: SiteTournamentSummary) => void }) {
  const locked = tournament.status === "locked" || tournament.status === "complete";
  const [timezone, setTimezone] = useState(tournament.timezone);
  const [title, setTitle] = useState(tournament.title);
  const [description, setDescription] = useState(tournament.description ?? "");
  const [payoutScope, setPayoutScope] = useState(tournament.payoutScope);
  const [winnerCoins, setWinnerCoins] = useState(String(tournament.winnerCoins));
  const [runnerUpCoins, setRunnerUpCoins] = useState(String(tournament.runnerUpCoins));
  const [semifinalistCoins, setSemifinalistCoins] = useState(String(tournament.semifinalistCoins));
  const [opensAt, setOpensAt] = useState(() => localInputInZone(new Date(tournament.registrationOpensAt ?? Date.now()), tournament.timezone));
  const [closesAt, setClosesAt] = useState(() => localInputInZone(new Date(tournament.registrationClosesAt ?? Date.now()), tournament.timezone));
  const [kickoffAt, setKickoffAt] = useState(() => localInputInZone(new Date(tournament.kickoffAt ?? Date.now()), tournament.timezone));
  const [rules, setRules] = useState<TournamentRules>(tournament.rules);
  const [rosterLibraries, setRosterLibraries] = useState<SiteRosterLibrary[]>([]);
  const [rosterLibraryId, setRosterLibraryId] = useState(tournament.rosterLibraryId ?? "");
  const [teamSelectionMode, setTeamSelectionMode] = useState(tournament.teamSelectionMode);
  const [claimOrderMode, setClaimOrderMode] = useState(tournament.claimOrderMode ?? "first_come");
  const [scheduleMode, setScheduleMode] = useState(tournament.scheduleMode);
  const [schedulingWindowHours, setSchedulingWindowHours] = useState(String(tournament.schedulingWindowHours));
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoUrl, setLogoUrl] = useState(tournament.logoUrl);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    siteApi.listRosterLibraries(tournament.game as "madden_26" | "madden_27" | "cfb_27").then((result) => {
      if (!cancelled) setRosterLibraries(result.libraries);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [tournament.game]);

  const difficulties = useMemo(() => tournamentDifficultyOptions(tournament.game), [tournament.game]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await siteApi.updateTournament(locked ? {
        tournamentId: tournament.id,
        title,
        description: description.trim() || null,
        schedulingWindowHours: Number(schedulingWindowHours) || 1,
      } : {
        tournamentId: tournament.id,
        title,
        description: description.trim() || null,
        payoutScope,
        winnerCoins: Number(winnerCoins) || 0,
        runnerUpCoins: Number(runnerUpCoins) || 0,
        semifinalistCoins: Number(semifinalistCoins) || 0,
        registrationOpensAt: isoFromZonedLocal(opensAt, timezone),
        registrationClosesAt: isoFromZonedLocal(closesAt, timezone),
        kickoffAt: isoFromZonedLocal(kickoffAt, timezone),
        timezone,
        rules,
        rosterLibraryId: rosterLibraryId || null,
        teamSelectionMode,
        claimOrderMode: teamSelectionMode === "claim_pool" ? claimOrderMode : null,
        scheduleMode,
        schedulingWindowHours: Number(schedulingWindowHours) || 1,
      });
      onUpdated(result.tournament);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setError(null);
    try {
      const result = await siteApi.uploadTournamentLogo(tournament.id, file);
      setLogoUrl(result.logoUrl);
      onUpdated({ ...tournament, logoUrl: result.logoUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed.");
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <form
      className="site-tournament-admin-section"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>Edit tournament</h3>
      {error ? <p className="site-auth-error">{error}</p> : null}
      {locked ? (
        <p className="site-muted">This tournament is {tournament.status} — only branding and the scheduling window can still change.</p>
      ) : null}

      <div className="site-tournament-edit-logo">
        {logoUrl ? <img src={logoUrl} alt="" className="site-tournament-edit-logo-preview" /> : <div className="site-tournament-edit-logo-preview site-tournament-edit-logo-empty">No logo</div>}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); event.target.value = ""; }}
          />
          <button type="button" className="site-btn site-btn-ghost" disabled={logoBusy} onClick={() => fileInputRef.current?.click()}>
            {logoBusy ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </button>
          <p className="site-muted">Shown at the center of the bracket in place of the default trophy. PNG, JPEG, or WebP, up to 5 MB.</p>
        </div>
      </div>

      <label className="site-field">
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} />
      </label>
      <label className="site-field">
        <span>Description</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label className="site-field">
        <span>Scheduling window (hours per round)</span>
        <input type="number" min={1} max={720} value={schedulingWindowHours} onChange={(event) => setSchedulingWindowHours(event.target.value)} />
      </label>

      {!locked ? (
        <div className="site-account-stat-grid site-tournament-create-grid">
          <label className="site-field">
            <span>Pays</span>
            <select className="site-select" value={payoutScope} onChange={(event) => setPayoutScope(event.target.value as typeof payoutScope)}>
              {TOURNAMENT_PAYOUT_SCOPES.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Winner coins</span>
            <input type="number" min={0} value={winnerCoins} onChange={(event) => setWinnerCoins(event.target.value)} />
          </label>
          {payoutScope !== "winner" ? (
            <label className="site-field">
              <span>Runner-up coins</span>
              <input type="number" min={0} value={runnerUpCoins} onChange={(event) => setRunnerUpCoins(event.target.value)} />
            </label>
          ) : null}
          {payoutScope === "final_four" ? (
            <label className="site-field">
              <span>Each semifinalist coins</span>
              <input type="number" min={0} value={semifinalistCoins} onChange={(event) => setSemifinalistCoins(event.target.value)} />
            </label>
          ) : null}
          <label className="site-field">
            <span>Registration opens</span>
            <input type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} required />
          </label>
          <label className="site-field">
            <span>Registration closes</span>
            <input type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} required />
          </label>
          <label className="site-field">
            <span>{scheduleMode === "per_round" ? "First round starts around" : "Kickoff"}</span>
            <input type="datetime-local" value={kickoffAt} onChange={(event) => setKickoffAt(event.target.value)} required />
          </label>
          <label className="site-field">
            <span>Schedule</span>
            <select className="site-select" value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as typeof scheduleMode)}>
              <option value="single_kickoff">Run-through (one kickoff time)</option>
              <option value="per_round">Scheduled phases (assign each round its own day/time)</option>
            </select>
          </label>
          <label className="site-field">
            <span>Schedule timezone</span>
            <select className="site-select" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {TOURNAMENT_TIMEZONES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Roster library</span>
            <select className="site-select" value={rosterLibraryId} onChange={(event) => setRosterLibraryId(event.target.value)}>
              <option value="">No roster library</option>
              {rosterLibraries.map((library) => (
                <option key={library.id} value={library.id}>{library.name}{library.isBaseline ? " (baseline)" : ""}</option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Team selection</span>
            <select className="site-select" value={teamSelectionMode} onChange={(event) => setTeamSelectionMode(event.target.value as typeof teamSelectionMode)}>
              <option value="typed">Open pick (duplicates allowed)</option>
              <option value="claim_pool">Claim from pool (one team per entrant)</option>
            </select>
          </label>
          {teamSelectionMode === "claim_pool" ? (
            <label className="site-field">
              <span>Claim order</span>
              <select className="site-select" value={claimOrderMode} onChange={(event) => setClaimOrderMode(event.target.value as typeof claimOrderMode)}>
                <option value="first_come">First come, first served</option>
                <option value="lottery">Scheduled lottery draft</option>
              </select>
            </label>
          ) : null}
          <label className="site-field">
            <span>Quarter length</span>
            <select className="site-select" value={String(rules.quarterLengthMinutes)} onChange={(event) => setRules((current) => ({ ...current, quarterLengthMinutes: Number(event.target.value) }))}>
              {Array.from({ length: 12 }, (_, index) => index + 4).map((minutes) => (
                <option key={minutes} value={minutes}>{minutes} minutes</option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Difficulty</span>
            <select className="site-select" value={rules.difficulty} onChange={(event) => setRules((current) => ({ ...current, difficulty: event.target.value }))}>
              {difficulties.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Playstyle</span>
            <select className="site-select" value={rules.playstyle} onChange={(event) => setRules((current) => ({ ...current, playstyle: event.target.value as TournamentRules["playstyle"] }))}>
              {TOURNAMENT_PLAYSTYLES.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Injuries</span>
            <select className="site-select" value={rules.injuries} onChange={(event) => setRules((current) => ({ ...current, injuries: event.target.value as TournamentRules["injuries"] }))}>
              {TOURNAMENT_INJURY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="site-field">
            <span>Accelerated clock</span>
            <select className="site-select" value={rules.acceleratedClockEnabled ? "on" : "off"} onChange={(event) => setRules((current) => ({ ...current, acceleratedClockEnabled: event.target.value === "on" }))}>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          {rules.acceleratedClockEnabled ? (
            <label className="site-field">
              <span>Min play clock</span>
              <select className="site-select" value={String(rules.acceleratedClockMinimumSeconds)} onChange={(event) => setRules((current) => ({ ...current, acceleratedClockMinimumSeconds: Number(event.target.value) }))}>
                {Array.from({ length: 16 }, (_, index) => index + 10).map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds} seconds</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="site-field">
            <span>Fatigue</span>
            <select className="site-select" value={rules.fatigueEnabled ? "on" : "off"} onChange={(event) => setRules((current) => ({ ...current, fatigueEnabled: event.target.value === "on" }))}>
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </label>
          {tournament.game === "cfb_27" ? (
            <label className="site-field">
              <span>Wear & tear</span>
              <select className="site-select" value={rules.wearAndTearEnabled ? "on" : "off"} onChange={(event) => setRules((current) => ({ ...current, wearAndTearEnabled: event.target.value === "on" }))}>
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <button className="site-btn site-btn-primary" type="submit" disabled={busy || title.trim().length < 2}>
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
