import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useHub } from "../lib/hub-context.js";
import {
  siteApi,
  type SiteLeagueSearchFilters,
  type SiteLeagueSearchHit,
  type SiteLeagueSummary,
} from "../lib/site-api.js";

type Tab = "search" | "mine";

const GAME_OPTIONS = [
  { value: "", label: "All games" },
  { value: "madden_26", label: "Madden 26" },
  { value: "madden_27", label: "Madden 27" },
  { value: "cfb_27", label: "CFB 27" },
];

const DIFFICULTY_OPTIONS = [
  { value: "", label: "Any difficulty" },
  { value: "all_madden", label: "All-Madden / Heisman" },
  { value: "all_pro", label: "All-Pro" },
  { value: "pro", label: "Pro" },
  { value: "rookie", label: "Rookie" },
  { value: "custom", label: "Custom" },
];

const STREAM_OPTIONS = [
  { value: "", label: "Any streaming rule" },
  { value: "required", label: "Streaming required" },
  { value: "recommended", label: "Streaming recommended" },
  { value: "disabled", label: "Streaming disabled" },
];

const TRADE_OPTIONS = [
  { value: "", label: "Any trade rules" },
  { value: "competition_committee_review", label: "Committee review" },
  { value: "commissioner_approval", label: "Commissioner approval" },
  { value: "veto", label: "League veto" },
  { value: "open", label: "Open trading" },
];

const SORT_OPTIONS = [
  { value: "name_asc", label: "Name A-Z" },
  { value: "name_desc", label: "Name Z-A" },
  { value: "open_teams", label: "Most open teams" },
  { value: "newest", label: "Newest" },
];

function roleLabel(league: SiteLeagueSummary) {
  const role = league.commissionerRole ?? (league.isCommissioner ? "co" : "member");
  if (role === "head") return "Head Commish";
  if (role === "co") return "Co-Commish";
  return "Member";
}

function labelize(value: string | null | undefined) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}

