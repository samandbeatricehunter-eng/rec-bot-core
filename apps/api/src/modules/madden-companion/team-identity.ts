/** EA franchise abbreviations that do not match REC's seeded NFL abbreviations. */
const ABBR_ALIASES: Record<string, string[]> = {
  ARI: ["ARI", "AZ"],
  AZ: ["ARI", "AZ"],
  WAS: ["WAS", "WSH"],
  WSH: ["WAS", "WSH"],
  JAC: ["JAC", "JAX"],
  JAX: ["JAC", "JAX"],
};

export function abbreviationMatchValues(abbr: string | null | undefined): string[] {
  const key = String(abbr ?? "").trim().toUpperCase();
  if (!key) return [];
  return ABBR_ALIASES[key] ?? [key];
}

export function recTeamLooksLikeEaTeam(input: {
  recName: string;
  recAbbreviation: string | null;
  recDisplayNick?: string | null;
  eaName: string | null;
  eaAbbreviation: string | null;
  eaNick?: string | null;
  eaCity?: string | null;
}): boolean {
  const recName = input.recName.trim().toLowerCase();
  const recAbbr = (input.recAbbreviation ?? "").trim().toUpperCase();
  const recNick = (input.recDisplayNick ?? "").trim().toLowerCase();
  const eaName = (input.eaName ?? "").trim().toLowerCase();
  const eaAbbr = (input.eaAbbreviation ?? "").trim().toUpperCase();
  const eaNick = (input.eaNick ?? "").trim().toLowerCase();
  const eaCity = (input.eaCity ?? "").trim().toLowerCase();

  if (eaAbbr && recAbbr && abbreviationMatchValues(eaAbbr).includes(recAbbr)) return true;
  if (eaName && recName === eaName) return true;
  if (eaNick && (recName === eaNick || recName.endsWith(` ${eaNick}`) || recNick === eaNick)) return true;
  if (eaCity && eaNick && recName === `${eaCity} ${eaNick}`) return true;
  return false;
}

/** Prefer REC's seeded abbreviation when EA uses a known alias (AZ → ARI). */
export function preferredRecAbbreviation(eaAbbreviation: string | null | undefined): string | null {
  const key = String(eaAbbreviation ?? "").trim().toUpperCase();
  if (!key) return null;
  if (key === "AZ") return "ARI";
  if (key === "WSH") return "WAS";
  if (key === "JAC") return "JAX";
  return key;
}
