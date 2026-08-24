import { useEffect, useMemo, useState } from "react";
import { PlayCircle, ShieldOff, ShieldPlus, UserX, Swords, Ban, RotateCcw, Bot } from "lucide-react";
import { recApi } from "../../../lib/rec-api-client.js";
import type { LinkedTeamRow, HubMatchupSchedule } from "../../../types/api.js";
import { Button } from "../../../components/ui/Button.js";

// Live writes into a commissioner's Madden franchise via EA's Blaze API -- there's no sandbox,
// so every one of these fires a real in-game action the moment it's confirmed.

function teamLabel(row: LinkedTeamRow): string {
  const who = row.user?.display_name ?? row.discordAccount?.username ?? "Unknown";
  return row.team ? `${who} — ${row.team.name}` : who;
}

function useLinkedTeams(guildId: string) {
  const [teams, setTeams] = useState<LinkedTeamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    recApi.listLinkedUsersTeams(guildId).then((result) => {
      if (!cancelled) setTeams(result.linked.filter((row) => row.team));
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load teams."); });
    return () => { cancelled = true; };
  }, [guildId]);
  return { teams, error };
}

function useThisWeekGames(guildId: string) {
  const [schedule, setSchedule] = useState<HubMatchupSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    recApi.getHubMatchupSchedule({ guildId, weekNumber: null }).then((result) => {
      if (!cancelled) setSchedule(result);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load games."); });
    return () => { cancelled = true; };
  }, [guildId]);
  const games = useMemo(() => (schedule?.games ?? []).filter((game) => game.matchupType === "h2h"), [schedule]);
  return { games, error };
}

function TeamActionPanel({
  guildId, leagueId, description, buttonLabel, icon, run,
}: {
  guildId: string;
  leagueId: string;
  description: string;
  buttonLabel: string;
  icon: React.ReactNode;
  run: (teamId: string) => Promise<unknown>;
}) {
  const { teams, error: loadError } = useLinkedTeams(guildId);
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!teamId) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(teamId);
      setDone("Sent to EA.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "EA rejected this action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="form-hint" style={{ marginTop: 0 }}>{description}</p>
      <label className="form-field">
        <span className="form-label">Team</span>
        <select className="form-input" value={teamId} disabled={busy || !teams?.length} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">{teams ? "Select a team" : "Loading teams…"}</option>
          {(teams ?? []).map((row) => <option key={row.id} value={row.team!.id}>{teamLabel(row)}</option>)}
        </select>
      </label>
      {(loadError || error) && <p className="hub-transfer-status">{loadError ?? error}</p>}
      {done && <p className="form-hint" style={{ color: "var(--gold)" }}>{done}</p>}
      <Button variant="secondary" disabled={busy || !teamId} onClick={() => void submit()}>{icon} {busy ? "Sending…" : buttonLabel}</Button>
    </div>
  );
}

function GameActionPanel({
  guildId, leagueId, description, buttonLabel, icon, run,
}: {
  guildId: string;
  leagueId: string;
  description: string;
  buttonLabel: string;
  icon: React.ReactNode;
  run: (gameId: string) => Promise<unknown>;
}) {
  const { games, error: loadError } = useThisWeekGames(guildId);
  const [gameId, setGameId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!gameId) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run(gameId);
      setDone("Sent to EA.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "EA rejected this action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="form-hint" style={{ marginTop: 0 }}>{description}</p>
      <label className="form-field">
        <span className="form-label">Matchup</span>
        <select className="form-input" value={gameId} disabled={busy || !games.length} onChange={(event) => setGameId(event.target.value)}>
          <option value="">{games.length ? "Select a matchup" : "Loading matchups…"}</option>
          {games.map((game) => <option key={game.gameId} value={game.gameId}>{game.awayTeamName} at {game.homeTeamName}</option>)}
        </select>
      </label>
      {(loadError || error) && <p className="hub-transfer-status">{loadError ?? error}</p>}
      {done && <p className="form-hint" style={{ color: "var(--gold)" }}>{done}</p>}
      <Button variant="secondary" disabled={busy || !gameId} onClick={() => void submit()}>{icon} {busy ? "Sending…" : buttonLabel}</Button>
    </div>
  );
}

