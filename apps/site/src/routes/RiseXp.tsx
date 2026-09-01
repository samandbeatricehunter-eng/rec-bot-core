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
        <Link to={`/l/${leagueId}/rise`}>Back to Origins</Link> · <Link to={`/l/${leagueId}/team/rivals`}>Rivals</Link>
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
                  setResult(`${next.attributeCode} is now ${next.nextValue}. Cost ${next.cost} XP. Real OVR ${next.currentOvr} (from the latest import). ${next.playerXp} XP remaining.`);
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

      {prospect ? (
        <WeeklyInterviewPanel guildId={guildId} side={side} setError={setError} />
      ) : null}

      {prospectId ? (
        <AbilityPanel
          guildId={guildId}
          side={side}
          state={hub?.abilities?.[prospectId] ?? null}
          setError={setError}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

type WeeklyInterview = Awaited<ReturnType<typeof siteApi.immortalityGetWeeklyInterview>>;

function WeeklyInterviewPanel({
  guildId, side, setError,
}: {
  guildId: string;
  side: Side;
  setError: (value: string | null) => void;
}) {
  const [data, setData] = useState<WeeklyInterview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const next = await siteApi.immortalityGetWeeklyInterview({ guildId, side });
    setData(next);
  }, [guildId, side]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load this week's interview."));
  }, [load, setError]);

  if (!data?.question) return null;

  return (
    <section className="rise-card">
      <h2>Media Day — Week {data.week}</h2>
      {data.locked && data.answer ? (
        <>
          <p>{data.question.question}</p>
          <p><strong>{data.question.options[data.answer.option_index]?.text ?? "Answered"}</strong></p>
          {data.answer.bonus_stat_category_hint ? (
            <p className="site-muted">
              Bonus opportunity flagged (+{data.answer.bonus_xp_pct}% Player XP) — status: {data.answer.bonus_status}.
              A commissioner confirms it once the box score is in.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p>{data.question.question}</p>
          <div className="rise-options">
            {data.question.options.map((option, index) => (
              <button key={index} type="button" className="site-btn site-btn-secondary" disabled={busy}
                onClick={async () => {
                  setBusy(true); setError(null);
                  try {
                    await siteApi.immortalitySubmitWeeklyInterview({ guildId, side, questionId: data.question!.id, optionIndex: index });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not save that answer.");
                  } finally { setBusy(false); }
                }}>
                {option.text}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function AbilityPanel({
  guildId, side, state, setError, onSaved,
}: {
  guildId: string;
  side: Side;
  state: ImmortalityAbilityState | null;
  setError: (value: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const equipped = state?.equipped ?? [];
  const eligible = state?.eligible ?? [];
  const ready = eligible.filter((row) => row.selectable);
  const locked = eligible.filter((row) => !row.selectable && !equipped.some((item) => item.id === row.id));
  const ovr = state?.estimatedOvr ?? 0;
  const archetype = state?.archetype ?? "your playstyle";

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
        Assign up to {state?.maxEquipped ?? 4} Madden 27 abilities once this player's OVR and playstyle meet the franchise floor.
        REC only chooses which ability is on the card — Madden still sets Bronze/Silver/Gold from in-game ratings.
        Current build: {ovr || "—"} OVR · {archetype}.
      </p>
      <h3>Assigned</h3>
      {!equipped.length ? <p className="site-muted">None yet. Raise OVR with Player XP or pick abilities that match this playstyle.</p> : (
        <ul className="rise-ability-list">
          {equipped.map((row) => (
            <li key={row.id} className="rise-ability-item">
              <div>
                <strong>{row.name}</strong> <span className={`rise-stock rise-stock-${row.kind === "xfactor" ? "rising" : "holding"}`}>{row.kind}</span>
                <p className="site-muted">{row.description}</p>
                <p className="site-muted">
                  {row.ovrMin ? `${row.ovrMin}+ OVR` : "OVR floor"}
                  {row.maddenArchetype ? ` · ${row.maddenArchetype}` : ""}
                  {row.upgradesWith?.primary ? ` · Madden upgrades with ${row.upgradesWith.primary}` : ""}
                </p>
              </div>
              <button type="button" className="site-btn site-btn-ghost" disabled={busy === row.id} onClick={() => void remove(row)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <h3>Ready to assign</h3>
      {!ready.length ? <p className="site-muted">No abilities currently meet this player's OVR and playstyle.</p> : (
        <ul className="rise-ability-list">
          {ready.map((row) => (
            <li key={row.id} className="rise-ability-item">
              <div>
                <strong>{row.name}</strong> <span className="rise-stock rise-stock-new">{row.ovrMin ? `${row.ovrMin}+ OVR` : "ready"}</span>
                <p className="site-muted">{row.description}</p>
                {row.maddenArchetype ? <p className="site-muted">{row.maddenArchetype}{row.upgradesWith?.primary ? ` · upgrades with ${row.upgradesWith.primary}` : ""}</p> : null}
              </div>
              <button type="button" className="site-btn site-btn-primary" disabled={busy === row.id} onClick={() => void select(row)}>Assign</button>
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
