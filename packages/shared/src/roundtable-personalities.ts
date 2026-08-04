// 20 generic sports-broadcast personas a commissioner can assign to a roundtable host, in
// place of the default role label. Purely flavor/display text — the underlying take-bank
// content is still keyed to the fixed voice slot (caleb/maya/theo/nina), not the personality.
export type RecRoundtablePersonality = { key: string; label: string; description: string };

export const REC_ROUNDTABLE_PERSONALITIES: RecRoundtablePersonality[] = [
  { key: "hot_take_artist", label: "The Hot Take Artist", description: "Leads with bold, contrarian predictions and isn't afraid to be wrong loudly." },
  { key: "film_grinder", label: "The Film Grinder", description: "Talks scheme, leverage, and personnel packages like it's a coaching clinic." },
  { key: "numbers_nerd", label: "The Numbers Nerd", description: "Reaches for a stat or a rate before an opinion, every time." },
  { key: "locker_room_insider", label: "The Locker Room Insider", description: "Frames everything around chemistry, buy-in, and what the room is really saying." },
  { key: "old_school_grinder", label: "The Old-School Grinder", description: "Values physicality, discipline, and doing the boring stuff right." },
  { key: "underdog_believer", label: "The Underdog Believer", description: "Always finds the chip on someone's shoulder and roots for the comeback story." },
  { key: "cool_headed_realist", label: "The Cool-Headed Realist", description: "Refuses to overreact to one game either way — steady, measured takes." },
  { key: "hype_man", label: "The Hype Man", description: "Brings the energy, loves a big moment, sells the drama of the week." },
  { key: "skeptical_veteran", label: "The Skeptical Veteran", description: "Has seen every storyline before and wants proof before believing the hype." },
  { key: "player_advocate", label: "The Player Advocate", description: "Centers individual performances and what a player is fighting for personally." },
  { key: "big_picture_strategist", label: "The Big-Picture Strategist", description: "Zooms out to playoff races, seeding, and season-long trajectory." },
  { key: "trash_talker", label: "The Trash Talker", description: "Needles fanbases and rivals with a grin, but backs it up with real analysis." },
  { key: "sideline_reporter_energy", label: "The Sideline Reporter", description: "Brings breaking-news urgency and behind-the-scenes color to every take." },
  { key: "coach_speak_translator", label: "The Coach-Speak Translator", description: "Decodes what a coach's quote actually means in plain language." },
  { key: "momentum_reader", label: "The Momentum Reader", description: "Obsessed with streaks, trends, and which way a team is trending right now." },
  { key: "matchup_hunter", label: "The Matchup Hunter", description: "Breaks every game down to the one specific matchup that decides it." },
  { key: "wildcard_wildcard", label: "The Wildcard", description: "Unpredictable, a little chaotic, always brings an angle nobody else saw." },
  { key: "steady_captain", label: "The Steady Captain", description: "Calm, credible, the voice that keeps the roundtable grounded." },
  { key: "storyteller", label: "The Storyteller", description: "Wraps every take in a narrative — this week's game as the next chapter." },
  { key: "accountability_hawk", label: "The Accountability Hawk", description: "Holds teams and players to their own preseason word, no exceptions." },
];

export function getRoundtablePersonality(key: string): RecRoundtablePersonality | null {
  return REC_ROUNDTABLE_PERSONALITIES.find((p) => p.key === key) ?? null;
}
