import { NFL_TEAM_PRIMARY_COLORS, NFL_TEAM_SECONDARY_COLORS, getTeamByAbbreviation } from "@rec/shared";
import { resolveTeamLogoAbbr } from "../../../../web/src/lib/team-logos.js";

export type TeamAppearanceInput = {
  abbreviation?: string | null;
  displayAbbr?: string | null;
  originalAbbreviation?: string | null;
  primaryColor?: string | null;
  logoUrl?: string | null;
  displayCity?: string | null;
  displayNick?: string | null;
  name?: string | null;
};

export type TeamAppearance = {
  /** Abbr used for stock logo / catalog lookup. */
  logoAbbr: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  inkColor: string;
  city: string;
  nick: string;
  logoUrl: string | null;
};

/** Precomputed stock visual tokens for the 32 NFL clubs — shared by standings, leaders, mgmt. */
export const NFL_STOCK_TEAM_APPEARANCE: Readonly<
  Record<string, { abbr: string; primaryColor: string; secondaryColor: string | null }>
> = Object.freeze(
  Object.fromEntries(
    Object.keys(NFL_TEAM_PRIMARY_COLORS).map((abbr) => [
      abbr,
      {
        abbr,
        primaryColor: NFL_TEAM_PRIMARY_COLORS[abbr],
        secondaryColor: NFL_TEAM_SECONDARY_COLORS[abbr] ?? null,
      },
    ]),
  ) as Record<string, { abbr: string; primaryColor: string; secondaryColor: string | null }>,
);

function isHexColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

export function contrastingInk(hex: string): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return "#fff";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.62 ? "#111111" : "#ffffff";
}

/**
 * Resolve wash color + logo + city/nick for any team card.
 * Stock 32 clubs hit the central NFL catalog; custom/relocated use DB color/logo when set,
 * falling back to originalAbbreviation for stock assets when the display abbr is custom.
 */
export function resolveTeamAppearance(input: TeamAppearanceInput): TeamAppearance {
  const candidates = [
    input.displayAbbr,
    input.abbreviation,
    input.originalAbbreviation,
  ];
  let logoAbbr: string | null = null;
  for (const candidate of candidates) {
    const resolved = resolveTeamLogoAbbr(candidate);
    if (resolved) {
      logoAbbr = resolved;
      break;
    }
  }

  const stock = logoAbbr ? NFL_STOCK_TEAM_APPEARANCE[logoAbbr] : null;
  const rawColor = typeof input.primaryColor === "string" ? input.primaryColor.trim() : "";
  // Treat unset custom white as "use catalog" so relocated teams keep NFL colors until edited.
  const hasCustomColor = rawColor && isHexColor(rawColor) && rawColor.toUpperCase() !== "#FFFFFF";
  const primaryColor = hasCustomColor
    ? rawColor
    : (stock?.primaryColor ?? (rawColor && isHexColor(rawColor) ? rawColor : "#1a1d24"));

  const catalog = logoAbbr ? getTeamByAbbreviation(logoAbbr) : undefined;
  let nick = input.displayNick?.trim() || "";
  let city = input.displayCity?.trim() || "";
  if ((!nick || !city) && catalog?.name) {
    const parts = catalog.name.trim().split(/\s+/);
    if (!nick) nick = parts[parts.length - 1] ?? "";
    if (!city) city = parts.slice(0, -1).join(" ");
  }
  if ((!nick || !city) && input.name) {
    const parts = input.name.trim().split(/\s+/);
    if (!nick) nick = parts[parts.length - 1] ?? input.name;
    if (!city && parts.length > 1) city = parts.slice(0, -1).join(" ");
  }

  return {
    logoAbbr,
    primaryColor,
    secondaryColor: stock?.secondaryColor ?? null,
    inkColor: contrastingInk(primaryColor),
    city: city || logoAbbr || input.abbreviation || "",
    nick: nick || input.name || logoAbbr || "Team",
    logoUrl: input.logoUrl?.trim() || null,
  };
}
