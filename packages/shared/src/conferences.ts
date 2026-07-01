// Every real conference name across both games (NFL + CFB) — used to canonicalize
// aliases and to sort conference pickers consistently across the API and the bot.
export const CONFERENCE_ORDER = ["NFC", "AFC", "ACC", "American", "Big Ten", "Big 12", "C-USA", "MAC", "Mountain West", "Pac-12", "SEC", "Sun Belt", "Independents", "Other"];
const CANONICAL_CONFERENCE_NAMES = new Map(CONFERENCE_ORDER.map((conference) => [conference.toUpperCase(), conference]));

// Relocated/custom teams sometimes come back with a blank conference and a division like
// "NFC East". Infer the real conference from the division text when the conference field
// is blank/unrecognized.
export function canonicalConferenceName(confName?: string | null, divisionText?: string | null): string {
  const raw = String(confName ?? "").trim();
  const c = raw.toUpperCase();
  const canonical = CANONICAL_CONFERENCE_NAMES.get(c);
  if (canonical) return canonical;
  if (raw) return raw;
  const text = String(divisionText ?? "").toUpperCase();
  if (text.includes("AFC")) return "AFC";
  if (text.includes("NFC")) return "NFC";
  return "Other";
}
