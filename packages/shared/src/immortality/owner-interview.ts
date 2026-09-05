import { FORMULA_VERSIONS, type PersonaDimension } from "./types.js";
import { seededRandom } from "./matchup-interview.js";
import { STAGE_TO_GROUP, type StageInterviewGroup } from "./stage-interview.js";
import { gameplaySeasonStages, postseasonPayoutStages, type LeagueGame } from "../league-stage.js";

export type OwnerInterviewOption = {
  text: string;
  dnaPoints: Partial<Record<PersonaDimension, number>>;
};

// Owners never have a specific weekly opponent the way a prospect does, so there's no
// matchup/reactive-question system to mirror -- but the questions themselves should still track
// where the league actually is: regular-season grind, playoff stakes, and every offseason beat
// (training camp, roster building, a coaching change, season reflection, quiet offseason months)
// each read very differently coming from an owner. "playoffs" and "regular_season" are this
// pool's own buckets (an owner is never gated out of gameplay weeks the way stage-interview gates
// prospects); every other bucket name is shared 1:1 with StageInterviewGroup (see stage-interview.ts)
// so the two systems describe the league's non-gameplay stages identically.
export type OwnerInterviewGroup = StageInterviewGroup | "regular_season" | "playoffs";

export type OwnerInterviewQuestion = {
  id: number;
  group: OwnerInterviewGroup;
  question: string;
  options: OwnerInterviewOption[];
};

/** Maps the league's current season_stage to an owner-interview bucket -- unlike
 * stageInterviewGroupFor (prospects only), this never returns null for a gameplay stage: it
 * splits gameplay itself into "regular_season" vs "playoffs" (postseasonPayoutStages) so an
 * owner always has content no matter where the league is. */
export function ownerInterviewGroupFor(seasonStage: string, game: LeagueGame): OwnerInterviewGroup | null {
  if (postseasonPayoutStages(game).has(seasonStage)) return "playoffs";
  if (gameplaySeasonStages(game).has(seasonStage)) return "regular_season";
  return STAGE_TO_GROUP[seasonStage] ?? null;
}

function o(id: number, group: OwnerInterviewGroup, question: string, options: OwnerInterviewOption[]): OwnerInterviewQuestion {
  return { id, group, question, options };
}

