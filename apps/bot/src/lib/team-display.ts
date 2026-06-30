// Canonical team-display helpers. Custom/relocated teams update their rec_teams row
// in place: `abbreviation` keeps the original NFL slot, while `display_abbr` /
// `display_city` / `display_nick` hold the custom identity (is_relocated = true).
// Every menu pathway must render teams through these helpers so custom and hardcoded
// teams look identical everywhere (no pathway showing the original abbr while another
// shows the relocated city/nick).

export type TeamLike = {
  name?: string | null;
  abbreviation?: string | null;
  display_abbr?: string | null;
  display_city?: string | null;
  display_nick?: string | null;
  is_relocated?: boolean | null;
};

const clean = (value?: string | null) => (value ?? "").trim();

/** Best abbreviation for a team — the relocated/custom abbr when set, else the original. */
export function teamDisplayAbbr(team?: TeamLike | null): string {
  if (!team) return "TBD";
  return clean(team.display_abbr) || clean(team.abbreviation) || clean(team.name) || "TBD";
}

/** Full display name — the relocated "City Nick" when set, else the team name, else abbr. */
export function teamDisplayName(team?: TeamLike | null): string {
  if (!team) return "Team";
  const combined = `${clean(team.display_city)} ${clean(team.display_nick)}`.trim();
  if (combined) return combined;
  return clean(team.name) || teamDisplayAbbr(team);
}

/** "ABBR - Name" label for selects/listings where both help disambiguate. */
export function teamDisplayLabel(team?: TeamLike | null): string {
  if (!team) return "Team";
  const name = teamDisplayName(team);
  const abbr = teamDisplayAbbr(team);
  return abbr && abbr !== name ? `${abbr} - ${name}` : name;
}
