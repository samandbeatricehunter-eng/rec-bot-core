import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  TOURNAMENT_BRACKET_TYPES,
  TOURNAMENT_INJURY_OPTIONS,
  TOURNAMENT_PAYOUT_SCOPES,
  TOURNAMENT_PLAYSTYLES,
  TOURNAMENT_REQUIRED_RULES,
  TOURNAMENT_TIMEZONES,
  defaultTournamentRules,
  tournamentDifficultyOptions,
  type TournamentRules,
} from "@rec/shared";
import {
  siteApi,
  type SiteTournamentSummary,
} from "../lib/site-api.js";

const GAME_OPTIONS = [
  { value: "madden_27", label: "Madden 27" },
  { value: "cfb_27", label: "CFB 27" },
  { value: "madden_26", label: "Madden 26" },
] as const;

export function gameLabel(game: string): string {
  return GAME_OPTIONS.find((option) => option.value === game)?.label ?? game;
}

export function payoutLine(row: SiteTournamentSummary): string {
  if (row.payoutScope === "winner") return `${row.winnerCoins.toLocaleString()} coins to the winner`;
  if (row.payoutScope === "final_two") {
    return `${row.winnerCoins.toLocaleString()} / ${row.runnerUpCoins.toLocaleString()} coins (winner / runner-up)`;
  }
  return `${row.winnerCoins.toLocaleString()} / ${row.runnerUpCoins.toLocaleString()} / ${row.semifinalistCoins.toLocaleString()} coins (winner / runner-up / each semi)`;
}

export function statusLabel(status: string): string {
  if (status === "open") return "Registration";
  if (status === "locked") return "In progress";
  if (status === "complete") return "Complete";
  if (status === "draft") return "Draft";
  return status;
}

function tzOffsetMs(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return asUtc - utcMs;
}

function isoFromZonedLocal(value: string, timeZone: string) {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(utcGuess - tzOffsetMs(utcGuess, timeZone)).toISOString();
}

function localInputInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

function defaultWindow(timeZone: string) {
  const opens = new Date();
  const closes = new Date(opens.getTime() + 48 * 60 * 60 * 1000);
  const kickoff = new Date(opens.getTime() + 72 * 60 * 60 * 1000);
  return {
    opens: localInputInZone(opens, timeZone),
    closes: localInputInZone(closes, timeZone),
    kickoff: localInputInZone(kickoff, timeZone),
  };
}