function AdvancePanel({ guildId, leagueId }: { guildId: string; leagueId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await recApi.eaAdminAdvance({ guildId, leagueId });
      setDone("Sent to EA.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "EA rejected this action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Submits the advance/sim response for the current week directly in the franchise, the same
        as tapping Advance in the Companion App.
      </p>
      {error && <p className="hub-transfer-status">{error}</p>}
      {done && <p className="form-hint" style={{ color: "var(--gold)" }}>{done}</p>}
      <Button variant="secondary" disabled={busy} onClick={() => void submit()}><PlayCircle size={14} /> {busy ? "Sending…" : "Advance League"}</Button>
    </div>
  );
}

function AutoPilotPanel({ guildId, leagueId }: { guildId: string; leagueId: string }) {
  const { teams, error: loadError } = useLinkedTeams(guildId);
  const [teamId, setTeamId] = useState("");
  const [weeks, setWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (!teamId) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await recApi.eaAdminToggleAutoPilot({ guildId, leagueId, teamId, weeks });
      setDone("Sent to EA.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "EA rejected this action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Toggles in-game AutoPilot for a team. EA expires it automatically after the given number
        of weeks — requests through the scheduling system default to 1 week; use this to grant a
        longer stretch.
      </p>
      <label className="form-field">
        <span className="form-label">Team</span>
        <select className="form-input" value={teamId} disabled={busy || !teams?.length} onChange={(event) => setTeamId(event.target.value)}>
          <option value="">{teams ? "Select a team" : "Loading teams…"}</option>
          {(teams ?? []).map((row) => <option key={row.id} value={row.team!.id}>{teamLabel(row)}</option>)}
        </select>
      </label>
      <label className="form-field">
        <span className="form-label">Weeks</span>
        <input className="form-input" type="number" min={1} max={17} value={weeks} disabled={busy}
          onChange={(event) => setWeeks(Math.max(1, Math.min(17, Number(event.target.value) || 1)))} style={{ maxWidth: "100px" }} />
      </label>
      {(loadError || error) && <p className="hub-transfer-status">{loadError ?? error}</p>}
      {done && <p className="form-hint" style={{ color: "var(--gold)" }}>{done}</p>}
      <Button variant="secondary" disabled={busy || !teamId} onClick={() => void submit()}><Bot size={14} /> {busy ? "Sending…" : "Toggle AutoPilot"}</Button>
    </div>
  );
}

export const EA_ADMIN_TOOLS: Array<{ key: string; title: string; render: (props: { guildId: string; leagueId: string }) => React.ReactNode }> = [
  { key: "advance", title: "Advance League", render: (p) => <AdvancePanel {...p} /> },
  {
    key: "clear-cap", title: "Clear Cap Penalties",
    render: (p) => <TeamActionPanel {...p} icon={<RotateCcw size={14} />} buttonLabel="Clear Cap Penalties"
      description="Clears salary-cap penalties for a team directly in the franchise."
      run={(teamId) => recApi.eaAdminClearCapPenalties({ ...p, teamId })} />,
  },
  {
    key: "boot", title: "Boot User",
    render: (p) => <TeamActionPanel {...p} icon={<UserX size={14} />} buttonLabel="Boot User"
      description="Removes a team's owner from the franchise in-game. Also fires automatically when a linked member leaves the Discord server."
      run={(teamId) => recApi.eaAdminBootUser({ ...p, teamId })} />,
  },
  {
    key: "add-admin", title: "Add Admin",
    render: (p) => <TeamActionPanel {...p} icon={<ShieldPlus size={14} />} buttonLabel="Add Admin"
      description="Grants a team's owner in-game commissioner/admin status. Also fires automatically when they're promoted to Co-Commish."
      run={(teamId) => recApi.eaAdminAddAdmin({ ...p, teamId })} />,
  },
  {
    key: "remove-admin", title: "Remove Admin",
    render: (p) => <TeamActionPanel {...p} icon={<ShieldOff size={14} />} buttonLabel="Remove Admin"
      description="Revokes a team's owner's in-game commissioner/admin status. Also fires automatically when they're demoted from Co-Commish."
      run={(teamId) => recApi.eaAdminRemoveAdmin({ ...p, teamId })} />,
  },
  {
    key: "force-home", title: "Force Home Win",
    render: (p) => <GameActionPanel {...p} icon={<Swords size={14} />} buttonLabel="Force Home Win"
      description="Forces the home team to win this matchup in-game. Also fires automatically whenever a Force Win is granted for the home side, from Discord or the site."
      run={(gameId) => recApi.eaAdminForceHomeWin({ ...p, gameId })} />,
  },
  {
    key: "force-away", title: "Force Away Win",
    render: (p) => <GameActionPanel {...p} icon={<Swords size={14} />} buttonLabel="Force Away Win"
      description="Forces the away team to win this matchup in-game. Also fires automatically whenever a Force Win is granted for the away side, from Discord or the site."
      run={(gameId) => recApi.eaAdminForceAwayWin({ ...p, gameId })} />,
  },
  {
    key: "clear-forced", title: "Clear Forced Result",
    render: (p) => <GameActionPanel {...p} icon={<Ban size={14} />} buttonLabel="Clear Forced Result"
      description="Clears any forced result for this matchup in-game. Also fires automatically whenever a Fair Sim is granted, from Discord or the site."
      run={(gameId) => recApi.eaAdminClearForcedResult({ ...p, gameId })} />,
  },
  { key: "autopilot", title: "Toggle AutoPilot", render: (p) => <AutoPilotPanel {...p} /> },
];