export const OWNER_INTERVIEW_POOL: OwnerInterviewQuestion[] = [
  // regular_season (24) -- ongoing ownership-perspective questions, safe any week of the season.
  o(1, "regular_season", "What's your top priority as an owner this season?", [
    { text: "Winning it all. Nothing else matters.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Building something that outlasts any one season.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Taking care of the people in this building first.", dnaPoints: { "Team First": 2 } },
    { text: "Giving this fanbase a show worth showing up for.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(2, "regular_season", "How involved do you want to be in personnel decisions?", [
    { text: "Hands-on. My name's on this franchise.", dnaPoints: { Leadership: 2 } },
    { text: "I trust my people to do their jobs.", dnaPoints: { Composure: 2 } },
    { text: "As involved as it takes to win.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Every call I make, I make with the locker room in mind.", dnaPoints: { "Team First": 2 } },
  ]),
  o(3, "regular_season", "A big free agent is available. How aggressive are you in pursuit?", [
    { text: "Whatever it costs. We're not letting this one get away.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Aggressive, but I don't overpay out of panic.", dnaPoints: { Composure: 2 } },
    { text: "Only if he fits the culture we're building.", dnaPoints: { "Team First": 2 } },
    { text: "I want the press conference as much as the player.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(4, "regular_season", "Fans are frustrated after a tough stretch. What's your message?", [
    { text: "I hear you, and I'm not satisfied either.", dnaPoints: { Leadership: 2 } },
    { text: "Stay patient. We're building something real here.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "We're not panicking. The plan doesn't change.", dnaPoints: { Composure: 2 } },
    { text: "Buckle up. We're not done making noise.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(5, "regular_season", "How do you want players to describe working for this franchise?", [
    { text: "Demanding, because I expect a lot.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Like family, first and foremost.", dnaPoints: { "Team First": 2 } },
    { text: "Stable. No drama, just structure.", dnaPoints: { Composure: 2 } },
    { text: "A place where legends are made.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(6, "regular_season", "What's more important to you: short-term wins or building for the future?", [
    { text: "Win now. Championships don't wait.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "The future. I'm building a legacy, not a moment.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever keeps this locker room together.", dnaPoints: { "Team First": 2 } },
    { text: "Both, if I do this right.", dnaPoints: { Leadership: 2 } },
  ]),
  o(7, "regular_season", "How do you handle a coach or system that isn't working?", [
    { text: "I make the hard call before it costs us more.", dnaPoints: { Leadership: 2 } },
    { text: "I give it time. Overreacting costs more than patience.", dnaPoints: { Composure: 2 } },
    { text: "I ask the locker room what they need first.", dnaPoints: { "Team First": 2 } },
    { text: "I want results, and I'll say so publicly.", dnaPoints: { "Competitive Fire": 2 } },
  ]),
  o(8, "regular_season", "What's your spending philosophy on the roster?", [
    { text: "Spend to win. I didn't buy this team to be cheap.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Smart, sustainable spending that lasts years, not one run.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever keeps my locker room whole and happy.", dnaPoints: { "Team First": 2 } },
    { text: "I want the moves that make headlines.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(9, "regular_season", "How do you want this franchise remembered when you're done owning it?", [
    { text: "As a winner. Full stop.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "As a dynasty people study for years.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "As a place people were proud to play for.", dnaPoints: { "Team First": 2 } },
    { text: "As the most entertaining team in the league.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(10, "regular_season", "A star player wants a new contract. How do you approach that?", [
    { text: "I take the lead on that conversation myself.", dnaPoints: { Leadership: 2 } },
    { text: "I stay calm and let the numbers do the talking.", dnaPoints: { Composure: 2 } },
    { text: "I make sure he knows this locker room values him.", dnaPoints: { "Team First": 2 } },
    { text: "I get it done. Stars need to know they're wanted.", dnaPoints: { "Competitive Fire": 2 } },
  ]),
  o(11, "regular_season", "What's your relationship with the locker room like?", [
    { text: "I lead it. They know where I stand.", dnaPoints: { Leadership: 2 } },
    { text: "Close. I want them to feel like this is home.", dnaPoints: { "Team First": 2 } },
    { text: "Professional. I let the coaches coach.", dnaPoints: { Composure: 2 } },
    { text: "They know I'm always watching, always demanding more.", dnaPoints: { "Competitive Fire": 2 } },
  ]),
  o(12, "regular_season", "How do you react when the team underperforms expectations?", [
    { text: "I stay even. Panic doesn't fix anything.", dnaPoints: { Composure: 2 } },
    { text: "I get loud. I want everyone to feel the urgency.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "I check on my people before I check the standings.", dnaPoints: { "Team First": 2 } },
    { text: "I remind everyone we're still building toward something bigger.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(13, "regular_season", "What matters more: analytics or gut instinct in decision-making?", [
    { text: "Gut instinct. I trust what I've seen with my own eyes.", dnaPoints: { Leadership: 2 } },
    { text: "The numbers, every time. That's how you win long-term.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever my people in the building believe in most.", dnaPoints: { "Team First": 2 } },
    { text: "Whichever one makes the better story.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(14, "regular_season", "How do you want to be seen by rival owners?", [
    { text: "As the one they don't want to compete against.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "As someone who's building something that lasts.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "As fair, but absolutely not a pushover.", dnaPoints: { Composure: 2 } },
    { text: "As the most talked-about owner in the league.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(15, "regular_season", "What's the culture you're trying to build here?", [
    { text: "Accountability. Everyone answers for their part.", dnaPoints: { Leadership: 2 } },
    { text: "Family first. We win and lose together.", dnaPoints: { "Team First": 2 } },
    { text: "Relentless. We're never satisfied.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "One that gets remembered long after I'm gone.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(16, "regular_season", "A rebuild is on the table. Are you patient enough for it?", [
    { text: "If it's the right plan, I'll see it all the way through.", dnaPoints: { Composure: 2 } },
    { text: "Patient, but I still want the fanbase to see progress.", dnaPoints: { "Team First": 2 } },
    { text: "I want it done right, even if it takes years.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Honestly? Patience isn't really my thing.", dnaPoints: { "Competitive Fire": 2 } },
  ]),
  o(17, "regular_season", "How do you handle criticism from fans on social media?", [
    { text: "I don't let it rattle me either way.", dnaPoints: { Composure: 2 } },
    { text: "I actually engage with it. This team belongs to the fans too.", dnaPoints: { "Team First": 2 } },
    { text: "I use it as fuel to prove people wrong.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Honestly, I kind of enjoy the back-and-forth.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(18, "regular_season", "What's your approach to the trade deadline?", [
    { text: "Aggressive, if it makes us better right now.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Patient. I don't trade away the future for a headline.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "I check in with the locker room's pulse before I move.", dnaPoints: { "Team First": 2 } },
    { text: "I want the move that gets people talking.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(19, "regular_season", "How do you want your front office staff to operate?", [
    { text: "Decisively. I don't want hesitation in this building.", dnaPoints: { Leadership: 2 } },
    { text: "Calmly. Good decisions rarely come from panic.", dnaPoints: { Composure: 2 } },
    { text: "As a real team, not a hierarchy.", dnaPoints: { "Team First": 2 } },
    { text: "Ambitiously. I want us thinking bigger than everyone else.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(20, "regular_season", "What does success actually look like for this franchise?", [
    { text: "A championship. Nothing less.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "A banner in the rafters that never comes down.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "A locker room that genuinely loves playing here.", dnaPoints: { "Team First": 2 } },
    { text: "Sold-out buildings and a league that can't stop watching us.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(21, "regular_season", "How do you feel about taking risks on unproven talent?", [
    { text: "I'll bet on upside every time.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Calculated risks only, never a reach.", dnaPoints: { Composure: 2 } },
    { text: "If the locker room believes in him, I'm in.", dnaPoints: { "Team First": 2 } },
    { text: "I love the story of a guy nobody else wanted.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(22, "regular_season", "What's your message to the city before the season?", [
    { text: "Get ready. We're not here to just show up.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Thank you for standing behind this franchise.", dnaPoints: { "Team First": 2 } },
    { text: "We're building something you'll be proud of for years.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Buy your tickets. This is going to be a show.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(23, "regular_season", "How much does a rivalry game mean to you personally?", [
    { text: "Everything. I want that win more than any other.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "It's just one game on the schedule to me.", dnaPoints: { Composure: 2 } },
    { text: "It means a lot to this fanbase, so it means a lot to me.", dnaPoints: { "Team First": 2 } },
    { text: "It's the best theater in sports and I want it on national TV.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(24, "regular_season", "What's left to prove for this franchise under your ownership?", [
    { text: "Everything, until there's a trophy in the case.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "That we can build something that outlasts any one era.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "That the people in this building come first, always.", dnaPoints: { "Team First": 2 } },
    { text: "Nothing. I already know what we're building here.", dnaPoints: { Composure: 2 } },
  ]),

  // playoffs (12) -- pressure, stakes, legacy-on-the-line.
  o(25, "playoffs", "The playoffs are here. What's going through your mind?", [
    { text: "Win or it didn't matter.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "This is what building a legacy looks like.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever happens, I'm proud of this locker room.", dnaPoints: { "Team First": 2 } },
    { text: "Buckle up. This is the best time of year.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(26, "playoffs", "How much sleep have you lost this postseason?", [
    { text: "None. I don't let it get to me.", dnaPoints: { Composure: 2 } },
    { text: "Plenty. I want this too badly to relax.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "I've been checking on my players more than myself.", dnaPoints: { "Team First": 2 } },
    { text: "Enough to know how much this means to me.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(27, "playoffs", "What do you say to your team before a win-or-go-home game?", [
    { text: "Leave nothing out there.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Trust everything we've built to get here.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "I remind them I believe in every one of them.", dnaPoints: { "Team First": 2 } },
    { text: "Go put on a show.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(28, "playoffs", "How are you handling the pressure of a deep playoff run?", [
    { text: "I thrive in it.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "One play at a time. Panic doesn't help anyone.", dnaPoints: { Composure: 2 } },
    { text: "I lean on my people around me.", dnaPoints: { "Team First": 2 } },
    { text: "I love every second of the spotlight.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(29, "playoffs", "If this run ends short, how will you judge the season?", [
    { text: "As a failure. We came to win it all.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "By what it built for next year.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "By how this group grew together.", dnaPoints: { "Team First": 2 } },
    { text: "Every season teaches you something. I stay even.", dnaPoints: { Composure: 2 } },
  ]),
  o(30, "playoffs", "What's your message to the fanbase heading into this playoff game?", [
    { text: "Get loud. We need you.", dnaPoints: { "Team First": 2 } },
    { text: "Believe. This is the run.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "We're going to give you a show.", dnaPoints: { Showmanship: 2 } },
    { text: "We expect to win. Simple as that.", dnaPoints: { "Competitive Fire": 2 } },
  ]),
  o(31, "playoffs", "How do you handle a heartbreaking loss in the playoffs?", [
    { text: "It eats at me until we fix it.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "I stay level. Emotion doesn't help the next decision.", dnaPoints: { Composure: 2 } },
    { text: "I make sure my players know it's not on them alone.", dnaPoints: { "Team First": 2 } },
    { text: "I remind everyone this is one chapter, not the whole story.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(32, "playoffs", "What does a championship actually mean to you personally?", [
    { text: "Everything I've worked for.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Proof this program is built the right way.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "A trophy for everyone who bled for this team.", dnaPoints: { "Team First": 2 } },
    { text: "The biggest stage there is, and I want it.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(33, "playoffs", "How involved are you in playoff game-planning?", [
    { text: "Very. I want a hand in every decision right now.", dnaPoints: { Leadership: 2 } },
    { text: "I stay out of the way and trust my coaches.", dnaPoints: { Composure: 2 } },
    { text: "As involved as my locker room needs me to be.", dnaPoints: { "Team First": 2 } },
    { text: "Enough to make sure this story gets told right.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(34, "playoffs", "A rival team is also alive in the playoffs. Do you scoreboard-watch?", [
    { text: "Obsessively. I want to know exactly what's ahead of us.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "I focus on us. The scoreboard sorts itself out.", dnaPoints: { Composure: 2 } },
    { text: "Only because our fans want to know.", dnaPoints: { "Team First": 2 } },
    { text: "I want that matchup. Make it must-see TV.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(35, "playoffs", "What's the biggest lesson this playoff run has taught you as an owner?", [
    { text: "That we're not satisfied with anything less than the top.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "That this thing we're building is real.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "That this locker room fights for each other.", dnaPoints: { "Team First": 2 } },
    { text: "That I handle big moments better than I used to.", dnaPoints: { Composure: 2 } },
  ]),
  o(36, "playoffs", "How do you want history to remember this playoff run?", [
    { text: "As the run that finally got it done.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "As the turning point for this franchise.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "As proof of what this locker room is capable of.", dnaPoints: { "Team First": 2 } },
    { text: "As unforgettable television.", dnaPoints: { Showmanship: 2 } },
  ]),

  // training_camp (12) -- new-season energy, camp battles, expectations.
  o(37, "training_camp", "What's the mood in the building at the start of camp?", [
    { text: "Hungry. Nobody's satisfied with last year.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Focused. We know exactly what we're building toward.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Tight. This locker room genuinely likes each other.", dnaPoints: { "Team First": 2 } },
    { text: "Loud. This is going to be a fun team to watch.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(38, "training_camp", "How closely are you watching position battles in camp?", [
    { text: "Every rep. I want to know who's earning it.", dnaPoints: { Leadership: 2 } },
    { text: "I let the coaches make that call.", dnaPoints: { Composure: 2 } },
    { text: "I care more about who fits the locker room.", dnaPoints: { "Team First": 2 } },
    { text: "Whichever story is more fun to tell.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(39, "training_camp", "What's your camp message to a veteran who might lose his job?", [
    { text: "Earn it like everyone else.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Whatever happens, you'll always matter to this organization.", dnaPoints: { "Team First": 2 } },
    { text: "I stay out of it. That's a coaching decision.", dnaPoints: { Composure: 2 } },
    { text: "You helped build this. That's never forgotten.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(40, "training_camp", "How do you handle a camp injury to a key player?", [
    { text: "It stings, but next man up.", dnaPoints: { Composure: 2 } },
    { text: "I check on him personally.", dnaPoints: { "Team First": 2 } },
    { text: "It just raises the stakes for everyone else.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Every setback's part of a bigger story.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(41, "training_camp", "What are your expectations heading into this season?", [
    { text: "Nothing short of a championship.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Building toward something that lasts.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "A team this city is proud of.", dnaPoints: { "Team First": 2 } },
    { text: "The most entertaining team in the league.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(42, "training_camp", "How do you want your team to be talked about this preseason?", [
    { text: "As the team nobody wants to play.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "As the team everyone's watching.", dnaPoints: { Showmanship: 2 } },
    { text: "As a team that plays for each other.", dnaPoints: { "Team First": 2 } },
    { text: "As a program built the right way.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(43, "training_camp", "A rookie is turning heads in camp. Are you getting excited?", [
    { text: "Absolutely. I love finding the next great one.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Cautiously. Camp stats aren't season stats.", dnaPoints: { Composure: 2 } },
    { text: "I just want him to fit the room.", dnaPoints: { "Team First": 2 } },
    { text: "I want him and I want the attention on him.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(44, "training_camp", "What's your role during joint practices or scrimmages?", [
    { text: "Front row. I want to see it with my own eyes.", dnaPoints: { Leadership: 2 } },
    { text: "I stay back and let the staff run it.", dnaPoints: { Composure: 2 } },
    { text: "Wherever my players can see I showed up.", dnaPoints: { "Team First": 2 } },
    { text: "Wherever the cameras are.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(45, "training_camp", "How do you handle a slow start to training camp?", [
    { text: "It lights a fire under me.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "I don't overreact to August.", dnaPoints: { Composure: 2 } },
    { text: "I check in with the locker room's temperature.", dnaPoints: { "Team First": 2 } },
    { text: "Every camp has its bumps. I trust the process.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(46, "training_camp", "What's one thing you want fixed from last season heading into camp?", [
    { text: "Everything that cost us a chance at the title.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "The stuff that actually matters long-term.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever the locker room says it needs.", dnaPoints: { "Team First": 2 } },
    { text: "Nothing. I want to be even more entertaining.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(47, "training_camp", "How do you set the tone on the first day of camp?", [
    { text: "I make expectations clear immediately.", dnaPoints: { Leadership: 2 } },
    { text: "I keep it steady. No need to overdo it.", dnaPoints: { Composure: 2 } },
    { text: "I make sure everyone feels like they belong.", dnaPoints: { "Team First": 2 } },
    { text: "I make it an event.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(48, "training_camp", "What are you personally most looking forward to this season?", [
    { text: "Winning it all.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Watching this program take another step.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Watching this group grow together.", dnaPoints: { "Team First": 2 } },
    { text: "Every big moment we're about to make.", dnaPoints: { Showmanship: 2 } },
  ]),

  // roster_building (12) -- free agency/draft/trades.
  o(49, "roster_building", "What's your draft-day philosophy?", [
    { text: "Best player available, every time.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Whoever fits the long-term plan.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whoever fits this locker room.", dnaPoints: { "Team First": 2 } },
    { text: "Whoever makes the biggest splash.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(50, "roster_building", "How aggressive are you in free agency this offseason?", [
    { text: "As aggressive as it takes to win now.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Smart and sustainable, not desperate.", dnaPoints: { Composure: 2 } },
    { text: "Aggressive for the right culture fits.", dnaPoints: { "Team First": 2 } },
    { text: "Aggressive enough to make headlines.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(51, "roster_building", "A trade offer comes in for one of your favorite players. What do you do?", [
    { text: "If it makes us better, I make the call.", dnaPoints: { Leadership: 2 } },
    { text: "I don't let sentiment get in the way of the numbers.", dnaPoints: { Composure: 2 } },
    { text: "I talk to the locker room before anything happens.", dnaPoints: { "Team First": 2 } },
    { text: "I want the move that gets people talking either way.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(52, "roster_building", "How do you approach building through the draft versus free agency?", [
    { text: "Whatever wins fastest.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "The draft. That's how you build something that lasts.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever keeps this locker room together longest.", dnaPoints: { "Team First": 2 } },
    { text: "Free agency. I like the big names.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(53, "roster_building", "What do you look for most in a new addition to the roster?", [
    { text: "Talent. Period.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Fit with the culture we've built.", dnaPoints: { "Team First": 2 } },
    { text: "Upside that pays off in three years.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Personality. I want guys people want to watch.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(54, "roster_building", "How do you handle a draft pick that fell to you unexpectedly?", [
    { text: "I take the gift and don't ask questions.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "I trust the board. No panic picks.", dnaPoints: { Composure: 2 } },
    { text: "I check if he fits this locker room first.", dnaPoints: { "Team First": 2 } },
    { text: "I love a story like that.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(55, "roster_building", "What's your stance on paying a positional group at market rate versus value?", [
    { text: "Pay for winning. Always.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Value. Sustainability matters more than one big number.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever keeps my locker room feeling respected.", dnaPoints: { "Team First": 2 } },
    { text: "Whatever gets the bigger headline.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(56, "roster_building", "How do you feel about drafting for need versus best player available?", [
    { text: "Best player. Talent wins games.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Whatever the long-term board says.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever the locker room actually needs.", dnaPoints: { "Team First": 2 } },
    { text: "Whoever's the most fun pick.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(57, "roster_building", "A free agent visits the building. What's your pitch?", [
    { text: "We're building a winner, plain and simple.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Come be part of something that lasts.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "This locker room will feel like family.", dnaPoints: { "Team First": 2 } },
    { text: "Come be part of the show.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(58, "roster_building", "How do you handle a positional battle you inherited through free agency?", [
    { text: "Best guy plays. No exceptions.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "I let it play out. No favorites.", dnaPoints: { Composure: 2 } },
    { text: "I make sure both guys feel valued either way.", dnaPoints: { "Team First": 2 } },
    { text: "I let the story write itself.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(59, "roster_building", "What's the hardest roster decision you've had to make this offseason?", [
    { text: "Letting a competitor walk for cap reasons.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Choosing the future over the present.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Cutting someone who meant a lot to this locker room.", dnaPoints: { "Team First": 2 } },
    { text: "None. I trust my gut on all of it.", dnaPoints: { Composure: 2 } },
  ]),
  o(60, "roster_building", "How much do you value positional versatility when building the roster?", [
    { text: "Highly. It gives us more ways to win.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "It's part of building something sustainable.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "It's about finding guys who'll do anything for the team.", dnaPoints: { "Team First": 2 } },
    { text: "It makes for a more interesting roster.", dnaPoints: { Showmanship: 2 } },
  ]),

  // leadership_change (10) -- a coaching change.
  o(61, "leadership_change", "Why did you make a change at head coach?", [
    { text: "We weren't winning enough. Simple as that.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "It was time for a new direction long-term.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "The locker room needed something different.", dnaPoints: { "Team First": 2 } },
    { text: "I trust my gut, and my gut said it was time.", dnaPoints: { Leadership: 2 } },
  ]),
  o(62, "leadership_change", "What are you looking for in the next head coach?", [
    { text: "A proven winner.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Someone building for the next decade, not just this year.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Someone the locker room will genuinely play for.", dnaPoints: { "Team First": 2 } },
    { text: "Someone I can build a real partnership with.", dnaPoints: { Leadership: 2 } },
  ]),
  o(63, "leadership_change", "How involved will you be in the coaching search?", [
    { text: "Extremely. This decision is mine to get right.", dnaPoints: { Leadership: 2 } },
    { text: "I trust my front office to run point.", dnaPoints: { Composure: 2 } },
    { text: "I want input from the locker room too.", dnaPoints: { "Team First": 2 } },
    { text: "However involved it takes to get this right.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(64, "leadership_change", "What do you say to a fanbase frustrated by a coaching change?", [
    { text: "We're not settling for good enough.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "This is about building the right thing long-term.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "We owe you our best effort at getting this right.", dnaPoints: { "Team First": 2 } },
    { text: "Trust the process. We know what we're doing.", dnaPoints: { Composure: 2 } },
  ]),
  o(65, "leadership_change", "How do you handle the uncertainty a coaching change brings?", [
    { text: "I stay decisive. Hesitation makes it worse.", dnaPoints: { Leadership: 2 } },
    { text: "I stay calm. Panic never fixed anything.", dnaPoints: { Composure: 2 } },
    { text: "I make sure my players feel stability through it.", dnaPoints: { "Team First": 2 } },
    { text: "Uncertainty is part of building something new.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(66, "leadership_change", "What's your relationship like with your outgoing coach?", [
    { text: "Professional and respectful either way.", dnaPoints: { Composure: 2 } },
    { text: "He's part of this program's story, always will be.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "I made sure he knew he mattered here.", dnaPoints: { "Team First": 2 } },
    { text: "I don't dwell on it. I look forward.", dnaPoints: { "Competitive Fire": 2 } },
  ]),
  o(67, "leadership_change", "How do you reassure your locker room during a coaching transition?", [
    { text: "I remind them the standard doesn't change.", dnaPoints: { Leadership: 2 } },
    { text: "I tell them I've got their backs, always.", dnaPoints: { "Team First": 2 } },
    { text: "I keep things steady and let the noise pass.", dnaPoints: { Composure: 2 } },
    { text: "I remind them we're building something bigger than one hire.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(68, "leadership_change", "What did the last coaching staff do right that you want to keep?", [
    { text: "Whatever got us wins, we keep.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "The culture in that locker room, absolutely.", dnaPoints: { "Team First": 2 } },
    { text: "The parts of the plan built for the long haul.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Nothing sentimental. New voice, clean slate.", dnaPoints: { Composure: 2 } },
  ]),
  o(69, "leadership_change", "How patient will you be with the new coaching staff?", [
    { text: "Patient, if the plan's the right one.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Not very. I want results now.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "As patient as my locker room needs me to be.", dnaPoints: { "Team First": 2 } },
    { text: "However patient makes for the better story.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(70, "leadership_change", "What does the ideal coach-owner relationship look like to you?", [
    { text: "I set the standard, he meets it.", dnaPoints: { Leadership: 2 } },
    { text: "True partnership, built on trust.", dnaPoints: { Composure: 2 } },
    { text: "United, for the sake of the locker room.", dnaPoints: { "Team First": 2 } },
    { text: "Whatever gets us the most banners.", dnaPoints: { "Legacy Drive": 2 } },
  ]),

  // season_reflection (12) -- end-of-season recap.
  o(71, "season_reflection", "How do you feel looking back on the season that just ended?", [
    { text: "Unsatisfied. We should've done more.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Proud of what we built, whatever the record says.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Proud of how this locker room stuck together.", dnaPoints: { "Team First": 2 } },
    { text: "It's been a heck of a story to tell.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(72, "season_reflection", "What's the biggest thing you'd change about this past season?", [
    { text: "The losses. All of them.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Nothing. Every step mattered to the bigger picture.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "How we handled our toughest stretch together.", dnaPoints: { "Team First": 2 } },
    { text: "I'd have made it even more entertaining.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(73, "season_reflection", "How do you grade yourself as an owner this season?", [
    { text: "Not good enough until we're champions.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Solid. Building the right thing takes time.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "However my locker room would grade me.", dnaPoints: { "Team First": 2 } },
    { text: "I stay level either way. Grades don't matter, results do.", dnaPoints: { Composure: 2 } },
  ]),
  o(74, "season_reflection", "What are you proudest of from this season?", [
    { text: "However close we got to the top.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "What this program is becoming.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "How this locker room showed up for each other.", dnaPoints: { "Team First": 2 } },
    { text: "Just how much fun this team was to watch.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(75, "season_reflection", "How do you want the fanbase to remember this season?", [
    { text: "As a step toward a championship.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "As part of building something that lasts.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "As a team worth being proud of.", dnaPoints: { "Team First": 2 } },
    { text: "As one of the more entertaining rides in years.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(76, "season_reflection", "What's your message to a locker room that fell short of expectations?", [
    { text: "We get back to work immediately.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "This is one chapter in a much bigger story.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "I'm proud of every one of you, regardless.", dnaPoints: { "Team First": 2 } },
    { text: "Stay even. We learn and move forward.", dnaPoints: { Composure: 2 } },
  ]),
  o(77, "season_reflection", "How do you handle end-of-season exit interviews with your locker room?", [
    { text: "Direct. I want to know what needs to change.", dnaPoints: { Leadership: 2 } },
    { text: "Personally. Every guy matters to me.", dnaPoints: { "Team First": 2 } },
    { text: "Calm. It's a conversation, not a confrontation.", dnaPoints: { Composure: 2 } },
    { text: "Honestly, whichever way gets the best story out of it.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(78, "season_reflection", "What did this season teach you about your own leadership?", [
    { text: "That I need to demand even more.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "That patience really does pay off.", dnaPoints: { Composure: 2 } },
    { text: "That my locker room responds to genuine care.", dnaPoints: { "Team First": 2 } },
    { text: "That I'm building something real here.", dnaPoints: { "Legacy Drive": 2 } },
  ]),
  o(79, "season_reflection", "How do you evaluate which pieces to keep versus rebuild this offseason?", [
    { text: "Whoever gives us the best shot to win now.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Whoever fits the long-term plan.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whoever this locker room trusts and respects.", dnaPoints: { "Team First": 2 } },
    { text: "Whoever fans actually want to keep watching.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(80, "season_reflection", "What's the one lesson from this season you're taking into next year?", [
    { text: "That good enough never actually is.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "That real programs are built brick by brick.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "That this locker room is the strongest thing we have.", dnaPoints: { "Team First": 2 } },
    { text: "That patience under pressure matters most.", dnaPoints: { Composure: 2 } },
  ]),
  o(81, "season_reflection", "How do you want history to remember this era of the franchise?", [
    { text: "As relentless.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "As the foundation for everything after.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "As a locker room that always had each other's back.", dnaPoints: { "Team First": 2 } },
    { text: "As can't-miss television.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(82, "season_reflection", "What are you most excited to build on heading into next season?", [
    { text: "Whatever gets us over the top.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "The foundation we've already laid.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "The bond this locker room has built.", dnaPoints: { "Team First": 2 } },
    { text: "Whatever makes next season even louder.", dnaPoints: { Showmanship: 2 } },
  ]),

  // offseason_general (10) -- culture-building during the quiet stretch.
  o(83, "offseason_general", "How do you spend the quiet stretches of the offseason?", [
    { text: "Studying every angle to get better.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Thinking about where this program is headed long-term.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Checking in personally with my locker room.", dnaPoints: { "Team First": 2 } },
    { text: "Enjoying it. The season will demand enough soon.", dnaPoints: { Composure: 2 } },
  ]),
  o(84, "offseason_general", "What's your involvement like during the quietest part of the calendar?", [
    { text: "Hands-on. I never really turn it off.", dnaPoints: { Leadership: 2 } },
    { text: "Light. I trust my people to handle the day-to-day.", dnaPoints: { Composure: 2 } },
    { text: "Whatever keeps me close to my locker room.", dnaPoints: { "Team First": 2 } },
    { text: "However involved makes the best story.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(85, "offseason_general", "How do you keep the locker room connected during the offseason?", [
    { text: "I don't. Competition drives connection, not downtime.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Team events, check-ins, the little things.", dnaPoints: { "Team First": 2 } },
    { text: "Through the culture we've already built.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "However it makes for the best headlines.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(86, "offseason_general", "What's one offseason project you're personally focused on?", [
    { text: "Whatever closes the gap to a championship.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Something that outlasts this current roster.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Whatever the locker room's asked me for.", dnaPoints: { "Team First": 2 } },
    { text: "Whatever gets people talking about us.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(87, "offseason_general", "How do you handle the quiet criticism that builds up during a long offseason?", [
    { text: "I don't let it get to me.", dnaPoints: { Composure: 2 } },
    { text: "I use it as motivation.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "I care more about my locker room's opinion than outside noise.", dnaPoints: { "Team First": 2 } },
    { text: "I actually enjoy engaging with it.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(88, "offseason_general", "What's your take on the state of the franchise heading into a new year?", [
    { text: "Not satisfied. We want more.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Right where it should be, building steadily.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Strong, because this locker room is strong.", dnaPoints: { "Team First": 2 } },
    { text: "The most exciting it's been in years.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(89, "offseason_general", "How much do you think about the franchise's future beyond this current roster?", [
    { text: "Not much. I focus on winning now.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Constantly. That's the whole point of ownership.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Only as much as it protects this locker room.", dnaPoints: { "Team First": 2 } },
    { text: "Whenever it makes for a better story.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(90, "offseason_general", "What's a value you never compromise on as an owner?", [
    { text: "Winning. Full stop.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Building things the right way, not the fast way.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Taking care of my people first.", dnaPoints: { "Team First": 2 } },
    { text: "Staying level, no matter what's happening.", dnaPoints: { Composure: 2 } },
  ]),
  o(91, "offseason_general", "How do you want to be described by the people who work for you?", [
    { text: "Demanding, but fair.", dnaPoints: { Leadership: 2 } },
    { text: "Someone building something worth being part of.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Someone who always had their back.", dnaPoints: { "Team First": 2 } },
    { text: "The most fun owner in the league to work for.", dnaPoints: { Showmanship: 2 } },
  ]),
  o(92, "offseason_general", "What's the one thing you want this offseason to accomplish?", [
    { text: "Whatever it takes to compete for it all.", dnaPoints: { "Competitive Fire": 2 } },
    { text: "Another real step toward something lasting.", dnaPoints: { "Legacy Drive": 2 } },
    { text: "Keeping this locker room whole and together.", dnaPoints: { "Team First": 2 } },
    { text: "Setting up the most entertaining season yet.", dnaPoints: { Showmanship: 2 } },
  ]),
];

/** Seeded shuffle within one group, excluding anything already answered -- same signature shape
 * as selectStageInterviewQuestions so the two systems stay easy to reason about side by side. */
export function selectOwnerInterviewQuestions(input: {
  pool: OwnerInterviewQuestion[];
  group: OwnerInterviewGroup;
  seed: string;
  count?: number;
  excludeIds?: Iterable<number>;
}): OwnerInterviewQuestion[] {
  const count = input.count ?? 3;
  const excluded = new Set(input.excludeIds ?? []);
  const eligible = input.pool.filter((question) => question.group === input.group && !excluded.has(question.id));
  const rng = seededRandom(input.seed);
  const shuffled = eligible.map((q) => ({ q, sort: rng() })).sort((a, b) => a.sort - b.sort);
  return shuffled.slice(0, count).map((row) => row.q);
}

export type OwnerInterviewAnswerResult = {
  question: OwnerInterviewQuestion;
  option: OwnerInterviewOption;
  dnaPoints: Partial<Record<PersonaDimension, number>>;
  formulaVersion: typeof FORMULA_VERSIONS.ownerInterview;
};

export function scoreOwnerInterviewAnswer(input: { question: OwnerInterviewQuestion; optionIndex: number }): OwnerInterviewAnswerResult {
  const option = input.question.options[input.optionIndex];
  if (!option) throw new Error("Invalid owner interview option index.");
  return {
    question: input.question,
    option,
    dnaPoints: option.dnaPoints,
    formulaVersion: FORMULA_VERSIONS.ownerInterview,
  };
}
