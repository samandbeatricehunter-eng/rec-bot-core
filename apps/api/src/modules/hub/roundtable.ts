export type RoundtablePanelist = { speaker: string; role: string; take: string };

function cleanSentence(value: string | undefined, fallback: string) {
  const text = value?.trim().replace(/\s+/g, " ");
  return text ? text.replace(/[.?!]*$/, ".") : fallback;
}

export function buildRoundtableDiscussion(input: { headline: string; body: string; notes?: string[]; statsSummary?: string[] }): RoundtablePanelist[] {
  const notes = [...(input.notes ?? []), ...(input.statsSummary ?? [])].filter(Boolean);
  // The article is already displayed directly above the desk. Panelists should react
  // to its premise instead of reciting the submitted copy back to the reader.
  const subject = cleanSentence(input.headline, "This week's league story.");
  const first = cleanSentence(notes[0], "The most important question is whether the underlying performance is repeatable.");
  const second = cleanSentence(notes[1], "The numbers point to a matchup that turned on execution more than noise.");
  const third = cleanSentence(notes[2], "The league will want to know whether this version shows up again next week.");
  const fourth = cleanSentence(notes[3], "The film room is going to find a few details that mattered more than they looked live.");
  return [
    { speaker: "Caleb Cross", role: "REC Network Host", take: `${subject} The bigger story is what this means for the league going into the next set of games.` },
    { speaker: "Maya Raines", role: "Film Desk Analyst", take: `${first} On tape, that is not just a stat line. It tells you which side controlled the answers once the first script was gone.` },
    { speaker: "Theo Grant", role: "Numbers Columnist", take: `${second} I care about the repeatable stuff: drive efficiency, turnovers, and whether the production came from one burst or four quarters of pressure.` },
    { speaker: "Nina Vale", role: "League Insider", take: `${third} ${fourth} Coaches around the league are going to read this as a scouting report, not just a final score.` },
  ];
}
