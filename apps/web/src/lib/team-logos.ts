// Logo assets only exist for the 32 standard Madden default teams (see
// apps/web/public/assets/team-logos/{ABBR}.png) -- CFB schools and any relocated/custom team
// have no matching file, so callers should pass null/undefined for those and get nothing back.
export function teamLogoUrl(abbreviation: string | null | undefined): string | null {
  if (!abbreviation) return null;
  return `/assets/team-logos/${abbreviation.toUpperCase()}.png`;
}
