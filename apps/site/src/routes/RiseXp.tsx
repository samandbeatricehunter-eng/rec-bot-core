import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { MADDEN_ATTRIBUTE_DEFINITIONS } from "@rec/shared";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type ImmortalityHubResponse } from "../lib/site-api.js";

type Side = "offense" | "defense";

export function RiseXpPage() {
  const { leagueId = "" } = useParams();
  const hubCtx = useHub();
  const selected = hubCtx.selectedLeague;
  const isRise = selected?.rosterType === "rise_to_immortality";
  const guildId = selected?.guildId ?? "";
  const unlocked = selected?.riseHubUnlocked === true;

  const [hub, setHub] = useState<ImmortalityHubResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<Side>("offense");
  const [attributeCode, setAttributeCode] = useState("SPD");
  const [result, setResult] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!guildId) return;
    const next = await siteApi.immortalityHub(guildId);
    setHub(next);
  }, [guildId]);

  useEffect(() => {
    if (leagueId) hubCtx.ensureLeagueScope(leagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => {
    if (!guildId || !isRise) return;
    let cancelled = false;
    setError(null);
    siteApi.immortalityHub(guildId).then((next) => {
      if (!cancelled) setHub(next);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load Player XP.");
    });
    return () => { cancelled = true; };
  }, [guildId, isRise]);

  const prospect = hub?.prospects.find((row) => String(row.side ?? "") === side) ?? null;
  const prospectId = prospect ? String(prospect.id ?? "") : "";
  const xp = prospectId && hub?.xp ? hub.xp[prospectId] : { playerXp: 0, teamXp: 0 };
  const build = hub?.builds?.find((row) => String(row.prospect_id ?? "") === prospectId) ?? null;
  const attributes = (build?.final_attributes ?? {}) as Record<string, number>;
  const position = side === "offense" ? hub?.league.offensePosition : hub?.league.defensePosition;

  if (selected && !isRise) {
    return <Navigate replace to={`/l/${leagueId}/buzz`} />;
  }

  if (selected && !unlocked) {
    return <Navigate replace to={`/l/${leagueId}/rise`} />;
  }

  if (!selected || !guildId) {
    return <div className="site-page site-loading">Loading Player XP…</div>;
  }

  return (
    <div className="site-page rise-page">
      <header className="rise-hero">
        <p className="site-muted">My Team</p>
        <h1>Player XP</h1>
        <p className="site-muted">
          Store purchases stay off. Spend Player XP to raise one rating at a time on your {position ?? "cornerstone"}.
        </p>
      </header>

      {error ? <p className="site-auth-error">{error}</p> : null}

      <p>
        <Link to={`/l/${leagueId}/rise`}>Back to Origins</Link>
      </p>

      <div className="rise-side-tabs">
        {(["offense", "defense"] as const).map((value) => (
          <button key={value} type="button"
            className={`wizard-game-card ${side === value ? "wizard-game-card-active" : ""}`}
            onClick={() => setSide(value)}>
            {value === "offense" ? `Offense (${hub?.league.offensePosition ?? "—"})` : `Defense (${hub?.league.defensePosition ?? "—"})`}
          </button>
        ))}
      </div>

      <section className="rise-card">
        <h2>{prospect ? `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect" : "No prospect yet"}</h2>
        <p>Player XP: <strong>{xp?.playerXp ?? 0}</strong> · Team XP: <strong>{xp?.teamXp ?? 0}</strong> · Estimated OVR: <strong>{String(build?.estimated_ovr ?? "—")}</strong></p>
        {!prospect ? (
          <p className="site-muted">Finish Origins before spending Player XP.</p>
        ) : (
          <>
            <label className="site-field">
              <span>Attribute</span>
              <select className="site-select" value={attributeCode} onChange={(event) => setAttributeCode(event.target.value)}>
                {MADDEN_ATTRIBUTE_DEFINITIONS.map((def) => (
                  <option key={def.code} value={def.code}>
                    {def.code} — {def.name} ({attributes[def.code] ?? "—"})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="site-btn site-btn-primary" disabled={busy}
              onClick={async () => {
                setBusy(true); setError(null); setResult(null);
                try {
                  const next = await siteApi.immortalitySpendXp({ guildId, side, attributeCode });
                  setResult(`${next.attributeCode} is now ${next.nextValue}. Cost ${next.cost} XP. OVR ${next.estimatedOvr}. ${next.playerXp} XP remaining.`);
                  await reload();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not spend Player XP.");
                } finally { setBusy(false); }
              }}>
              {busy ? "Spending…" : `Spend XP on ${attributeCode}`}
            </button>
            {result ? <p>{result}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}
