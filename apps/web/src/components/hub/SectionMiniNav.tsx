import { useNavigate } from "react-router-dom";

export type SectionMiniNavItem = {
  id: string;
  top: string;
  bottom: string;
  /** Route items navigate; omit `to` and pass `onClick` for an item that opens something
   * in place (a modal) instead of changing the page (e.g. Game Day's "My Schedule"). */
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledTitle?: string;
};

// League Home's own snapshot box is always 2 rows of 4 (8 blocks). Every mini-nav must occupy
// that exact same footprint regardless of how many real items it has -- fewer than 8 means
// wider merged cells, not a shorter box. So items always split into exactly 2 rows (row 1 =
// first half, row 2 = the rest), and each row's items evenly share all 4 column tracks: e.g. 4
// items -> 2 per row, each spanning 2 columns (a 2x2 block the same size as the 8-block grid).
function columnSpans(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(4 / count);
  const remainder = 4 - base * count;
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? base + remainder : base));
}

/** Shared responsive chip strip used by Stats, Team, and (later) Media section hubs. */
export function SectionMiniNav({
  items,
  active,
  ariaLabel,
  className,
}: {
  items: SectionMiniNavItem[];
  active: string;
  ariaLabel: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const half = Math.ceil(items.length / 2);
  const spans = [...columnSpans(Math.min(half, items.length)), ...columnSpans(items.length - half)];

  return (
    <nav
      className={["hub-standings-mini-nav", "hub-section-mini-nav", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      {items.map((item, index) => {
        const selected = item.id === active;
        const disabled = Boolean(item.disabled) && !selected;
        return (
          <button
            key={item.id}
            type="button"
            className={selected ? "is-selected" : undefined}
            style={{ gridColumn: `span ${spans[index]}` }}
            disabled={disabled}
            title={disabled ? item.disabledTitle : undefined}
            aria-pressed={selected}
            onClick={() => {
              if (selected || disabled) return;
              if (item.onClick) { item.onClick(); return; }
              if (item.to) navigate(item.to);
            }}
          >
            <span>{item.top}</span>
            <strong>{item.bottom}</strong>
          </button>
        );
      })}
    </nav>
  );
}
