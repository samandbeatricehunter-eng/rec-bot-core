// Parses the `abilities_raw` blobs scraped from maddenratings.com into structured
// [{ name, description }] entries. The blobs are the player page's ability cards (name +
// description) concatenated with no delimiter, e.g.:
//   "YAC 'Em Up The best physical receivers don't just come down with the ball, ... Deep In
//    Elite Receivers with this ability catch more consistently while catching passes ..."
// so the only reliable boundary is a canonical ability-name match. Names are matched
// longest-first; a match only starts a new ability when enough description text follows it
// (real descriptions are long sentences, so a short gap means the word was just prose inside
// the previous description). Entries whose name isn't in the canonical list merge into the
// preceding description rather than being dropped.

const MADDEN_ABILITY_NAMES = [
  "3rd Down Threat",
  "Acrobat",
  "Ankle Breaker",
  "Arm Bar",
  "Backfield Mismatch",
  "Bazooka",
  "Bottleneck",
  "Brick Wall",
  "Clutch",
  "Dashing Deadeye",
  "Deep Elite",
  "Deep In Elite",
  "Deep In Zone KO",
  "Deep Out Elite",
  "Deep Out Zone KO",
  "Deep Route KO",
  "Dots",
  "Double Me",
  "Dual Threat",
  "Edge Threat",
  "El Toro",
  "Energizer",
  "Enforcer",
  "Evasive",
  "Extra Credit",
  "Extender",
  "Fastbreak",
  "Fearless",
  "Fearmonger",
  "First One Free",
  "Flat Zone KO",
  "Freight Train",
  "Gift-Wrapped",
  "Goal Line Stuff",
  "High Point Deadeye",
  "Human Joystick",
  "Inside Deadeye",
  "Inside Shade",
  "Instant Rebate",
  "Interior Threat",
  "Juke Box",
  "Lofting Deadeye",
  "Long Range Deadeye",
  "Lurker",
  "Max Effort",
  "Medium Route KO",
  "Mid In Elite",
  "Mid Out Elite",
  "Mid Zone KO",
  "Momentum Shift",
  "Mr. Big Stop",
  "No-Look Deadeye",
  "No Outsiders",
  "On The Ball",
  "Outmatched",
  "Outside Shade",
  "Phenom",
  "Pocket Deadeye",
  "Pro Reads",
  "Quick Jump",
  "RAC 'em Up",
  "Red Zone Deadeye",
  "Red Zone Threat",
  "Reinforcement",
  "Relentless",
  "Roaming Deadeye",
  "Route Technician",
  "Run & Gun",
  "Run Stopper",
  "Runoff Elite",
  "Secure Tackler",
  "Shutdown",
  "Short In Elite",
  "Short Out Elite",
  "Short Route KO",
  "Sideline Deadeye",
  "Slot-O-Matic",
  "Swim Club",
  "Tank",
  "Truzz",
  "Under Pressure",
  "Universal Coverage",
  "Unpredictable",
  "Unstoppable Force",
  "YAC 'Em Up",
  "Zen Kicker",
] as const;

const ABILITY_NAME_ENTRIES = [...MADDEN_ABILITY_NAMES]
  .sort((a, b) => b.length - a.length)
  .map((name) => ({ name, key: name.toLowerCase() }));

const MIN_DESCRIPTION_LENGTH = 15;

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const isWordChar = (c: string): boolean => /[a-z0-9]/i.test(c);

function findNextName(text: string, from: number): { index: number; name: string } | null {
  const lower = text.toLowerCase();
  for (let i = from; i < text.length; i++) {
    const before = i > 0 ? text[i - 1] : " ";
    if (isWordChar(before)) continue;
    for (const entry of ABILITY_NAME_ENTRIES) {
      if (lower.startsWith(entry.key, i)) {
        const afterIndex = i + entry.key.length;
        const after = afterIndex < text.length ? text[afterIndex] : " ";
        if (!isWordChar(after)) return { index: i, name: entry.name };
      }
    }
  }
  return null;
}

export type ParsedAbility = { name: string; description: string };

export function parseAbilitiesRaw(raw: string | null | undefined): ParsedAbility[] {
  if (!raw?.trim()) return [];
  let text = decodeEntities(raw.trim());
  // The last blob sometimes drags in the site footer — cut anything after the first junk marker.
  text = text
    .replace(/\s*(View More|All images, logos|Privacy Manager|MaddenRatings\.com is an independent).*$/i, "")
    .trim();
  if (!text) return [];

  const entries: ParsedAbility[] = [];
  let cursor = 0;
  let current = findNextName(text, cursor);
  while (current) {
    const nameEnd = current.index + current.name.length;
    const next = findNextName(text, nameEnd);
    const descriptionEnd = next ? next.index : text.length;
    const description = text.slice(nameEnd, descriptionEnd).trim();
    if (description.length >= MIN_DESCRIPTION_LENGTH) {
      entries.push({ name: current.name, description });
    }
    if (!next) break;
    cursor = next.index;
    current = next;
  }
  return entries;
}
