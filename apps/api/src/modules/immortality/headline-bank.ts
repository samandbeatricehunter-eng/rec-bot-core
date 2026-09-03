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
    '"I don\'t need to be the loudest voice in the room. I need to be the most trusted one," {first} said.',
    "{first} spent the first week on the job just listening -- to scouts, to staff, to anyone who'd talk.",
    '"You\'ll know where you stand with me. Always," {first} told the room.',
  ],
  "Competitive Fire": [
    '"I didn\'t buy a franchise to finish .500," {first} said flatly at the introductory press conference.',
    "{first} walked into the war room already talking about a championship window, not a rebuild.",
    '"Second place is just first loser," {first} said, only half-joking.',
    '"Patience is for owners who don\'t know how to win," {first} said.',
    "{first} reportedly asked about the team's playoff odds before asking about the cap situation.",
    '"We\'re not rebuilding. We\'re reloading," {first} said, correcting a reporter mid-question.',
  ],
  "Team First": [
    '"This isn\'t my team, it\'s ours," {first} said, gesturing to the room of scouts and staff.',
    "{first} spent the introductory press conference talking about everyone in the building but themselves.",
    '"We win together or we don\'t win at all," {first} said.',
    "{first}'s first call after closing the deal wasn't to the media -- it was to the equipment staff.",
    '"Every job in this building matters. I mean that," {first} said.',
    "{first} insisted the coaching staff and scouts sit in the front row at the introductory press conference, not the owner's box.",
  ],
  Showmanship: [
    "{first} arrived to the introductory press conference to a wall of cameras -- and clearly planned it that way.",
    '"Get used to seeing us on your timeline," {first} said with a grin.',
    "The new owner's first move was picking out the franchise's new city-connect colors.",
    '"This city deserves a team worth talking about," {first} said, and meant it as a promise.',
    "{first} showed up in franchise gear before the ink on the paperwork had even dried.",
    '"We\'re not just going to win. We\'re going to be fun to watch doing it," {first} said.',
  ],
  Composure: [
    "{first} answered every question at the introductory press conference without raising their voice once.",
    '"We\'re not going to panic after Week 1 or celebrate after Week 1," {first} said.',
    'There was no big speech from {first} -- just a quiet, "Let\'s get to work."',
    '"I\'ve seen enough football to know that overreacting is how good franchises stay average," {first} said.',
    "{first} declined to make any bold predictions at the press conference, just a steady nod and a handshake.",
    '"Ask me again in a year," {first} said, when pushed for a timeline.',
  ],
  "Legacy Drive": [
    '"I want my name on a banner in this building one day," {first} said.',
    "{first} talked less about next season and more about the next decade.",
    '"Dynasties aren\'t built in year one," {first} said, "but they start in year one."',
    '"I want people bringing their kids to games twenty years from now telling them this is when it started," {first} said.',
    "{first} already asked the front office about retired numbers and Ring of Honor criteria in the first meeting.",
    '"History remembers builders, not caretakers," {first} said.',
  ],
};

