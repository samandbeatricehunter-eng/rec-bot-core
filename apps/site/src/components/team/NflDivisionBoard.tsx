import { useMemo, type ReactNode } from "react";

const NFL_DIVISION_ORDER = ["East", "North", "South", "West"] as const;

export function normalizeConference(value: string | null | undefined): "NFC" | "AFC" | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "NFC" || raw.includes("NATIONAL")) return "NFC";
  if (raw === "AFC" || raw.includes("AMERICAN")) return "AFC";
  return null;
}

export function normalizeDivision(value: string | null | undefined): (typeof NFL_DIVISION_ORDER)[number] | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const division of NFL_DIVISION_ORDER) {
    if (lower === division.toLowerCase() || lower.endsWith(` ${division.toLowerCase()}`)) return division;
  }
  return null;
}

export type DivisionBucket<T> = {
  conference: "NFC" | "AFC";
  division: (typeof NFL_DIVISION_ORDER)[number];
  label: string;
  teams: T[];
};

/** Group teams into the standings NFC/AFC × East/North/South/West board. */
export function useNflDivisionBuckets<T extends { conference?: string | null; division?: string | null }>(
  teams: T[],
): { NFC: DivisionBucket<T>[]; AFC: DivisionBucket<T>[]; leftovers: T[] } {
  return useMemo(() => {
    const leftovers: T[] = [];
    const buckets = new Map<string, DivisionBucket<T>>();
    for (const conference of ["NFC", "AFC"] as const) {
      for (const division of NFL_DIVISION_ORDER) {
        buckets.set(`${conference}:${division}`, {
          conference,
          division,
          label: `${conference} ${division}`,
          teams: [],
        });
      }
    }
    for (const team of teams) {
      const conference = normalizeConference(team.conference);
      const division = normalizeDivision(team.division);
      if (!conference || !division) {
        leftovers.push(team);
        continue;
      }
      buckets.get(`${conference}:${division}`)?.teams.push(team);
    }
    return {
      NFC: NFL_DIVISION_ORDER.map((division) => buckets.get(`NFC:${division}`)!),
      AFC: NFL_DIVISION_ORDER.map((division) => buckets.get(`AFC:${division}`)!),
      leftovers,
    };
  }, [teams]);
}

export function NflDivisionBoard({
  ariaLabel,
  nfc,
  afc,
  renderColumn,
}: {
  ariaLabel: string;
  nfc: DivisionBucket<unknown>[];
  afc: DivisionBucket<unknown>[];
  renderColumn: (bucket: DivisionBucket<any>) => ReactNode;
}) {
  return (
    <div className="hub-div-standings-board" aria-label={ariaLabel}>
      <div className="hub-div-standings-side" data-conference="nfc">
        <p className="hub-div-standings-side-label">NFC</p>
        <div className="hub-div-standings-side-grid">
          {nfc.map((bucket) => (
            <div key={`nfc-${bucket.division}`}>{renderColumn(bucket)}</div>
          ))}
        </div>
      </div>
      <div className="hub-div-standings-divider" aria-hidden="true" />
      <div className="hub-div-standings-side" data-conference="afc">
        <p className="hub-div-standings-side-label">AFC</p>
        <div className="hub-div-standings-side-grid">
          {afc.map((bucket) => (
            <div key={`afc-${bucket.division}`}>{renderColumn(bucket)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NflDivisionColumn({
  label,
  children,
  emptyLabel = "No teams",
}: {
  label: string;
  children: ReactNode;
  emptyLabel?: string;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="hub-div-standing-card">
      <header className="hub-div-standing-card-head">
        <span />
        <h3>{label}</h3>
        <span />
      </header>
      <div className="hub-div-standing-stack">
        {hasChildren ? children : <p className="hub-div-standing-empty">{emptyLabel}</p>}
      </div>
    </section>
  );
}
