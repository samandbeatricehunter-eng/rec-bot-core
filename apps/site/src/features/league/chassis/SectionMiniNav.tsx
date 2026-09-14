import { useNavigate } from "react-router-dom";

export type SectionMiniNavItem = {
  id: string;
  top: string;
  bottom: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledTitle?: string;
};

function columnSpans(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(4 / count);
  const remainder = 4 - base * count;
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? base + remainder : base));
}

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
  const spans = [
    ...columnSpans(Math.min(half, items.length)),
    ...columnSpans(items.length - half),
  ];

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
              if (item.onClick) {
                item.onClick();
                return;
              }
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
