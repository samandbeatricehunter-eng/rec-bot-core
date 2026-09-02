import type { PersonaDimension } from "@rec/shared";

// Flavor-text bank for the franchise-selection "headline" story (see franchise-headline.ts).
// Keyed by a person's persona primary dimension so the inferred dialog actually sounds like
// them -- a Leadership owner talks differently than a Showmanship one. {first} is filled with
// the person's first name at use time.

export const HEADLINE_TEMPLATES: string[] = [
  "{owner} Takes Over the {team}",
  "{team} Officially Belong to {owner}",
  "The {owner} Era Begins in {city}",
  "{owner} and the {team} Begin Their Rise",
  "It's Official: {owner} Owns the {team}",
];

export const OWNER_INTRO_LINES: Record<PersonaDimension, string[]> = {
  Leadership: [
    '"{first} doesn\'t do introductions," one staffer said. "{first} calls a team meeting."',
    "The first thing {first} did after signing the paperwork was walk the practice facility and shake every hand in the building.",
    '"Everybody in this building answers to a standard now," {first} told reporters. "Mine."',
  ],
  "Competitive Fire": [
    '"I didn\'t buy a franchise to finish .500," {first} said flatly at the introductory press conference.',
    "{first} walked into the war room already talking about a championship window, not a rebuild.",
    '"Second place is just first loser," {first} said, only half-joking.',
  ],
  "Team First": [
    '"This isn\'t my team, it\'s ours," {first} said, gesturing to the room of scouts and staff.',
    "{first} spent the introductory press conference talking about everyone in the building but themselves.",
    '"We win together or we don\'t win at all," {first} said.',
  ],
  Showmanship: [
    "{first} arrived to the introductory press conference to a wall of cameras -- and clearly planned it that way.",
    '"Get used to seeing us on your timeline," {first} said with a grin.',
    "The new owner's first move was picking out the franchise's new city-connect colors.",
  ],
  Composure: [
    "{first} answered every question at the introductory press conference without raising their voice once.",
    '"We\'re not going to panic after Week 1 or celebrate after Week 1," {first} said.',
    'There was no big speech from {first} -- just a quiet, "Let\'s get to work."',
  ],
  "Legacy Drive": [
    '"I want my name on a banner in this building one day," {first} said.',
    "{first} talked less about next season and more about the next decade.",
    '"Dynasties aren\'t built in year one," {first} said, "but they start in year one."',
  ],
};

export const PROSPECT_QUOTE_LINES: Record<PersonaDimension, string[]> = {
  Leadership: [
    '"I don\'t need the armband to lead the huddle," {first} said.',
    "Teammates already point to {first} as the one who sets the tone in walkthroughs.",
    '"Whatever this team needs from me, I\'ll be the one saying it out loud," {first} said.',
  ],
  "Competitive Fire": [
    '"I hate losing more than I like winning," {first} said.',
    "{first} was already trash-talking the depth chart before the ink dried.",
    '"Put me in a fight and I find a way to win it," {first} said.',
  ],
  "Team First": [
    '"I just want to make the guy next to me better," {first} said.',
    "{first} spent the introductory call asking about teammates, not touches.",
    '"Stats are for stat sheets. Wins are for banners," {first} said.',
  ],
  Showmanship: [
    '"Get your cameras ready," {first} said with a smile.',
    "{first} already has a signature celebration picked out.",
    '"I don\'t just want to make plays. I want to make moments," {first} said.',
  ],
  Composure: [
    '"Nothing rattles me. Never has," {first} said evenly.',
    "Coaches already trust {first} in the two-minute drill.",
    '"Chaos is just a math problem I haven\'t solved yet," {first} said.',
  ],
  "Legacy Drive": [
    '"I want this jersey retired one day," {first} said.',
    "{first} is already talking about a bust in the team's Ring of Honor.",
    '"I\'m not here for a season. I\'m here for a legacy," {first} said.',
  ],
};

export function pickLine(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] ?? "";
}
