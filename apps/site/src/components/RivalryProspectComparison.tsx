import type { ProspectCardRenderData } from "../lib/site-api.js";

// Prospect-vs-prospect half of the Rivalry Head-to-Head render (apps/site's chromeless
// /render/rivalry-h2h/:gameId/:side route). Deliberately plain inline styles rather than a new
// CSS file -- this only ever renders inside a Playwright screenshot, never in normal site
// navigation, so there's no shared stylesheet worth authoring for it.
const GOLD = "#e0b84a";
const GREEN = "#3ecf6a";
const MUTED = "#8a8f98";

function fullName(p: ProspectCardRenderData): string {
  return `${p.firstName} ${p.lastName}`.trim() || "Prospect";
}

function AttributeRow({ label, left, right }: { label: string; left: number | null; right: number | null }) {
  const leftWins = left != null && (right == null || left > right);
  const rightWins = right != null && (left == null || right > left);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 70, textAlign: "right", fontWeight: 800, fontSize: 18, color: leftWins ? GREEN : "#fff" }}>
        {left ?? "—"}{leftWins ? " ✓" : ""}
      </div>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", position: "relative" }}>
        <div style={{ position: "absolute", right: "50%", top: 0, bottom: 0, width: `${Math.min(50, ((left ?? 0) / 2))}%`, background: leftWins ? GREEN : MUTED, borderRadius: "4px 0 0 4px" }} />
      </div>
      <div style={{ width: 150, textAlign: "center", textTransform: "uppercase", fontSize: 12, letterSpacing: 1, color: MUTED }}>{label}</div>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(50, ((right ?? 0) / 2))}%`, background: rightWins ? GREEN : MUTED, borderRadius: "0 4px 4px 0" }} />
      </div>
      <div style={{ width: 70, textAlign: "left", fontWeight: 800, fontSize: 18, color: rightWins ? GREEN : "#fff" }}>
        {rightWins ? "✓ " : ""}{right ?? "—"}
      </div>
    </div>
  );
}

function ProspectHeader({ prospect, align }: { prospect: ProspectCardRenderData; align: "left" | "right" }) {
  return (
    <div style={{ display: "flex", flexDirection: align === "left" ? "row" : "row-reverse", alignItems: "center", gap: 16, flex: 1 }}>
      <img
        src={prospect.headshotUrl || "/assets/player-cards/player-silhouette.svg"}
        alt=""
        style={{ width: 96, height: 96, borderRadius: 12, objectFit: "cover", border: `2px solid ${GOLD}`, background: "#1a1c20" }}
      />
      <div style={{ textAlign: align }}>
        {prospect.overallRating != null ? (
          <div style={{ color: GOLD, fontWeight: 900, fontSize: 22 }}>{prospect.overallRating} <span style={{ fontSize: 12, fontWeight: 700 }}>OVR</span></div>
        ) : null}
        <div style={{ fontSize: 26, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.5 }}>{fullName(prospect)}</div>
        <div style={{ color: MUTED, fontSize: 13 }}>{prospect.position} · {prospect.teamAbbr ?? prospect.teamName}</div>
      </div>
    </div>
  );
}

export function RivalryProspectComparison({ a, b }: { a: ProspectCardRenderData | null; b: ProspectCardRenderData | null }) {
  if (!a && !b) return null;

  // Both sides present -- full head-to-head with shared attribute rows only (a QB vs a MIKE
  // linebacker share nothing worth comparing, so this naturally degrades to name/team only for
  // cross-position matchups, and a genuine attribute comparison whenever the positions line up).
  if (a && b) {
    const bByCode = new Map(b.attributes.map((attr) => [attr.code, attr]));
    const sharedCodes = a.attributes.filter((attr) => bByCode.has(attr.code));
    return (
      <section style={{ border: `1px solid rgba(224,184,74,0.35)`, borderRadius: 16, padding: 24, background: "rgba(255,255,255,0.02)" }}>
        <p style={{ textAlign: "center", color: GOLD, textTransform: "uppercase", letterSpacing: 3, fontSize: 13, fontWeight: 800, margin: "0 0 16px" }}>Prospect Comparison</p>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <ProspectHeader prospect={a} align="left" />
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#1a1c20", border: `1px solid ${GOLD}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13, flexShrink: 0 }}>VS</div>
          <ProspectHeader prospect={b} align="right" />
        </div>
        {sharedCodes.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sharedCodes.map((attr) => (
              <AttributeRow key={attr.code} label={attr.name} left={attr.value} right={bByCode.get(attr.code)!.value} />
            ))}
          </div>
        ) : (
          <p style={{ textAlign: "center", color: MUTED, fontSize: 13, margin: 0 }}>Different position groups — no shared attributes to compare.</p>
        )}
      </section>
    );
  }

  // Only one side has a custom prospect on this position (the rival is a CPU/baseline-roster
  // team) -- a solo spotlight instead of a comparison that can't happen.
  const solo = (a ?? b)!;
  return (
    <section style={{ border: `1px solid rgba(224,184,74,0.35)`, borderRadius: 16, padding: 24, background: "rgba(255,255,255,0.02)" }}>
      <p style={{ textAlign: "center", color: GOLD, textTransform: "uppercase", letterSpacing: 3, fontSize: 13, fontWeight: 800, margin: "0 0 16px" }}>Prospect Spotlight</p>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <ProspectHeader prospect={solo} align="left" />
      </div>
      <p style={{ textAlign: "center", color: MUTED, fontSize: 13, marginTop: 12 }}>The rival franchise doesn't have a custom prospect at this position yet.</p>
    </section>
  );
}
