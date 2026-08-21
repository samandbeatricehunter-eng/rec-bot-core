import { NFL_TEAMS } from "@rec/shared";

const LOGO_FILES = new Set(NFL_TEAMS.map((team) => team.abbreviation));

// Madden / stats feeds sometimes use 3-letter codes that don't match the PNG filenames.
const LOGO_ALIASES: Record<string, string> = {
  ARZ: "ARI",
  JAC: "JAX",
  WSH: "WAS",
  SFO: "SF",
  GBP: "GB",
  GNB: "GB",
  NOR: "NO",
  NWE: "NE",
  TAM: "TB",
  KAN: "KC",
  SD: "LAC",
  STL: "LAR",
  OAK: "LV",
  LVR: "LV",
  BLT: "BAL",
  CLV: "CLE",
  HST: "HOU",
};

export function resolveTeamLogoAbbr(abbreviation: string | null | undefined): string | null {
  if (!abbreviation) return null;
  const key = abbreviation.trim().toUpperCase();
  if (!key) return null;
  const mapped = LOGO_ALIASES[key] ?? key;
  return LOGO_FILES.has(mapped) ? mapped : null;
}

// Logo assets only exist for the 32 standard Madden default teams (see
// apps/web/public/assets/team-logos/{ABBR}.png) -- CFB schools and any relocated/custom team
// have no matching file, so callers should pass null/undefined for those and get nothing back.
export function teamLogoUrl(abbreviation: string | null | undefined): string | null {
  const abbr = resolveTeamLogoAbbr(abbreviation);
  if (!abbr) return null;
  // Version the logo set so long-lived browser/CDN caches cannot keep serving stale
  // assets that used these same filenames (bump whenever the files are regenerated —
  // this bump reflects the 2026-08-21 resize/recompress pass, 905px PNGs -> max 400px).
  return `/assets/team-logos/${abbr}.png?v=a4f8d0b2`;
}
