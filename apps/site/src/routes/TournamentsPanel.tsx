import { useEffect, useMemo, useState } from "react";
import { TOURNAMENT_BRACKET_TYPES, TOURNAMENT_PAYOUT_SCOPES } from "@rec/shared";
import {
  siteApi,
  type SiteTournamentDetail,
  type SiteTournamentSummary,
} from "../lib/site-api.js";

const GAME_OPTIONS = [
  { value: "madden_27", label: "Madden 27" },
  { value: "cfb_27", label: "CFB 27" },
  { value: "madden_26", label: "Madden 26" },
] as const;

function payoutLine(row: SiteTournamentSummary): string {
  if (row.payoutScope === "winner") return `${row.winnerCoins.toLocaleString()} coins to the winner`;
  if (row.payoutScope === "final_two") {
    return `${row.winnerCoins.toLocaleString()} / ${row.runnerUpCoins.toLocaleString()} coins (winner / runner-up)`;
  }
  return `${row.winnerCoins.toLocaleString()} / ${row.runnerUpCoins.toLocaleString()} / ${row.semifinalistCoins.toLocaleString()} coins (winner / runner-up / each semi)`;
}

function statusLabel(status: string): string {
  if (status === "open") return "Open";
  if (status === "locked") return "In progress";
  if (status === "complete") return "Complete";
  if (status === "draft") return "Draft";
  return status;
}