export function CreateTournamentForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [timezone, setTimezone] = useState<string>("America/Chicago");
  const windowDefaults = useMemo(() => defaultWindow(timezone), [timezone]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [game, setGame] = useState<"madden_26" | "madden_27" | "cfb_27">("madden_27");
  const [bracketType, setBracketType] = useState(TOURNAMENT_BRACKET_TYPES[1]?.key ?? "single_elim_8");
  const [payoutScope, setPayoutScope] = useState<"winner" | "final_two" | "final_four">("winner");
  const [winnerCoins, setWinnerCoins] = useState("1000");
  const [runnerUpCoins, setRunnerUpCoins] = useState("400");
  const [semifinalistCoins, setSemifinalistCoins] = useState("150");
  const [opensAt, setOpensAt] = useState(windowDefaults.opens);
  const [closesAt, setClosesAt] = useState(windowDefaults.closes);
  const [kickoffAt, setKickoffAt] = useState(windowDefaults.kickoff);
  const [rules, setRules] = useState<TournamentRules>(defaultTournamentRules("madden_27"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeGame(next: typeof game) {
    setGame(next);
    setRules(defaultTournamentRules(next));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await siteApi.createTournament({
        title,
        description: description.trim() || null,
        game,
        bracketType,
        payoutScope,
        winnerCoins: Number(winnerCoins) || 0,
        runnerUpCoins: Number(runnerUpCoins) || 0,
        semifinalistCoins: Number(semifinalistCoins) || 0,
        registrationOpensAt: isoFromZonedLocal(opensAt, timezone),
        registrationClosesAt: isoFromZonedLocal(closesAt, timezone),
        kickoffAt: isoFromZonedLocal(kickoffAt, timezone),
        timezone,
        rules,
      });
      setTitle("");
      setDescription("");
      onCreated(result.tournament.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the tournament.");
    } finally {
      setBusy(false);
    }
  }

  const difficulties = tournamentDifficultyOptions(game);

  return (
    <form
      className="site-tournament-create"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>Host a tournament</h3>
      {error ? <p className="site-auth-error">{error}</p> : null}
      <label className="site-field">
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} />
      </label>
      <label className="site-field">
        <span>Description</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="site-account-stat-grid site-tournament-create-grid">
        <label className="site-field">
          <span>Game</span>
          <select className="site-select" value={game} onChange={(event) => changeGame(event.target.value as typeof game)}>
            {GAME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="site-field">
          <span>Bracket</span>
          <select className="site-select" value={bracketType} onChange={(event) => setBracketType(event.target.value)}>
            {TOURNAMENT_BRACKET_TYPES.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </label>
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
          <span>Kickoff</span>
          <input type="datetime-local" value={kickoffAt} onChange={(event) => setKickoffAt(event.target.value)} required />
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
        {game === "cfb_27" ? (
          <label className="site-field">
            <span>Wear & tear</span>
            <select className="site-select" value={rules.wearAndTearEnabled ? "on" : "off"} onChange={(event) => setRules((current) => ({ ...current, wearAndTearEnabled: event.target.value === "on" }))}>
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </label>
        ) : null}
      </div>
      <ul className="site-tournament-rules-list">
        {TOURNAMENT_REQUIRED_RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      <button className="site-btn site-btn-primary" type="submit" disabled={busy || title.trim().length < 2}>
        {busy ? "Creating…" : "Open registration"}
      </button>
    </form>
  );
}

export function TournamentsPage() {
  const [tab, setTab] = useState<"open" | "past">("open");
  const [list, setList] = useState<SiteTournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    siteApi.listTournaments()
      .then((result) => {
        if (!active) return;
        setList(result.tournaments);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load tournaments.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const open = list.filter((row) => row.status === "open" || row.status === "locked");
  const past = list.filter((row) => row.status === "complete" || row.status === "cancelled");
  const shown = tab === "open" ? open : past;

  return (
    <div className="site-page-card site-tournaments">
      <header className="site-section-heading">
        <h2>Tournaments</h2>
        <p>Open brackets you can join or watch. Past events keep their brackets, rules, and highlights.</p>
      </header>
      {error ? <p className="site-auth-error">{error}</p> : null}
      <div className="site-account-tabs" role="tablist" aria-label="Tournament lists">
        <button type="button" className="site-account-tab-arrow" aria-hidden="true" tabIndex={-1}>‹</button>
        <div className="site-account-tab-track">
          <button type="button" className={tab === "open" ? "is-active" : ""} onClick={() => setTab("open")}>Open</button>
          <button type="button" className={tab === "past" ? "is-active" : ""} onClick={() => setTab("past")}>Past</button>
        </div>
        <button type="button" className="site-account-tab-arrow" aria-hidden="true" tabIndex={-1}>›</button>
      </div>
      {loading ? (
        <p className="site-muted">Loading tournaments…</p>
      ) : !shown.length ? (
        <p className="site-muted">{tab === "open" ? "No open tournaments right now." : "No past tournaments yet."}</p>
      ) : (
        <section className="site-tournament-card-grid">
          {shown.map((row) => (
            <Link key={row.id} className="site-tournament-card" to={`/tournaments/${row.id}`}>
              <strong>{row.title}</strong>
              <span>{gameLabel(row.game)} · {statusLabel(row.status)} · {row.bracketLabel}</span>
              <span>{row.entrantCount}/{row.bracketSize ?? "—"} registered · {payoutLine(row)}</span>
              {tab === "past" && row.championDisplayName ? <span>Champion: {row.championDisplayName}</span> : null}
              {tab === "past" && row.completedAt ? (
                <span>Completed {new Date(row.completedAt).toLocaleDateString()}</span>
              ) : null}
              {tab === "past" ? <span>{row.rulesSummary}</span> : null}
              <span className="site-tournament-card-count">{row.countdown.label}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
