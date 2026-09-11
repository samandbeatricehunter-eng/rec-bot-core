import { useNavigate } from "react-router-dom";

export type SectionMiniNavItem = {
  id: string;
  top: string;
  bottom: string;
  to: string;
  disabled?: boolean;
  disabledTitle?: string;
};

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

  return (
    <nav
      className={["hub-standings-mini-nav", "hub-section-mini-nav", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const selected = item.id === active;
        const disabled = Boolean(item.disabled) && !selected;
        return (
          <button
            key={item.id}
            type="button"
            className={selected ? "is-selected" : undefined}
            disabled={disabled}
            title={disabled ? item.disabledTitle : undefined}
            aria-pressed={selected}
            onClick={() => {
              if (selected || disabled) return;
              navigate(item.to);
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