export const PROSPECT_QUOTE_LINES: Record<PersonaDimension, string[]> = {
  Leadership: [
    '"I don\'t need the armband to lead the huddle," {first} said.',
    "Teammates already point to {first} as the one who sets the tone in walkthroughs.",
    '"Whatever this team needs from me, I\'ll be the one saying it out loud," {first} said.',
    '"If something needs to be said in that locker room, I\'m not waiting for somebody else to say it," {first} said.',
    "{first} was the first one in the building and the last one to leave, every day of camp.",
    '"I lead by showing up right, every single day. The rest takes care of itself," {first} said.',
  ],
  "Competitive Fire": [
    '"I hate losing more than I like winning," {first} said.',
    "{first} was already trash-talking the depth chart before the ink dried.",
    '"Put me in a fight and I find a way to win it," {first} said.',
    '"I don\'t play for participation trophies," {first} said flatly.',
    "{first} reportedly stayed after practice to run extra reps against the scout team, unprompted.",
    '"Somebody\'s got to be the most competitive person in this building. Might as well be me," {first} said.',
  ],
  "Team First": [
    '"I just want to make the guy next to me better," {first} said.',
    "{first} spent the introductory call asking about teammates, not touches.",
    '"Stats are for stat sheets. Wins are for banners," {first} said.',
    '"I don\'t care who gets the credit as long as we get the win," {first} said.',
    "{first} was seen helping a rookie with route-running on their own time, no cameras around.",
    '"This team doesn\'t work if I\'m only worried about my own numbers," {first} said.',
  ],
  Showmanship: [
    '"Get your cameras ready," {first} said with a smile.',
    "{first} already has a signature celebration picked out.",
    '"I don\'t just want to make plays. I want to make moments," {first} said.',
    '"If you\'re not watching, you\'re going to miss something," {first} said with a wink.',
    "{first} reportedly workshopped three different celebrations before landing on the one they'll debut.",
    '"I play this game like the whole world is watching, because eventually it will be," {first} said.',
  ],
  Composure: [
    '"Nothing rattles me. Never has," {first} said evenly.',
    "Coaches already trust {first} in the two-minute drill.",
    '"Chaos is just a math problem I haven\'t solved yet," {first} said.',
    '"I\'ve never once panicked on a football field, and I don\'t plan to start," {first} said.',
    "{first} reportedly has the same pregame routine down to the minute, every single week.",
    '"Pressure is a story people tell themselves. I just play the down in front of me," {first} said.',
  ],
  "Legacy Drive": [
    '"I want this jersey retired one day," {first} said.',
    "{first} is already talking about a bust in the team's Ring of Honor.",
    '"I\'m not here for a season. I\'m here for a legacy," {first} said.',
    '"I want people telling stories about this era for a long time after I\'m gone," {first} said.',
    "{first} keeps a running list, reportedly, of every record they intend to break.",
    '"Play long enough, play well enough, and they have to remember your name," {first} said.',
  ],
};

// Flavor bank for the "answer becomes a headline" content trigger (interview-headline.ts) --
// distinct from the franchise-selection flavor above (title + wrapper paragraph that leads
// into the direct quote), used for both the matchup-interview and stage-interview pools.
export const INTERVIEW_HEADLINE_TEMPLATES: Record<PersonaDimension, { titles: string[]; wrappers: string[] }> = {
  Leadership: {
    titles: ["{first} {last} Speaks Out", "{first} {last} Sets the Tone", "{first} {last} Takes the Mic"],
    wrappers: [
      "{first} {last} didn't mince words when the cameras came on.",
      "When {first} {last} talks, the {team} locker room listens -- and so does everyone else.",
      "{first} {last} chose their words carefully, and every one of them landed.",
    ],
  },
  "Competitive Fire": {
    titles: ["{first} {last} Fires Back", "{first} {last} Isn't Backing Down", "{first} {last} Draws a Line"],
    wrappers: [
      "{first} {last} wasn't in the mood to play it safe with reporters.",
      "{first} {last} looked directly into the cameras and said exactly what was on their mind.",
      "Nobody expected {first} {last} to hold back, and they didn't.",
    ],
  },
  "Team First": {
    titles: ["{first} {last} Puts the Team First", "{first} {last} On the Record for the Locker Room"],
    wrappers: [
      "{first} {last} kept turning the conversation back to the {team} locker room, not themselves.",
      "Even under direct questions, {first} {last} made sure the credit went around the room.",
    ],
  },
  Showmanship: {
    titles: ["{first} {last} Steals the Spotlight", "{first} {last} Gives the Cameras Something to Talk About"],
    wrappers: [
      "{first} {last} knew exactly what soundbite they were leaving reporters with.",
      "Leave it to {first} {last} to turn a routine media session into a headline.",
    ],
  },
  Composure: {
    titles: ["{first} {last} Stays Even", "{first} {last} Keeps It Simple"],
    wrappers: [
      "{first} {last} answered without raising their voice, which somehow made it land harder.",
      "There was nothing dramatic about how {first} {last} said it -- just matter-of-fact and final.",
    ],
  },
  "Legacy Drive": {
    titles: ["{first} {last} Thinks Bigger Picture", "{first} {last} Talks Legacy"],
    wrappers: [
      "{first} {last} wasn't just talking about this week -- they were talking about how this gets remembered.",
      "{first} {last} sounded less like someone answering a question and more like someone writing history.",
    ],
  },
};

export function pickLine(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] ?? "";
}
