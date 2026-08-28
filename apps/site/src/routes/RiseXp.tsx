import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { MADDEN_ATTRIBUTE_DEFINITIONS } from "@rec/shared";
import { useHub } from "../lib/hub-context.js";
import { siteApi, type ImmortalityAbilityCard, type ImmortalityAbilityState, type ImmortalityHubResponse } from "../lib/site-api.js";

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
          Madden 27 abilities are a performance bonus — Gold weeks, season milestones, and awards grant slots.
          The ability only applies in-game once the rating floor is met (Bronze/Silver/Gold).
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

      {prospectId ? (
        <AbilityPanel
          guildId={guildId}
          side={side}
          state={hub?.abilities?.[prospectId] ?? null}
          attributes={attributes}
          setError={setError}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function AbilityPanel({
  guildId, side, state, attributes, setError, onSaved,
}: {
  guildId: string;
  side: Side;
  state: ImmortalityAbilityState | null;
  attributes: Record<string, number>;
  setError: (value: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const earned = state?.earnedSlots ?? 0;
  const slots = state?.slots ?? 0;
  const equipped = state?.equipped ?? [];
  const eligible = state?.eligible ?? [];
  const ready = eligible.filter((row) => row.selectable);
  const locked = eligible.filter((row) => !row.selectable && !equipped.some((item) => item.id === row.id));

  async function select(row: ImmortalityAbilityCard) {
    setBusy(row.id); setError(null);
    try {
      await siteApi.immortalitySelectAbility({ guildId, side, abilityId: row.id });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not equip that ability.");
    } finally { setBusy(null); }
  }

  async function remove(row: ImmortalityAbilityCard) {
    setBusy(row.id); setError(null);
    try {
      await siteApi.immortalityRemoveAbility({ guildId, side, abilityId: row.id });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that ability.");
    } finally { setBusy(null); }
  }

  return (
    <section className="rise-card">
      <h2>Abilities</h2>
      <p className="site-muted">
        {slots} of {state?.maxEquipped ?? 4} slots unlocked from performance ({earned} grant{earned === 1 ? "" : "s"}).
        X-Factors need 3 grants. Bronze/Silver/Gold in Madden tracks {ready[0]?.primary ? "the listed rating floors" : "the primary rating"} — XP the attribute before the ability will apply in-game.
      </p>
      <h3>Equipped</h3>
      {!equipped.length ? <p className="site-muted">None yet. Earn a Gold weekly challenge, season milestone, or award.</p> : (
        <ul className="rise-ability-list">
          {equipped.map((row) => (
            <li key={row.id} className="rise-ability-item">
              <div>
                <strong>{row.name}</strong> <span className={`rise-stock rise-stock-${row.kind === "xfactor" ? "rising" : "holding"}`}>{row.kind}</span>
                <span className={`rise-stock rise-stock-${row.tier === "gold" ? "rising" : row.tier === "none" ? "sliding" : "new"}`}>{row.tier}</span>
                <p className="site-muted">{row.description}</p>
                {row.floors && row.primary ? (
                  <p className="site-muted">{row.primary} {attributes[row.primary] ?? "—"} · Bronze {row.floors.bronze} / Silver {row.floors.silver} / Gold {row.floors.gold}</p>
                ) : null}
              </div>
              <button type="button" className="site-btn site-btn-ghost" disabled={busy === row.id} onClick={() => void remove(row)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <h3>Ready to equip</h3>
      {!ready.length ? <p className="site-muted">No abilities currently meet both a free slot and the Madden rating floor.</p> : (
        <ul className="rise-ability-list">
          {ready.map((row) => (
            <li key={row.id} className="rise-ability-item">
              <div>
                <strong>{row.name}</strong> <span className="rise-stock rise-stock-new">{row.tier}</span>
                <p className="site-muted">{row.description}</p>
                {row.floors && row.primary ? (
                  <p className="site-muted">{row.primary} {attributes[row.primary] ?? "—"} / {row.floors.bronze}+ bronze</p>
                ) : null}
              </div>
              <button type="button" className="site-btn site-btn-primary" disabled={busy === row.id} onClick={() => void select(row)}>Equip</button>
            </li>
          ))}
        </ul>
      )}
      <h3>Locked</h3>
      <ul className="rise-ability-list rise-ability-locked">
        {locked.slice(0, 12).map((row) => (
          <li key={row.id} className="rise-ability-item">
            <div>
              <strong>{row.name}</strong>
              <p className="site-muted">{row.blockedReason ?? "Not available yet."}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