function CreateTournamentForm({
  onCreated,
}: {
  onCreated: (tournamentId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [game, setGame] = useState<"madden_26" | "madden_27" | "cfb_27">("madden_27");
  const [bracketType, setBracketType] = useState(TOURNAMENT_BRACKET_TYPES[1]?.key ?? "single_elim_8");
  const [payoutScope, setPayoutScope] = useState<"winner" | "final_two" | "final_four">("winner");
  const [winnerCoins, setWinnerCoins] = useState("1000");
  const [runnerUpCoins, setRunnerUpCoins] = useState("400");
  const [semifinalistCoins, setSemifinalistCoins] = useState("150");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <select className="site-select" value={game} onChange={(event) => setGame(event.target.value as typeof game)}>
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
          <select
            className="site-select"
            value={payoutScope}
            onChange={(event) => setPayoutScope(event.target.value as typeof payoutScope)}
          >
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
      </div>
      <button className="site-btn site-btn-primary" type="submit" disabled={busy || title.trim().length < 2}>
        {busy ? "Creating…" : "Open registration"}
      </button>
    </form>
  );
}

function TournamentBracket({
  detail,
  isAdmin,
  busy,
  onReport,
}: {
  detail: SiteTournamentDetail;
  isAdmin: boolean;
  busy: boolean;
  onReport: (matchId: string, winnerUserId: string) => void;
}) {
  const grouped = useMemo(() => {
    const bySide = new Map<string, SiteTournamentDetail["matches"]>();
    for (const match of detail.matches) {
      const list = bySide.get(match.side) ?? [];
      list.push(match);
      bySide.set(match.side, list);
    }
    return ["winners", "losers", "grand_final"]
      .map((side) => ({ side, matches: bySide.get(side) ?? [] }))
      .filter((group) => group.matches.length);
  }, [detail.matches]);

  if (!detail.matches.length) {
    return <p className="site-muted">Bracket locks when the host starts the tournament.</p>;
  }

  return (
    <div className="site-tournament-bracket">
      {grouped.map((group) => (
        <section key={group.side}>
          <h4>
            {group.side === "winners" ? "Winners bracket" : group.side === "losers" ? "Losers bracket" : "Grand final"}
          </h4>
          <ol>
            {group.matches.map((match) => {
              const youId = detail.entrants.find((entrant) => entrant.isYou)?.userId;
              const canReport =
                match.status === "ready" &&
                Boolean(match.playerA && match.playerB) &&
                (isAdmin || youId === match.playerA?.userId || youId === match.playerB?.userId);
              return (
                <li key={match.id} className={match.status === "complete" || match.status === "bye" ? "is-done" : ""}>
                  <div>
                    <strong>{match.playerA?.displayName ?? "TBD"}</strong>
                    <span>vs</span>
                    <strong>{match.playerB?.displayName ?? "TBD"}</strong>
                  </div>
                  {match.winnerDisplayName ? (
                    <em>Winner: {match.winnerDisplayName}{match.status === "bye" ? " (bye)" : ""}</em>
                  ) : canReport ? (
                    <div className="site-tournament-report">
                      <button
                        type="button"
                        className="site-btn site-btn-ghost"
                        disabled={busy}
                        onClick={() => onReport(match.id, match.playerA!.userId)}
                      >
                        {match.playerA?.displayName} won
                      </button>
                      <button
                        type="button"
                        className="site-btn site-btn-ghost"
                        disabled={busy}
                        onClick={() => onReport(match.id, match.playerB!.userId)}
                      >
                        {match.playerB?.displayName} won
                      </button>
                    </div>
                  ) : (
                    <em>{match.status === "ready" ? "Waiting on a result" : "Waiting on players"}</em>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function TournamentsPanel() {
  const [list, setList] = useState<SiteTournamentSummary[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SiteTournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reloadList(selectId?: string | null) {
    const result = await siteApi.listTournaments();
    setList(result.tournaments);
    setIsAdmin(result.isAdmin);
    const nextId = selectId ?? selectedId ?? result.tournaments[0]?.id ?? null;
    setSelectedId(nextId);
    if (nextId) {
      const next = await siteApi.getTournament(nextId);
      setDetail({ tournament: next.tournament, entrants: next.entrants, matches: next.matches });
      setIsAdmin(next.isAdmin);
    } else {
      setDetail(null);
    }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    reloadList()
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load tournaments.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(run: () => Promise<unknown>, nextId?: string | null) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await reloadList(nextId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-page-card site-tournaments">
      <header className="site-section-heading">
        <h2>Tournaments</h2>
        <p>Site-hosted brackets with coin prizes. Join an open event, then play your matchups as the host advances the bracket.</p>
      </header>
      {error ? <p className="site-auth-error">{error}</p> : null}
      {isAdmin ? <CreateTournamentForm onCreated={(id) => void act(async () => undefined, id)} /> : null}
      {loading ? (
        <p className="site-muted">Loading tournaments…</p>
      ) : !list.length ? (
        <p className="site-muted">No tournaments are posted yet.</p>
      ) : (
        <div className="site-tournament-layout">
          <ul className="site-tournament-list">
            {list.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === selectedId ? "is-active" : ""}
                  onClick={() => void act(async () => undefined, row.id)}
                >
                  <strong>{row.title}</strong>
                  <span>
                    {statusLabel(row.status)} · {row.bracketLabel} · {row.entrantCount}/{row.bracketSize ?? "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {detail ? (
            <article className="site-tournament-detail">
              <h3>{detail.tournament.title}</h3>
              {detail.tournament.description ? <p>{detail.tournament.description}</p> : null}
              <p className="site-muted">
                {GAME_OPTIONS.find((option) => option.value === detail.tournament.game)?.label ?? detail.tournament.game}
                {" · "}
                {payoutLine(detail.tournament)}
              </p>
              <div className="site-profile-actions">
                {detail.tournament.status === "open" && !detail.tournament.joined ? (
                  <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.joinTournament(detail.tournament.id), detail.tournament.id)}>
                    Join
                  </button>
                ) : null}
                {detail.tournament.status === "open" && detail.tournament.joined ? (
                  <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.leaveTournament(detail.tournament.id), detail.tournament.id)}>
                    Leave
                  </button>
                ) : null}
                {isAdmin && detail.tournament.status === "open" ? (
                  <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.lockTournament(detail.tournament.id), detail.tournament.id)}>
                    Lock bracket
                  </button>
                ) : null}
                {isAdmin && (detail.tournament.status === "open" || detail.tournament.status === "locked") ? (
                  <button className="site-btn site-btn-danger" disabled={busy} onClick={() => void act(() => siteApi.cancelTournament(detail.tournament.id), null)}>
                    Cancel
                  </button>
                ) : null}
              </div>
              <h4>Entrants ({detail.entrants.length}{detail.tournament.bracketSize ? ` / ${detail.tournament.bracketSize}` : ""})</h4>
              {detail.entrants.length ? (
                <ul className="site-tournament-entrants">
                  {detail.entrants.map((entrant) => (
                    <li key={entrant.userId}>{entrant.seed ? `#${entrant.seed} ` : ""}{entrant.displayName}{entrant.isYou ? " (you)" : ""}</li>
                  ))}
                </ul>
              ) : (
                <p className="site-muted">Nobody has joined yet.</p>
              )}
              <TournamentBracket
                detail={detail}
                isAdmin={isAdmin}
                busy={busy}
                onReport={(matchId, winnerUserId) => void act(
                  () => siteApi.reportTournamentWinner({ tournamentId: detail.tournament.id, matchId, winnerUserId }),
                  detail.tournament.id,
                )}
              />
            </article>
          ) : null}
        </div>
      )}
    </div>
  );
}
