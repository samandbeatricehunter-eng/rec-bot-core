// Logo assets only exist for the 32 standard Madden default teams (see
// apps/web/public/assets/team-logos/{ABBR}.png) -- CFB schools and any relocated/custom team
// have no matching file, so callers should pass null/undefined for those and get nothing back.
export function teamLogoUrl(abbreviation: string | null | undefined): string | null {
  if (!abbreviation) return null;
  // Version the logo set so long-lived browser/CDN caches cannot keep serving stale
  // assets that used these same filenames (bump whenever the files are regenerated —
  // this bump reflects the 2026-08-21 resize/recompress pass, 905px PNGs -> max 400px).
  return `/assets/team-logos/${abbreviation.toUpperCase()}.png?v=a4f8d0b2`;
}
