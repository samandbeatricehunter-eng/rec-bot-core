import type { ReactNode } from "react";

type MobileBottomNavProps<T extends string> = {
  tabs: { key: T; label: string; icon: ReactNode }[];
  active: T;
  onChange: (key: T) => void;
};

/** Sticky bottom tab bar for mobile navigation within a page (e.g. Hub sub-tabs). */
export function MobileBottomNav<T extends string>({ tabs, active, onChange }: MobileBottomNavProps<T>) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Section">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={["mobile-bottom-nav-btn", tab.key === active && "active"].filter(Boolean).join(" ")}
          onClick={() => onChange(tab.key)}
          aria-current={tab.key === active ? "page" : undefined}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
