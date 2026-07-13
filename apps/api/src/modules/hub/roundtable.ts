export type RoundtablePanelist = { speaker: string; role: string; take: string };

export function buildRoundtableDiscussion(input: { headline: string; body: string; notes?: string[]; statsSummary?: string[] }): RoundtablePanelist[] {
  const notes = [...(input.notes ?? []), ...(input.statsSummary ?? [])].filter(Boolean);
  const first = notes[0] ?? input.body;
  const second = notes[1] ?? "The result changes the weekly picture and gives the rest of the league something to study.";
  const third = notes[2] ?? "The next matchup will show whether this performance is repeatable.";
  return [
    { speaker: "Marcus Reed", role: "REC Desk Host", take: `${input.headline}. ${input.body}` },
    { speaker: "Dana Cole", role: "Film Analyst", take: first },
    { speaker: "Victor Banks", role: "Numbers Analyst", take: second },
    { speaker: "Jenna Cross", role: "League Insider", take: third },
  ];
}
