import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TOURNAMENT_HIGHLIGHT_COINS, TOURNAMENT_REQUIRED_RULES, americanFromDecimal } from "@rec/shared";
import {
  siteApi,
  type SiteTournamentBoxScore,
  type SiteTournamentDetail,
  type SiteTournamentHighlight,
  type SiteTournamentTeamOption,
  type SiteTournamentWager,
  type SiteTournamentWagerOptions,
} from "../lib/site-api.js";
import { gameLabel, payoutLine } from "./Tournaments.js";
import { TournamentRosterSection } from "./TournamentRosterSection.js";
import { TournamentLotteryPanel } from "./TournamentLotteryPanel.js";

async function readVideoDurationSeconds(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(Number(video.duration) || 0);
      video.onerror = () => reject(new Error(`Could not read duration for ${file.name}.`));
      video.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function TournamentBracket({
  detail,
  isAdmin,
  busy,
  recUserId,
  onReport,
  onSaveStream,
  onUploadHighlight,
  onPlaceWager,
  onAcceptWager,
  onToggleBetting,
  wagers,
}: {
  detail: SiteTournamentDetail;
  isAdmin: boolean;
  busy: boolean;
  recUserId: string | null;
  wagers: SiteTournamentWager[];
  onReport: (input: {
    matchId: string;
    winnerUserId: string;
    resultMethod: "final_screenshot" | "concede";
    file: File;
    playerAScore: number | null;
    playerBScore: number | null;
    boxScore: SiteTournamentBoxScore | null;
  }) => void;
  onSaveStream: (matchId: string, streamUrl: string) => void;
  onUploadHighlight: (matchId: string, file: File) => void;
  onPlaceWager: (input: {
    matchId: string;
    wagerKind: "house" | "peer";
    marketKey: string;
    pick: string;
    stake: number;
    isParlay?: boolean;
    legs?: Array<{ marketKey: string; pick: string }>;
  }) => void;
  onAcceptWager: (wagerId: string) => void;
  onToggleBetting: (matchId: string, open: boolean) => void;
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
    return <p className="site-muted">The bracket appears when registration closes and the host locks it.</p>;
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
              const youId = recUserId ?? detail.entrants.find((entrant) => entrant.isYou)?.userId;
              const inMatch = Boolean(youId && (youId === match.playerA?.userId || youId === match.playerB?.userId));
              const canReport =
                match.status === "ready" &&
                Boolean(match.playerA && match.playerB) &&
                (isAdmin || inMatch);
              const matchWagers = wagers.filter((wager) => wager.matchId === match.id);
              return (
                <li key={match.id} className={match.status === "complete" || match.status === "bye" ? "is-done" : ""}>
                  <div>
                    <strong>
                      {match.playerA?.displayName ?? "TBD"}
                      {match.playerA?.teamName ? ` · ${match.playerA.teamName}` : ""}
                      <small> Home · must stream</small>
                    </strong>
                    <span>vs</span>
                    <strong>
                      {match.playerB?.displayName ?? "TBD"}
                      {match.playerB?.teamName ? ` · ${match.playerB.teamName}` : ""}
                      <small> Away</small>
                    </strong>
                  </div>
                  {match.streamUrl ? (
                    <p className="site-muted">
                      Stream: <a href={match.streamUrl} target="_blank" rel="noreferrer">{match.streamUrl}</a>
                    </p>
                  ) : null}
                  {match.winnerDisplayName ? (
                    <em>
                      {match.status === "bye" ? "Bye: " : match.resultMethod === "concede" ? "Concede: " : "Final: "}
                      {match.winnerDisplayName} won
                      {match.playerAScore != null && match.playerBScore != null ? ` (${match.playerAScore}–${match.playerBScore})` : ""}
                    </em>
                  ) : null}
                  {(inMatch || isAdmin) && match.status !== "bye" ? (
                    <MatchUploads
                      match={match}
                      busy={busy}
                      canReport={canReport}
                      onReport={(input) => onReport({ matchId: match.id, ...input })}
                      onSaveStream={(url) => onSaveStream(match.id, url)}
                      onUploadHighlight={(file) => onUploadHighlight(match.id, file)}
                    />
                  ) : !match.winnerDisplayName ? (
                    <em>{match.status === "ready" ? "Waiting on a screenshot result" : "Waiting on players"}</em>
                  ) : null}
                  {match.playerA && match.playerB && match.status !== "bye" ? (
                    <MatchWagers
                      tournamentId={detail.tournament.id}
                      match={match}
                      wagers={matchWagers}
                      busy={busy}
                      isAdmin={isAdmin}
                      youId={youId ?? null}
                      onPlace={(input) => onPlaceWager({ matchId: match.id, ...input })}
                      onAccept={onAcceptWager}
                      onToggleBetting={(open) => onToggleBetting(match.id, open)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function MatchUploads({
  match,
  busy,
  canReport,
  onReport,
  onSaveStream,
  onUploadHighlight,
}: {
  match: SiteTournamentDetail["matches"][number];
  busy: boolean;
  canReport: boolean;
  onReport: (input: {
    winnerUserId: string;
    resultMethod: "final_screenshot" | "concede";
    file: File;
    playerAScore: number | null;
    playerBScore: number | null;
    boxScore: SiteTournamentBoxScore | null;
  }) => void;
  onSaveStream: (url: string) => void;
  onUploadHighlight: (file: File) => void;
}) {
  const [method, setMethod] = useState<"final_screenshot" | "concede">("final_screenshot");
  const [winnerUserId, setWinnerUserId] = useState(match.playerA?.userId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  const [streamUrl, setStreamUrl] = useState(match.streamUrl ?? "");
  const [homeYards, setHomeYards] = useState("");
  const [awayYards, setAwayYards] = useState("");
  const [homeRush, setHomeRush] = useState("");
  const [awayRush, setAwayRush] = useState("");
  const [homePass, setHomePass] = useState("");
  const [awayPass, setAwayPass] = useState("");
  const [homeTo, setHomeTo] = useState("");
  const [awayTo, setAwayTo] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  function num(value: string): number | null {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return (
    <div className="site-tournament-report">
      <p className="site-muted">
        Home must stream live. Screenshot the final score or concede screen. Saving the VOD is strongly recommended.
      </p>
      <label className="site-field">
        <span>Stream link (pre-game)</span>
        <input value={streamUrl} onChange={(event) => setStreamUrl(event.target.value)} placeholder="https://" />
      </label>
      <button type="button" className="site-btn site-btn-ghost" disabled={busy || !streamUrl.trim()} onClick={() => onSaveStream(streamUrl)}>
        Save stream
      </button>
      {canReport ? (
        <>
          <label className="site-field">
            <span>Result</span>
            <select className="site-select" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
              <option value="final_screenshot">Final score screenshot</option>
              <option value="concede">Player conceded</option>
            </select>
          </label>
          <label className="site-field">
            <span>{method === "concede" ? "Winner (other player conceded)" : "Winner"}</span>
            <select className="site-select" value={winnerUserId} onChange={(event) => setWinnerUserId(event.target.value)}>
              {match.playerA ? <option value={match.playerA.userId}>{match.playerA.displayName}</option> : null}
              {match.playerB ? <option value={match.playerB.userId}>{match.playerB.displayName}</option> : null}
            </select>
          </label>
          <label className="site-field">
            <span>Home score</span>
            <input type="number" min={0} value={homeScore} onChange={(event) => setHomeScore(event.target.value)} />
          </label>
          <label className="site-field">
            <span>Away score</span>
            <input type="number" min={0} value={awayScore} onChange={(event) => setAwayScore(event.target.value)} />
          </label>
          <label className="site-field">
            <span>Home yards / rush / pass / TO</span>
            <div className="site-tournament-create-grid site-account-stat-grid">
              <input type="number" min={0} placeholder="Yds" value={homeYards} onChange={(event) => setHomeYards(event.target.value)} />
              <input type="number" min={0} placeholder="Rush" value={homeRush} onChange={(event) => setHomeRush(event.target.value)} />
              <input type="number" min={0} placeholder="Pass" value={homePass} onChange={(event) => setHomePass(event.target.value)} />
              <input type="number" min={0} placeholder="TO" value={homeTo} onChange={(event) => setHomeTo(event.target.value)} />
            </div>
          </label>
          <label className="site-field">
            <span>Away yards / rush / pass / TO</span>
            <div className="site-tournament-create-grid site-account-stat-grid">
              <input type="number" min={0} placeholder="Yds" value={awayYards} onChange={(event) => setAwayYards(event.target.value)} />
              <input type="number" min={0} placeholder="Rush" value={awayRush} onChange={(event) => setAwayRush(event.target.value)} />
              <input type="number" min={0} placeholder="Pass" value={awayPass} onChange={(event) => setAwayPass(event.target.value)} />
              <input type="number" min={0} placeholder="TO" value={awayTo} onChange={(event) => setAwayTo(event.target.value)} />
            </div>
          </label>
          <label className="site-field">
            <span>Required screenshot</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <button
            type="button"
            className="site-btn site-btn-primary"
            disabled={busy || !file || !winnerUserId}
            onClick={() => {
              if (!file) return;
              const home = { totalYards: num(homeYards), rushYards: num(homeRush), passYards: num(homePass), turnovers: num(homeTo) };
              const away = { totalYards: num(awayYards), rushYards: num(awayRush), passYards: num(awayPass), turnovers: num(awayTo) };
              const hasBox = Object.values(home).some((value) => value != null) || Object.values(away).some((value) => value != null);
              onReport({
                winnerUserId,
                resultMethod: method,
                file,
                playerAScore: homeScore === "" ? null : Number(homeScore),
                playerBScore: awayScore === "" ? null : Number(awayScore),
                boxScore: hasBox ? { home, away } : null,
              });
            }}
          >
            Submit result
          </button>
        </>
      ) : null}
      <label className="site-field">
        <span>Highlight clip (up to 2 videos, ≤45s, {TOURNAMENT_HIGHLIGHT_COINS} coins if approved)</span>
        <input
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (!next) return;
            setNotice(`Uploading ${next.name}…`);
            onUploadHighlight(next);
          }}
        />
      </label>
      {notice ? <p className="site-muted">{notice}</p> : null}
    </div>
  );
}

function MatchWagers({
  tournamentId,
  match,
  wagers,
  busy,
  isAdmin,
  youId,
  onPlace,
  onAccept,
  onToggleBetting,
}: {
  tournamentId: string;
  match: SiteTournamentDetail["matches"][number];
  wagers: SiteTournamentWager[];
  busy: boolean;
  isAdmin: boolean;
  youId: string | null;
  onPlace: (input: {
    wagerKind: "house" | "peer";
    marketKey: string;
    pick: string;
    stake: number;
    isParlay?: boolean;
    legs?: Array<{ marketKey: string; pick: string }>;
  }) => void;
  onAccept: (wagerId: string) => void;
  onToggleBetting: (open: boolean) => void;
}) {
  const inMatch = youId === match.playerA?.userId || youId === match.playerB?.userId;
  const [options, setOptions] = useState<SiteTournamentWagerOptions | null>(null);
  const [mode, setMode] = useState<"house" | "parlay" | "peer">("house");
  const [market, setMarket] = useState("");
  const [pick, setPick] = useState("");
  const [stake, setStake] = useState("50");
  const [parlay, setParlay] = useState<Array<{ marketKey: string; pick: string; label: string }>>([]);

  useEffect(() => {
    let active = true;
    siteApi.getTournamentWagerOptions({ tournamentId, matchId: match.id })
      .then((next) => {
        if (!active) return;
        setOptions(next);
        const first = next.markets[0];
        setMarket(first?.market ?? "");
        setPick(first?.sides[0]?.pick ?? "");
      })
      .catch(() => {
        if (active) setOptions(null);
      });
    return () => {
      active = false;
    };
  }, [tournamentId, match.id]);

  if (inMatch) return <p className="site-muted">Players in this match cannot bet it.</p>;
  const selected = options?.markets.find((item) => item.market === market) ?? options?.markets[0] ?? null;
  const visibleMarkets = (options?.markets ?? []).filter((item) => (
    mode !== "parlay" || !["moneyline", "spread", "total_points"].includes(item.market)
  ));

  return (
    <div className="site-tournament-wagers">
      <h5>Sportsbook {match.bettingOpen ? "" : "· closed"}</h5>
      {isAdmin ? (
        <button type="button" className="site-btn site-btn-ghost" disabled={busy || match.status === "complete"} onClick={() => onToggleBetting(!match.bettingOpen)}>
          {match.bettingOpen ? "Close betting" : "Open betting"}
        </button>
      ) : null}
      {match.bettingOpen && match.status !== "complete" && options ? (
        <div className="site-tournament-report">
          <div className="site-tournament-wager-markets">
            <button type="button" className={mode === "house" ? "is-active" : ""} onClick={() => setMode("house")}>House</button>
            <button type="button" className={mode === "parlay" ? "is-active" : ""} onClick={() => setMode("parlay")}>3-pick parlay</button>
            <button type="button" className={mode === "peer" ? "is-active" : ""} onClick={() => setMode("peer")}>Peer</button>
          </div>
          {mode === "parlay" ? <p className="site-muted">Choose exactly three different stat-line Over/Under picks from this match.</p> : null}
          <div className="site-tournament-wager-markets">
            {visibleMarkets.map((item) => (
              <button
                key={item.market}
                type="button"
                className={item.market === market ? "is-active" : ""}
                onClick={() => {
                  setMarket(item.market);
                  setPick(item.sides[0]?.pick ?? "");
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {selected ? (
            <div className="site-tournament-wager-markets">
              {selected.sides.map((side) => (
                <button
                  key={side.pick}
                  type="button"
                  className={side.pick === pick ? "is-active" : ""}
                  onClick={() => setPick(side.pick)}
                >
                  {side.label} · {americanFromDecimal(side.odds)}
                </button>
              ))}
            </div>
          ) : null}
          {mode === "parlay" ? (
            <>
              <button
                type="button"
                className="site-btn site-btn-ghost"
                disabled={parlay.length >= 3 || !market || !pick}
                onClick={() => {
                  const label = `${selected?.label ?? market}: ${selected?.sides.find((side) => side.pick === pick)?.label ?? pick}`;
                  setParlay([...parlay.filter((leg) => leg.marketKey !== market), { marketKey: market, pick, label }].slice(0, 3));
                }}
              >
                Add selection · {parlay.length}/3
              </button>
              <ul className="site-tournament-entrants">
                {parlay.map((leg) => <li key={leg.marketKey}>{leg.label}</li>)}
              </ul>
            </>
          ) : null}
          <label className="site-field">
            <span>Stake</span>
            <input type="number" min={10} value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
          <button
            type="button"
            className="site-btn site-btn-primary"
            disabled={busy || !market || !pick || (mode === "parlay" && parlay.length !== 3)}
            onClick={() => {
              if (mode === "parlay") {
                onPlace({ wagerKind: "house", marketKey: "parlay", pick: "parlay", stake: Number(stake), isParlay: true, legs: parlay });
                return;
              }
              onPlace({ wagerKind: mode === "peer" ? "peer" : "house", marketKey: market, pick, stake: Number(stake) });
            }}
          >
            {mode === "peer" ? "Post peer wager" : mode === "parlay" ? "Place 3-pick parlay" : "Place bet"}
          </button>
        </div>
      ) : null}
      <ul className="site-tournament-entrants">
        {wagers.map((wager) => (
          <li key={wager.id}>
            {wager.isParlay ? "Parlay" : wager.wagerKind === "peer" ? "Peer" : "House"}
            {" · "}{wager.userDisplayName} on {wager.pickDisplayName}
            {" · "}{wager.stake} coins · {wager.status}
            {wager.status === "open" && wager.wagerKind === "peer" && wager.userId !== youId ? (
              <button type="button" className="site-btn site-btn-ghost" disabled={busy} onClick={() => onAccept(wager.id)}>Accept opposite side</button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TournamentDetailPage() {
  const { tournamentId = "" } = useParams();
  const [tab, setTab] = useState<"bracket" | "highlights">("bracket");
  const [detail, setDetail] = useState<SiteTournamentDetail | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [knownGamerTag, setKnownGamerTag] = useState<string | null>(null);
  const [teams, setTeams] = useState<SiteTournamentTeamOption[]>([]);
  const [teamQuery, setTeamQuery] = useState("");
  const [teamAbbr, setTeamAbbr] = useState("");
  const [gamerTag, setGamerTag] = useState("");
  const [highlights, setHighlights] = useState<SiteTournamentHighlight[]>([]);
  const [wagers, setWagers] = useState<SiteTournamentWager[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const next = await siteApi.getTournament(tournamentId);
    setDetail({ tournament: next.tournament, entrants: next.entrants, matches: next.matches, claimedTeams: next.claimedTeams });
    setIsAdmin(next.isAdmin);
    setKnownGamerTag(next.knownGamerTag);
    setTeams(next.teams);
    if (!gamerTag && next.knownGamerTag) setGamerTag(next.knownGamerTag);
    const [clips, bets] = await Promise.all([
      siteApi.listTournamentHighlights(tournamentId),
      siteApi.listTournamentWagers(tournamentId),
    ]);
    setHighlights(clips.highlights);
    setWagers(bets.wagers);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    reload()
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load this tournament.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const claimedTeams = new Set(detail?.claimedTeams ?? []);
  const filteredTeams = teams.filter((team) => {
    if (detail?.tournament.teamSelectionMode === "claim_pool" && claimedTeams.has(team.abbr)) return false;
    const query = teamQuery.trim().toLowerCase();
    if (!query) return true;
    return `${team.name} ${team.abbr} ${team.conference}`.toLowerCase().includes(query);
  });

  if (loading) return <p className="site-muted">Loading tournament…</p>;
  if (!detail) {
    return (
      <div className="site-page-card">
        {error ? <p className="site-auth-error">{error}</p> : <p className="site-muted">Tournament not found.</p>}
        <Link to="/tournaments">Back to tournaments</Link>
      </div>
    );
  }

  const row = detail.tournament;
  const needsGamerTag = !knownGamerTag;
  const you = detail.entrants.find((entrant) => entrant.isYou) ?? null;
  const approved = detail.entrants.filter((entrant) => entrant.entryStatus === "approved");
  const pending = detail.entrants.filter((entrant) => entrant.entryStatus === "pending");
  const visibleHighlights = highlights.filter((item) => item.status === "approved" || item.isYou || isAdmin);

  return (
    <div className="site-page-card site-tournament-detail">
      <p><Link to="/tournaments">← Tournaments</Link></p>
      <header className="site-section-heading">
        <h2>{row.title}</h2>
        <p>{row.countdown.label}</p>
      </header>
      {error ? <p className="site-auth-error">{error}</p> : null}
      {row.description ? <p>{row.description}</p> : null}
      {row.championDisplayName ? <p>Champion: {row.championDisplayName}</p> : null}
      <p className="site-muted">
        {gameLabel(row.game)} · {row.bracketLabel} · {row.approvedCount}/{row.bracketSize ?? "—"} approved
        {row.pendingCount ? ` · ${row.pendingCount} pending` : ""} · {payoutLine(row)}
      </p>
      <p className="site-muted">{row.rulesSummary}</p>
      <aside className="site-tournament-required">
        <strong>Required</strong>
        <ul>
          {TOURNAMENT_REQUIRED_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </aside>
      {you?.entryStatus === "pending" ? <p>Your registration is pending admin approval.</p> : null}
      {you?.entryStatus === "approved" ? <p>You’re in the field{you.teamName ? ` as ${you.teamName}` : ""}.</p> : null}
      <div className="site-profile-actions">
        {row.registrationOpen && you?.entryStatus === "pending" ? (
          <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.leaveTournament(row.id))}>
            Leave
          </button>
        ) : null}
        {isAdmin ? (
          <>
            <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.setTournamentRegistrationOpen(row.id, !row.registrationOpen))}>
              {row.registrationOpen ? "Close registration" : "Reopen registration"}
            </button>
            <button className="site-btn site-btn-ghost" disabled={busy} onClick={() => void act(() => siteApi.setTournamentEventOpen(row.id, row.eventPaused))}>
              {row.eventPaused ? "Reopen tournament" : "Close tournament"}
            </button>
          </>
        ) : null}
        {isAdmin && row.status === "open" ? (
          <button className="site-btn site-btn-primary" disabled={busy} onClick={() => void act(() => siteApi.lockTournament(row.id))}>
            Lock bracket
          </button>
        ) : null}
        {isAdmin && (row.status === "open" || row.status === "locked") ? (
          <button className="site-btn site-btn-danger" disabled={busy} onClick={() => void act(() => siteApi.cancelTournament(row.id))}>
            Cancel
          </button>
        ) : null}
      </div>
      {row.registrationOpen && !row.joined ? (
        <form
          className="site-tournament-register"
          onSubmit={(event) => {
            event.preventDefault();
            void act(() => siteApi.joinTournament({
              tournamentId: row.id,
              teamAbbr: row.claimOrderMode === "lottery" ? null : teamAbbr,
              gamerTag,
            }));
          }}
        >
          <h3>Register</h3>
          <p className="site-muted">
            {row.claimOrderMode === "lottery"
              ? "Register now and you'll pick (or be drawn) a team once the lottery draft runs."
              : row.teamSelectionMode === "claim_pool"
                ? "Claim one of the remaining teams — once picked, it's off the board for everyone else."
                : row.game === "cfb_27"
                  ? "Pick the college team you will use for the entire tournament. Duplicates are allowed."
                  : "Pick 1 of the 32 NFL teams you will use for the entire tournament. Duplicates are allowed."}
          </p>
          {row.claimOrderMode !== "lottery" ? (
            <>
              {teams.length > 40 ? (
                <label className="site-field">
                  <span>Filter teams</span>
                  <input value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="Search" />
                </label>
              ) : null}
              <label className="site-field">
                <span>Your team</span>
                <select className="site-select" value={teamAbbr} onChange={(event) => setTeamAbbr(event.target.value)} required>
                  <option value="">Select a team…</option>
                  {filteredTeams.map((team) => (
                    <option key={team.abbr} value={team.abbr}>
                      {team.name} ({team.abbr})
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <label className="site-field">
            <span>{needsGamerTag ? "Gamertag / PSN / EA name" : "Confirm gamertag / PSN / EA name"}</span>
            <input
              value={gamerTag}
              onChange={(event) => setGamerTag(event.target.value)}
              required
              minLength={2}
              maxLength={32}
              placeholder={needsGamerTag ? "Required — we don’t have one on file" : "From your league import"}
            />
          </label>
          <button
            className="site-btn site-btn-primary"
            type="submit"
            disabled={busy || (row.claimOrderMode !== "lottery" && !teamAbbr) || gamerTag.trim().length < 2}
          >
            {busy ? "Joining…" : "Request to join"}
          </button>
        </form>
      ) : null}
      {row.claimOrderMode === "lottery" ? (
        <TournamentLotteryPanel tournamentId={row.id} isAdmin={isAdmin} currentUserId={you?.userId ?? null} onChanged={() => void reload()} />
      ) : null}
      {row.rosterLibraryId ? <TournamentRosterSection libraryId={row.rosterLibraryId} /> : null}
      <div className="site-account-tabs" role="tablist" aria-label="Tournament sections">
        <button type="button" className="site-account-tab-arrow" aria-hidden="true" tabIndex={-1}>‹</button>
        <div className="site-account-tab-track">
          <button type="button" className={tab === "bracket" ? "is-active" : ""} onClick={() => setTab("bracket")}>Bracket</button>
          <button type="button" className={tab === "highlights" ? "is-active" : ""} onClick={() => setTab("highlights")}>Highlights</button>
        </div>
        <button type="button" className="site-account-tab-arrow" aria-hidden="true" tabIndex={-1}>›</button>
      </div>
      {tab === "highlights" ? (
        <section>
          <h4>Tournament highlights</h4>
          {visibleHighlights.length ? (
            <ul className="site-tournament-highlights">
              {visibleHighlights.map((item) => (
                <li key={item.id} className="site-tournament-highlight-card">
                  <strong>{item.label}</strong>
                  <span className="site-muted">{item.displayName} · {item.status}{item.mediaStatus !== "ready" ? ` · ${item.mediaStatus}` : ""}</span>
                  {item.iframeUrl && (item.status === "approved" || item.isYou || isAdmin) && item.mediaStatus === "ready" ? (
                    <iframe title={item.label} src={item.iframeUrl} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="site-muted">No highlights yet. Players can upload up to two 45-second clips per match.</p>
          )}
        </section>
      ) : (
        <>
          <h4>Entrants ({approved.length}{row.bracketSize ? ` / ${row.bracketSize}` : ""})</h4>
          {approved.length || pending.length ? (
            <ul className="site-tournament-entrants">
              {approved.map((entrant) => (
                <li key={entrant.userId}>
                  {entrant.seed ? `#${entrant.seed} ` : ""}
                  {entrant.displayName}
                  {entrant.teamName ? ` · ${entrant.teamName}` : ""}
                  {entrant.isYou ? " (you)" : ""}
                </li>
              ))}
              {pending.map((entrant) => (
                <li key={entrant.userId} className="is-pending">
                  Pending: {entrant.displayName}
                  {entrant.teamName ? ` · ${entrant.teamName}` : ""}
                  {entrant.isYou ? " (you)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="site-muted">Nobody has joined yet.</p>
          )}
          <TournamentBracket
            detail={detail}
            isAdmin={isAdmin}
            busy={busy}
            recUserId={you?.userId ?? null}
            wagers={wagers}
            onSaveStream={(matchId, streamUrl) => void act(() => siteApi.setTournamentMatchStream({ tournamentId: row.id, matchId, streamUrl }))}
            onUploadHighlight={(matchId, file) => void act(async () => {
              const duration = await readVideoDurationSeconds(file);
              if (duration > 45) throw new Error(`${file.name} is ${Math.ceil(duration)}s. Crop to 45 seconds or less and try again.`);
              const direct = await siteApi.createTournamentHighlightDirectUpload({ tournamentId: row.id, matchId, fileName: file.name });
              const form = new FormData();
              form.append("file", file);
              const uploaded = await fetch(direct.uploadURL, { method: "POST", body: form });
              if (!uploaded.ok) throw new Error(`Cloudflare upload failed for ${file.name} (${uploaded.status}).`);
              await siteApi.markTournamentHighlightUploadReceived({ tournamentId: row.id, highlightId: direct.highlightId });
              for (let attempt = 0; attempt < 20; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
                const status = await siteApi.getTournamentHighlightUploadStatus({ tournamentId: row.id, highlightId: direct.highlightId });
                if (status.mediaStatus === "ready") return;
                if (status.mediaStatus === "failed") throw new Error(status.failureReason ?? `${file.name} was rejected. Crop to 45 seconds or less and try again.`);
              }
            })}
            onPlaceWager={(input) => void act(() => siteApi.placeTournamentWager({ tournamentId: row.id, ...input }))}
            onAcceptWager={(wagerId) => void act(() => siteApi.acceptTournamentWager(wagerId))}
            onToggleBetting={(matchId, open) => void act(() => siteApi.setTournamentMatchBetting({ tournamentId: row.id, matchId, open }))}
            onReport={(input) => void act(async () => {
              const uploaded = await siteApi.uploadTournamentScreenshot(input.file);
              const match = detail.matches.find((item) => item.id === input.matchId);
              await siteApi.reportTournamentWinner({
                tournamentId: row.id,
                matchId: input.matchId,
                winnerUserId: input.winnerUserId,
                resultMethod: input.resultMethod,
                screenshotUrl: uploaded.url,
                playerAScore: input.playerAScore,
                playerBScore: input.playerBScore,
                boxScore: input.boxScore,
                concededByUserId: input.resultMethod === "concede"
                  ? (match?.playerA?.userId === input.winnerUserId ? match?.playerB?.userId : match?.playerA?.userId) ?? null
                  : null,
              });
            })}
          />
        </>
      )}
    </div>
  );
}
