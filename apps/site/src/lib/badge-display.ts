export function badgeAsset(_key: string, label: string, _tier?: string | null): string {
  const safe = label.replace(/[<>&"']/g, "");
  const initials = safe
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="112" viewBox="0 0 420 112">
    <defs>
      <linearGradient id="g" x1="0" x2="1"><stop stop-color="#e7edf7"/><stop offset=".48" stop-color="#8795aa"/><stop offset="1" stop-color="#eef4ff"/></linearGradient>
      <filter id="b"><feGaussianBlur stdDeviation="8"/></filter>
    </defs>
    <rect x="3" y="3" width="414" height="106" rx="22" fill="#0a0f17" fill-opacity=".82" stroke="url(#g)" stroke-width="3"/>
    <ellipse cx="74" cy="56" rx="45" ry="34" fill="#b9c7dc" fill-opacity=".16" filter="url(#b)"/>
    <path d="M48 31h52v36c0 15-12 24-26 30-14-6-26-15-26-30z" fill="none" stroke="url(#g)" stroke-width="3"/>
    <text x="74" y="69" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="800" fill="#f5f7fb">${initials}</text>
    <text x="122" y="62" font-family="Arial,sans-serif" font-size="19" font-weight="800" letter-spacing=".5" fill="#fff">${safe.slice(0, 27)}</text>
    <text x="122" y="82" font-family="Arial,sans-serif" font-size="10" letter-spacing="2.5" fill="#c4cedd">REC ACHIEVEMENT</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export type SiteBadge = {
  badge_key: string;
  badge_label?: string;
  badge_scope: string;
  polarity: string | null;
  tier: string | null;
  earned_count: number | null;
  description?: string;
  earnedByGame?: Record<string, number>;
  league_id?: string | null;
  season?: number | null;
  week?: number | null;
  updated_at?: string | null;
  is_active?: boolean;
};

export function badgeTooltip(badge: SiteBadge): string {
  const byGame = Object.entries(badge.earnedByGame ?? {})
    .map(([game, count]) => `${game.replaceAll("_", " ")}: x${count}`)
    .join(" | ");
  const label = badge.badge_label ?? badge.badge_key.replaceAll("_", " ");
  return [
    label,
    badge.description,
    `Scope: ${badge.badge_scope}`,
    badge.is_active === false ? "Currently inactive" : null,
    badge.earned_count ? `Earned ${badge.earned_count} time${badge.earned_count === 1 ? "" : "s"}` : null,
    byGame,
  ]
    .filter(Boolean)
    .join(" — ");
}