function boolTri(value: "" | "true" | "false"): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function LeaguesPage() {
  const hub = useHub();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") === "mine" ? "mine" : "search") as Tab;

  const [q, setQ] = useState(params.get("q") ?? "");
  const [game, setGame] = useState(params.get("game") ?? "");
  const [difficulty, setDifficulty] = useState(params.get("difficulty") ?? "");
  const [streamingRequirement, setStreamingRequirement] = useState(params.get("stream") ?? "");
  const [tradeApprovalPolicy, setTradeApprovalPolicy] = useState(params.get("trade") ?? "");
  const [coinEconomy, setCoinEconomy] = useState<"" | "true" | "false">(
    (params.get("economy") as "" | "true" | "false") || "",
  );
  const [acceleratedClock, setAcceleratedClock] = useState<"" | "true" | "false">(
    (params.get("clock") as "" | "true" | "false") || "",
  );
  const [offPlayCall, setOffPlayCall] = useState<"" | "true" | "false">(
    (params.get("offLimits") as "" | "true" | "false") || "",
  );
  const [defPlayCall, setDefPlayCall] = useState<"" | "true" | "false">(
    (params.get("defLimits") as "" | "true" | "false") || "",
  );
  const [sort, setSort] = useState(params.get("sort") ?? "name_asc");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [results, setResults] = useState<SiteLeagueSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo<SiteLeagueSearchFilters>(
    () => ({
      q: q.trim() || undefined,
      game: game || undefined,
      difficulty: difficulty || undefined,
      streamingRequirement: streamingRequirement || undefined,
      tradeApprovalPolicy: tradeApprovalPolicy || undefined,
      coinEconomyEnabled: boolTri(coinEconomy),
      acceleratedClockEnabled: boolTri(acceleratedClock),
      offensivePlayCallLimitsEnabled: boolTri(offPlayCall),
      defensivePlayCallLimitsEnabled: boolTri(defPlayCall),
      sort: (SORT_OPTIONS.some((o) => o.value === sort)
        ? sort
        : "name_asc") as SiteLeagueSearchFilters["sort"],
      limit: 60,
    }),
    [
      q,
      game,
      difficulty,
      streamingRequirement,
      tradeApprovalPolicy,
      coinEconomy,
      acceleratedClock,
      offPlayCall,
      defPlayCall,
      sort,
    ],
  );

  useEffect(() => {
    if (tab !== "search") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      siteApi
        .searchLeagues(filters)
        .then((res) => {
          if (cancelled) return;
          setResults(res.leagues);
        })
        .catch((err) => {
          if (cancelled) return;
          setResults([]);
          setError(err instanceof Error ? err.message : "Could not search leagues.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tab, filters]);

  function setTab(next: Tab) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  }

  function openLeague(leagueId: string) {
    hub.selectLeague(leagueId);
    navigate(`/l/${leagueId}/buzz`);
  }

  return (
    <div className="site-page-card site-leagues-page">
      <div className="site-leagues-header">
        <div>
          <h1>Leagues</h1>
          <p>Find open leagues by settings, or jump into one you already play.</p>
        </div>
        <div className="site-leagues-tabs" role="tablist" aria-label="League views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "search"}
            className={["site-btn", tab === "search" ? "site-btn-primary" : "site-btn-ghost"].join(" ")}
            onClick={() => setTab("search")}
          >
            League search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mine"}
            className={["site-btn", tab === "mine" ? "site-btn-primary" : "site-btn-ghost"].join(" ")}
            onClick={() => setTab("mine")}
          >
            My Leagues
          </button>
        </div>
      </div>

      {tab === "mine" ? (
        <section className="site-leagues-panel">
          {hub.leaguesLoading ? (
            <p className="site-muted">Loading your leagues...</p>
          ) : hub.leaguesError ? (
            <p className="site-auth-error">{hub.leaguesError}</p>
          ) : hub.leagues.length === 0 ? (
            <p className="site-muted">
              No leagues linked yet. Search for one, or finish Account linking.
            </p>
          ) : (
            <div className="site-league-list">
              {hub.leagues.map((league) => (
                <button
                  key={league.id}
                  type="button"
                  className="site-league-card"
                  onClick={() => openLeague(league.id)}
                >
                  <strong>{league.name}</strong>
                  <span>
                    {league.gameLabel}
                    {league.teamName ? ` · ${league.teamName}` : ""}
                    {` · ${roleLabel(league)}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="site-leagues-panel">
          <div className="site-leagues-search-row">
            <label className="site-field site-leagues-search-field">
              <span>Search</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="League name, keyword, commissioner username or Discord"
              />
            </label>
            <label className="site-field">
              <span>Sort</span>
              <select className="site-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="site-btn site-btn-ghost site-leagues-filter-toggle"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {filtersOpen ? "Hide filters" : "Filters"}
            </button>
          </div>

          {filtersOpen ? (
            <div className="site-leagues-filters">
              <label className="site-field">
                <span>Game</span>
                <select className="site-select" value={game} onChange={(e) => setGame(e.target.value)}>
                  {GAME_OPTIONS.map((opt) => (
                    <option key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Difficulty</span>
                <select
                  className="site-select"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                >
                  {DIFFICULTY_OPTIONS.map((opt) => (
                    <option key={opt.value || "any-diff"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Streaming</span>
                <select
                  className="site-select"
                  value={streamingRequirement}
                  onChange={(e) => setStreamingRequirement(e.target.value)}
                >
                  {STREAM_OPTIONS.map((opt) => (
                    <option key={opt.value || "any-stream"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Trade rules</span>
                <select
                  className="site-select"
                  value={tradeApprovalPolicy}
                  onChange={(e) => setTradeApprovalPolicy(e.target.value)}
                >
                  {TRADE_OPTIONS.map((opt) => (
                    <option key={opt.value || "any-trade"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="site-field">
                <span>Coin economy</span>
                <select
                  className="site-select"
                  value={coinEconomy}
                  onChange={(e) => setCoinEconomy(e.target.value as "" | "true" | "false")}
                >
                  <option value="">Any</option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </label>
              <label className="site-field">
                <span>Accelerated clock</span>
                <select
                  className="site-select"
                  value={acceleratedClock}
                  onChange={(e) => setAcceleratedClock(e.target.value as "" | "true" | "false")}
                >
                  <option value="">Any</option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </label>
              <label className="site-field">
                <span>Offensive play-call limits</span>
                <select
                  className="site-select"
                  value={offPlayCall}
                  onChange={(e) => setOffPlayCall(e.target.value as "" | "true" | "false")}
                >
                  <option value="">Any</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
              <label className="site-field">
                <span>Defensive play-call limits</span>
                <select
                  className="site-select"
                  value={defPlayCall}
                  onChange={(e) => setDefPlayCall(e.target.value as "" | "true" | "false")}
                >
                  <option value="">Any</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
            </div>
          ) : null}

          {error ? <p className="site-auth-error">{error}</p> : null}
          {loading ? <p className="site-muted">Searching leagues...</p> : null}
          {!loading && !error && results.length === 0 ? (
            <p className="site-muted">No leagues match those filters.</p>
          ) : null}

          <div className="site-league-search-list">
            {results.map((league) => (
              <article key={league.id} className="site-league-search-card">
                <div className="site-league-search-card-main">
                  <h2>{league.name}</h2>
                  <p>
                    {league.gameLabel} · Season {league.seasonNumber} · {labelize(league.seasonStage)}
                    {league.isMember ? " · You're in" : ""}
                  </p>
                  <p className="site-muted">
                    Commish: {league.commissionerUsername ?? "-"}
                    {league.commissionerDiscordName
                      ? ` · Discord ${league.commissionerDiscordName}`
                      : ""}
                  </p>
                  <ul className="site-league-search-meta">
                    <li>{league.openTeamCount} open teams</li>
                    <li>{league.memberCount} members</li>
                    <li>Difficulty {labelize(league.difficulty)}</li>
                    <li>Stream {labelize(league.streamingRequirement)}</li>
                    <li>Economy {league.coinEconomyEnabled ? "on" : "off"}</li>
                    <li>
                      Accel clock{" "}
                      {league.acceleratedClockEnabled
                        ? `on${
                            league.acceleratedClockMinimumSeconds != null
                              ? ` (${league.acceleratedClockMinimumSeconds}s)`
                              : ""
                          }`
                        : "off"}
                    </li>
                    <li>Trades {labelize(league.tradeApprovalPolicy)}</li>
                    <li>
                      Off limits{" "}
                      {league.offensivePlayCallLimitsEnabled
                        ? `${league.offensivePlayCallLimit ?? "-"} / cd ${
                            league.offensivePlayCallCooldown ?? "-"
                          }`
                        : "off"}
                    </li>
                    <li>
                      Def limits{" "}
                      {league.defensivePlayCallLimitsEnabled
                        ? `${league.defensivePlayCallLimit ?? "-"} / cd ${
                            league.defensivePlayCallCooldown ?? "-"
                          }`
                        : "off"}
                    </li>
                  </ul>
                </div>
                <button
                  type="button"
                  className="site-btn site-btn-primary"
                  onClick={() => openLeague(league.id)}
                  disabled={!league.isMember}
                  title={
                    league.isMember
                      ? "Open hub"
                      : "Join from Discord or request a team first"
                  }
                >
                  {league.isMember ? "Open" : "Members only"}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
