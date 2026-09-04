// Rise to Immortality "tweets" feed -- REC Network's four named hosts, plus a rotating pool of
// generic fan/hater accounts, reacting to the week's actual stat lines. Templates use {slot}
// placeholders filled from real data (see tweet-generation.service.ts) rather than one
// fully-authored sentence per output, so a modest authored bank produces hundreds of distinct
// real posts once you multiply it by which player/team/value actually fills each slot on a
// given week -- the same approach roundtable-take-bank.ts/interview-title-bank.ts use for takes
// and interview prompts.

import { PLAYER_CHATTER_TEMPLATES_WAVE2, TWEET_TEMPLATES_WAVE2 } from "./tweet-bank-wave2.js";

export type TweetHostKey = "marcus" | "vaughn" | "elliot" | "darius";
export type TweetAuthor = TweetHostKey | "generic";

// Cloudflare Images account hash is a public identifier baked into every delivery URL (not a
// secret, unlike the API token used to upload) -- see apps/api/scripts/upload-tweet-avatars.ts,
// which uploaded every id referenced below under this same account.
const AVATAR_DELIVERY_BASE = "https://imagedelivery.net/QAGFLBPDqDrzG1Yqj0cQIA";
function avatarUrlFor(imageId: string): string {
  return `${AVATAR_DELIVERY_BASE}/${imageId}/public`;
}

export const TWEET_HOSTS: Record<TweetHostKey, { handle: string; displayName: string; avatarUrl: string }> = {
  marcus: { handle: "@MarcusValeREC", displayName: "Marcus Vale", avatarUrl: avatarUrlFor("rti-tweet-host-marcus") },
  vaughn: { handle: "@VaughnPriceREC", displayName: "Vaughn Price", avatarUrl: avatarUrlFor("rti-tweet-host-vaughn") },
  elliot: { handle: "@ElliotMercerREC", displayName: "Elliot Mercer", avatarUrl: avatarUrlFor("rti-tweet-host-elliot") },
  darius: { handle: "@DariusKingREC", displayName: "Darius King", avatarUrl: avatarUrlFor("rti-tweet-host-darius") },
};

// Jalen Cross was written off the show after a blackmail scandal (see JALEN_DECLINE_LINES below)
// and NFL Front Office is a one-off official-announcement account -- neither reacts to games, so
// neither is a TweetHostKey/part of the reactive template engine. Both stay selectable from the
// commissioner's /tweets command and staticAvatarUrlForHandle below, same as the 4 real hosts.
export type StandaloneAccountKey = "jalen" | "nfl_front_office";
export const STANDALONE_ACCOUNTS: Record<StandaloneAccountKey, { handle: string; displayName: string; avatarUrl?: string }> = {
  jalen: { handle: "@JalenCrossREC", displayName: "Jalen Cross", avatarUrl: avatarUrlFor("rti-tweet-standalone-jalen") },
  nfl_front_office: { handle: "@NFLFrontOfficeHQ", displayName: "NFL Front Office", avatarUrl: avatarUrlFor("rti-tweet-standalone-nfl-front-office") },
};

// Jalen's own posts now, roughly once every couple of days (see queuePersonaAutopostsIfDue in
// tweet-generation.service.ts) -- posted verbatim, no {slot} filling, per Samuel's exact wording.
export const JALEN_DECLINE_LINES: string[] = [
  "Dealing with an active legal matter. No comment at this time.",
  "No new updates on the court date or sentencing.",
  "I'll get out one day. And when I do, watch out.",
  "REC Network! Please! I need some way to earn money for my books when the trial date hits!",
  "Doing shows on OF, please help. I haven't eaten in days.",
  "Don't do drugs, kids, unless you're exposed for blackmail and your life is ruined. If that happens, fuck it.",
  "I used to be high on life. Now I'm just HIGH with NO LIFE.",
  "Elliott, please unblock me. I'll do research for your spots, just help me pay the rent, man.",
  "Guess I'm goin' back to the UK. No American dream over here.",
  "Shit's sad, man, just sad.",
];

// Vaughn's own signature one-liners (distinct from his stat-reaction TWEET_TEMPLATES voice below)
// -- these post on their own ~18h cadence (see queuePersonaAutopostsIfDue), and count toward his
// total-feed-presence cap alongside his regular stat-reaction takes. {player} lines fill from a
// random active prospect the same way queueAmbientFanChatterIfDue already does.
export const VAUGHN_SIGNATURE_LINES: string[] = [
  "Eyes peeled for the next victim on The Price Check -- tune in and turn up.",
  "If the price ain't right, I'm not buyin'. Keep it pushin' playa.",
  "Oooouuuuiiiii!! Wait till' we get in the film room. I got some shit to say about allat.",
  "Jumpin' out the Show-Me State! Grew up off Fuck Around Lane, come find out, killa!",
  "{player} just ain't got the juice like he thought he did.",
  "{player} got the buzzards circling in practice. Shits dead.",
  "{player} keep ballin' like he's been ballin' and he's gonna wind up on Price's Primetime Players list.",
  "Somebody tell {player} the film room don't lie. I already got the clip pulled.",
  "The Price Check don't miss. Neither does {player}, apparently. Fine. I said it.",
  "Y'all sleep on {player} at your own risk. I already had him circled.",
  "Calculated, not chaotic. That's the difference between me and everybody else running their mouth on here.",
  "New segment droppin'. Somebody's flaws about to be real public real soon.",
];

// Cycles through the 20 uploaded generic headshots (rti-tweet-generic-001..020) across the 46
// media/analyst/fan accounts below -- more accounts than unique photos, so a handful of accounts
// share a face, same as any stock-photo-backed account pool.
export function genericAvatarUrl(index: number): string {
  const n = ((index % 20) + 20) % 20;
  return avatarUrlFor(`rti-tweet-generic-${String(n + 1).padStart(3, "0")}`);
}

// Curated 50-account identity catalog (the 4 TWEET_HOSTS above + the 46 below): 15 fictional
// media outlets, 6 parody-named analyst archetypes (deliberately NOT the real broadcasters they
// riff on -- generating ongoing fabricated quotes under a real, identifiable person's actual name
// is a different and worse thing than an original parody persona with the same energy), and 25
// fan/hater accounts with consistent personalities. Replaces the old catalog of bare flavor names
// with real avatar-having identities and a `kind` tag.
export type GenericAccountKind = "media" | "analyst" | "fan";
export const GENERIC_HANDLES: Array<{ handle: string; displayName: string; avatarUrl: string; kind: GenericAccountKind }> = [
  // ================= media outlets (15) =================
  { handle: "@GridironGospel", displayName: "Gridiron Gospel", kind: "media", avatarUrl: genericAvatarUrl(0) },
  { handle: "@RTIRecapRadio", displayName: "RTI Recap Radio", kind: "media", avatarUrl: genericAvatarUrl(1) },
  { handle: "@TheFilmRoomNet", displayName: "The Film Room Network", kind: "media", avatarUrl: genericAvatarUrl(2) },
  { handle: "@ThirdAndLongPod", displayName: "Third & Long Pod", kind: "media", avatarUrl: genericAvatarUrl(3) },
  { handle: "@PylonCamMedia", displayName: "Pylon Cam Media", kind: "media", avatarUrl: genericAvatarUrl(4) },
  { handle: "@RecLeagueWire", displayName: "REC League Wire", kind: "media", avatarUrl: genericAvatarUrl(5) },
  { handle: "@EndZoneEchoNet", displayName: "End Zone Echo", kind: "media", avatarUrl: genericAvatarUrl(6) },
  { handle: "@TwoMinuteTruth", displayName: "Two-Minute Truth", kind: "media", avatarUrl: genericAvatarUrl(7) },
  { handle: "@TrenchWarfareHQ", displayName: "Trench Warfare HQ", kind: "media", avatarUrl: genericAvatarUrl(8) },
  { handle: "@SundayScariesNet", displayName: "Sunday Scaries Network", kind: "media", avatarUrl: genericAvatarUrl(9) },
  { handle: "@NoHuddleNews", displayName: "No-Huddle News", kind: "media", avatarUrl: genericAvatarUrl(10) },
  { handle: "@RedZoneRadioHQ", displayName: "Red Zone Radio", kind: "media", avatarUrl: genericAvatarUrl(11) },
  { handle: "@ImmortalityIndex", displayName: "The Immortality Index", kind: "media", avatarUrl: genericAvatarUrl(12) },
  { handle: "@ChainGangDaily", displayName: "Chain Gang Daily", kind: "media", avatarUrl: genericAvatarUrl(13) },
  { handle: "@BoxScoreBulletin", displayName: "Box Score Bulletin", kind: "media", avatarUrl: genericAvatarUrl(14) },

  // ================= analyst archetypes (6, original parody personas) =================
  { handle: "@PrimeCoverageHQ", displayName: "Prime Coverage", kind: "analyst", avatarUrl: genericAvatarUrl(15) },
  { handle: "@MaxSterlingTalks", displayName: "Maxwell Sterling", kind: "analyst", avatarUrl: genericAvatarUrl(16) },
  { handle: "@CoachCallahanHQ", displayName: "Duke Callahan", kind: "analyst", avatarUrl: genericAvatarUrl(17) },
  { handle: "@ColtonVanceQB", displayName: "Colton Vance", kind: "analyst", avatarUrl: genericAvatarUrl(18) },
  { handle: "@DeuceCarnivalHQ", displayName: "Deuce Carnival", kind: "analyst", avatarUrl: genericAvatarUrl(19) },
  { handle: "@TankReynoldsHQ", displayName: "Tank Reynolds", kind: "analyst", avatarUrl: genericAvatarUrl(0) },

  // ================= fan/hater accounts (25) =================
  { handle: "@ColdTakesOnly", displayName: "Cold Takes Only", kind: "fan", avatarUrl: genericAvatarUrl(1) },
  { handle: "@BleacherBarry", displayName: "Barry from the Bleachers", kind: "fan", avatarUrl: genericAvatarUrl(2) },
  { handle: "@FantasyFraud88", displayName: "Fantasy Fraud Detector", kind: "fan", avatarUrl: genericAvatarUrl(3) },
  { handle: "@TapeDontLie", displayName: "The Tape Don't Lie", kind: "fan", avatarUrl: genericAvatarUrl(4) },
  { handle: "@RookieWallWatch", displayName: "Rookie Wall Watch", kind: "fan", avatarUrl: genericAvatarUrl(5) },
  { handle: "@BoxScoreBandit", displayName: "Box Score Bandit", kind: "fan", avatarUrl: genericAvatarUrl(6) },
  { handle: "@ClipboardCritic", displayName: "The Clipboard Critic", kind: "fan", avatarUrl: genericAvatarUrl(7) },
  { handle: "@PrimeTimeOrBust", displayName: "Prime Time or Bust", kind: "fan", avatarUrl: genericAvatarUrl(8) },
  { handle: "@RedZoneRuiner", displayName: "Red Zone Ruiner", kind: "fan", avatarUrl: genericAvatarUrl(9) },
  { handle: "@SackDanceDaily", displayName: "Sack Dance Daily", kind: "fan", avatarUrl: genericAvatarUrl(10) },
  { handle: "@FranchiseFatigue", displayName: "Franchise Fatigue", kind: "fan", avatarUrl: genericAvatarUrl(11) },
  { handle: "@OverreactionOwl", displayName: "The Overreaction Owl", kind: "fan", avatarUrl: genericAvatarUrl(12) },
  { handle: "@DraftBustAlert", displayName: "Draft Bust Alert", kind: "fan", avatarUrl: genericAvatarUrl(13) },
  { handle: "@CoinCounterRec", displayName: "The Coin Counter", kind: "fan", avatarUrl: genericAvatarUrl(14) },
  { handle: "@GameballGrandma", displayName: "Gameball Grandma", kind: "fan", avatarUrl: genericAvatarUrl(15) },
  { handle: "@LeagueOfficeMole", displayName: "League Office Mole", kind: "fan", avatarUrl: genericAvatarUrl(16) },
  { handle: "@ChainGangChad", displayName: "Chain Gang Chad", kind: "fan", avatarUrl: genericAvatarUrl(17) },
  { handle: "@WaiverWireWitch", displayName: "Waiver Wire Witch", kind: "fan", avatarUrl: genericAvatarUrl(18) },
  { handle: "@HatersHuddle", displayName: "The Haters' Huddle", kind: "fan", avatarUrl: genericAvatarUrl(19) },
  { handle: "@StatSheetStan", displayName: "Stat Sheet Stan", kind: "fan", avatarUrl: genericAvatarUrl(0) },
  { handle: "@BackupQBTruther", displayName: "Backup QB Truther", kind: "fan", avatarUrl: genericAvatarUrl(1) },
  { handle: "@GoalLineGossip", displayName: "Goal Line Gossip", kind: "fan", avatarUrl: genericAvatarUrl(2) },
  { handle: "@CutdayCassie", displayName: "Cutday Cassie", kind: "fan", avatarUrl: genericAvatarUrl(3) },
  { handle: "@FourthQuarterFred", displayName: "Fourth Quarter Fred", kind: "fan", avatarUrl: genericAvatarUrl(4) },
  { handle: "@BlitzPickupBetty", displayName: "Blitz Pickup Betty", kind: "fan", avatarUrl: genericAvatarUrl(5) },
];

// Fixed subset of GENERIC_HANDLES surfaced by the /tweets commissioner command -- a curated
// 4-account picker, not the full 50-account pool ambient chatter draws from at random.
export const MANUAL_TWEET_GENERIC_HANDLES: Array<{ handle: string; displayName: string; avatarUrl: string; kind: GenericAccountKind }> = [
  "@GridironGospel", "@ColdTakesOnly", "@TapeDontLie", "@RTIRecapRadio",
].map((handle) => GENERIC_HANDLES.find((h) => h.handle === handle)!);

export type TweetCategory =
  | "big_pass" | "big_rush" | "big_receiving" | "multi_td" | "turnover_heavy"
  | "def_takeover" | "playmaker" | "quiet_game" | "milestone" | "blowout_win"
  | "close_game" | "bad_loss" | "hype" | "taunt" | "praise" | "camp_buzz";

export type TweetSlots = {
  player?: string;
  team?: string;
  opponent?: string;
  week?: number;
  value?: number;
  statLabel?: string;
  secondValue?: number;
  secondStatLabel?: string;
  score?: string;
  margin?: number;
  /** player_chatter only -- the person being praised/instigated (teammate or rival mode), as
   * opposed to {player}, which is always the author reflecting on their own week. */
  targetPlayer?: string;
  targetTeam?: string;
  targetHandle?: string;
  toHandle?: string;
  toName?: string;
  fromName?: string;
  snippet?: string;
};

// Player-vs-player chatter (tweet-generation.service.ts's queuePlayerChatterAfterImport) --
// real/CPU roster players (never RTI custom prospects, whose tweets only ever come from the
// user's own Media Day choices) occasionally reacting to their own week, hyping a teammate, or
// going at a rival. Distinct axes (mode x tone) from the host/generic TWEET_TEMPLATES above, so
// this gets its own small type/array rather than overloading TweetCategory. {player} is always
// the author reflecting on their own stat line; {targetPlayer}/{targetTeam} are the subject of
// teammate/rival modes only. Filled via the same fillTemplate() as everything else in this file.
export type PlayerChatterMode = "self" | "teammate" | "rival";
export type PlayerChatterTone = "praise" | "instigate";
export type PlayerChatterTemplate = { mode: PlayerChatterMode; tone: PlayerChatterTone; text: string };

export const PLAYER_CHATTER_TEMPLATES: PlayerChatterTemplate[] = [
  // ================= self / praise =================
  { mode: "self", tone: "praise", text: "Told y'all I still had it. {value} {statLabel} today. Not done." },
  { mode: "self", tone: "praise", text: "That's what I do. {value} {statLabel} against {opponent}. Somebody put some respect on it." },
  { mode: "self", tone: "praise", text: "Quietly went for {value} {statLabel} today. Loud enough now?" },
  { mode: "self", tone: "praise", text: "I don't chase numbers but {value} {statLabel} today felt good regardless." },
  { mode: "self", tone: "praise", text: "Been putting in work nobody sees. {value} {statLabel} today is why." },
  { mode: "self", tone: "praise", text: "{value} {statLabel} against {opponent}. Same me, every week." },
  { mode: "self", tone: "praise", text: "Not bragging, just stating facts: {value} {statLabel} today." },
  { mode: "self", tone: "praise", text: "This is what I signed up for. {value} {statLabel} and we're just getting started." },

  // ================= teammate / praise =================
  { mode: "teammate", tone: "praise", text: "Shoutout to {targetPlayer}. Watched him go to work today. Proud to call him a teammate." },
  { mode: "teammate", tone: "praise", text: "{targetPlayer} making it look easy out there. Love playing next to that." },
  { mode: "teammate", tone: "praise", text: "Real ones know what {targetPlayer} did for us today. Respect." },
  { mode: "teammate", tone: "praise", text: "{targetPlayer} put this team on his back today. That's a brother right there." },
  { mode: "teammate", tone: "praise", text: "Can't say enough about {targetPlayer} right now. Special player, better teammate." },
  { mode: "teammate", tone: "praise", text: "{targetPlayer} showing out for {team} today. Let him cook." },
  { mode: "teammate", tone: "praise", text: "Been telling people about {targetPlayer} all year. Y'all seeing it now." },

  // ================= teammate / instigate (friendly banter, not real beef) =================
  { mode: "teammate", tone: "instigate", text: "{targetPlayer} thinks he's funny for that celebration today. I see you though 😂" },
  { mode: "teammate", tone: "instigate", text: "{targetPlayer} owes me dinner after that block that got him going today. just saying." },
  { mode: "teammate", tone: "instigate", text: "{targetPlayer} better share some of that stat sheet love, I set that up 💀" },
  { mode: "teammate", tone: "instigate", text: "not {targetPlayer} acting like he did that all by himself. I see the tape too." },
  { mode: "teammate", tone: "instigate", text: "{targetPlayer} talking his talk in the group chat again. we love him for it though." },

  // ================= rival / instigate =================
  { mode: "rival", tone: "instigate", text: "{targetPlayer} and {targetTeam} got a long film session coming after that. see y'all soon." },
  { mode: "rival", tone: "instigate", text: "somebody tell {targetPlayer} I'm not done with {targetTeam} yet." },
  { mode: "rival", tone: "instigate", text: "{targetPlayer} been quiet since last time we played. wonder why." },
  { mode: "rival", tone: "instigate", text: "{targetTeam} can keep talking. {targetPlayer} knows what happened last time." },
  { mode: "rival", tone: "instigate", text: "I don't forget. {targetPlayer}, see you soon." },
  { mode: "rival", tone: "instigate", text: "{targetPlayer} out here acting comfortable. we'll fix that." },
  { mode: "rival", tone: "instigate", text: "heard {targetTeam} think they're ready for us. {targetPlayer}, tell your team good luck." },
  { mode: "rival", tone: "instigate", text: "{targetPlayer} is good, I said what I said. still coming for that smoke though." },

  // ================= rival / praise (grudging respect) =================
  { mode: "rival", tone: "praise", text: "gotta give it to {targetPlayer}. That's a real one over there at {targetTeam}." },
  { mode: "rival", tone: "praise", text: "{targetPlayer} balling this year, not gonna lie. Respect from one competitor to another." },
  { mode: "rival", tone: "praise", text: "{targetTeam}'s got a problem in {targetPlayer}. I'll say it even though we're not friends." },
  { mode: "rival", tone: "praise", text: "{targetPlayer} earned that today. Doesn't mean I'm not still coming for {targetTeam} though." },
  { mode: "rival", tone: "praise", text: "not gonna lie, {targetPlayer} might be the real deal. see you next time though." },
  { mode: "rival", tone: "praise", text: "{targetPlayer} deserves his flowers. {targetTeam} should be proud. anyway, run it back soon." },
  ...PLAYER_CHATTER_TEMPLATES_WAVE2,
];

/** Static avatar lookup for the fixed host/generic catalogs -- checked first (cheap, sync) before
 * falling back to a DB lookup for player personas (tweet-generation.service.ts's
 * resolveTweetAvatarUrl), since player handles are dynamic and not known at author time here. */
export function staticAvatarUrlForHandle(handle: string): string | undefined {
  const host = Object.values(TWEET_HOSTS).find((h) => h.handle === handle);
  if (host) return host.avatarUrl;
  const standalone = Object.values(STANDALONE_ACCOUNTS).find((h) => h.handle === handle);
  if (standalone?.avatarUrl) return standalone.avatarUrl;
  return GENERIC_HANDLES.find((h) => h.handle === handle)?.avatarUrl;
}

export type TweetTemplate = { category: TweetCategory; voice: TweetAuthor; text: string };

function t(category: TweetCategory, voice: TweetAuthor, text: string): TweetTemplate {
  return { category, voice, text };
}

// {player}/{team}/{opponent}/{week}/{value}/{statLabel}/{secondValue}/{secondStatLabel}/
// {score}/{margin} are filled from TweetSlots by fillTemplate() in tweet-generation.service.ts.
export const TWEET_TEMPLATES: TweetTemplate[] = [
  // ================= big_pass =================
  t("big_pass", "marcus", "{player} put up {value} {statLabel} against {opponent}. One good week doesn't make a season -- I want to see it again before I move him up my board."),
  t("big_pass", "marcus", "{value} yards through the air is real production, but I'm watching whether {player} can repeat that against a defense that actually studies him next."),
  t("big_pass", "marcus", "What I liked about {player}'s {value}-yard week wasn't the total, it was that he stayed patient in the pocket against {opponent} instead of forcing it."),
  t("big_pass", "marcus", "{value} {statLabel} for {player}. Good process, good result. That's the order I want to see it in."),
  t("big_pass", "marcus", "Before anyone crowns {player} off one {value}-yard week against {opponent}, I'd like to see the same operation against a defense with a real pass rush."),
  t("big_pass", "marcus", "{player}'s {value} yards this week is the kind of quiet-efficient outing that doesn't trend but wins you games in December."),
  t("big_pass", "marcus", "Respect the {value}-yard week from {player}, but I still want to see the third-down conversions before I call it a breakout."),
  t("big_pass", "marcus", "{player} distributed the ball well on his way to {value} {statLabel} against {opponent}. That's an offense playing within itself."),
  t("big_pass", "vaughn", "{player} dropped {value} {statLabel} on {opponent} and somewhere a coordinator is explaining a game plan that never had a chance. That's on him, not the guy throwing it."),
  t("big_pass", "vaughn", "{value} yards for {player}? That's not a hot take, that's just math. {opponent}'s secondary lost that argument before it started."),
  t("big_pass", "vaughn", "Don't @ me about {opponent}'s pass defense being \"disguised.\" {value} yards says the disguise didn't work."),
  t("big_pass", "vaughn", "{player} picked {opponent} apart for {value} {statLabel} and made it look like film study, not luck. I see the difference even if you don't."),
  t("big_pass", "vaughn", "Somebody tell {opponent} the tape doesn't lie. {value} {statLabel} for {player} and the excuses are already writing themselves."),
  t("big_pass", "vaughn", "{opponent} played zone against {player} like that was gonna save them. {value} yards later, still didn't."),
  t("big_pass", "vaughn", "{player} looked at {opponent}'s secondary, found the flaw, and lived in it all day. {value} {statLabel}. That's not disrespect, that's preparation."),
  t("big_pass", "vaughn", "I don't want to hear one more word about {opponent}'s defense being top tier. {value} yards allowed to {player} closes that argument for me."),
  t("big_pass", "elliot", "{player}: {value} {statLabel}, {secondValue} {secondStatLabel} this week. That's not noise, that's a real week. The efficiency numbers back it up."),
  t("big_pass", "elliot", "Week {week} update: {player} posted {value} {statLabel}. I'll have the full efficiency breakdown, but the raw total alone clears the bar."),
  t("big_pass", "elliot", "{value} yards is a number. What I want next is the yards-per-attempt and pressure-to-completion split for {player} before I call this a real trend."),
  t("big_pass", "elliot", "{player} at {value} {statLabel} against {opponent} -- I'll have the down-and-distance splits in the next report, but the surface number alone is a clear outlier week."),
  t("big_pass", "elliot", "Logging {player}'s {value}-yard week for the season model. One data point, but a meaningful one."),
  t("big_pass", "elliot", "{player}'s {value} {statLabel} this week moves his per-game average in a direction worth actually tracking going forward."),
  t("big_pass", "darius", "{player} was seeing the field before the snap even happened against {opponent}. {value} {statLabel} is what pre-snap recognition turns into."),
  t("big_pass", "darius", "You can tell {player} trusted his reads all game -- {value} yards doesn't happen if you're hesitating in the pocket."),
  t("big_pass", "darius", "{opponent} showed {player} disguised coverage all game and he still finished with {value} {statLabel}. That's a quarterback playing off answers, not memory."),
  t("big_pass", "generic", "{player} really said {value} yards and went home. Somebody check on {opponent}'s DBs."),
  t("big_pass", "generic", "{player} cooking today. {value} {statLabel}. That's it, that's the tweet."),
  t("big_pass", "generic", "not {player} throwing for {value} against {opponent} like it's nothing 💀"),
  t("big_pass", "generic", "{opponent} secondary really let {player} throw for {value} yards. embarrassing honestly."),
  t("big_pass", "generic", "{player} is not a real person. {value} {statLabel} today alone."),
  t("big_pass", "generic", "somebody wake {opponent}'s safeties up. {player} just went for {value}."),
  t("big_pass", "generic", "{value} yards from {player} and he looked bored doing it."),
  t("big_pass", "generic", "the {player} slander needs to stop after this. {value} {statLabel} against {opponent}."),

  // ================= big_rush =================
  t("big_rush", "marcus", "{value} rushing yards from {player} this week. That's an offensive line doing its job as much as it is a runner doing his."),
  t("big_rush", "marcus", "{player}'s {value}-yard week wasn't one long house call, it was sustained, down-after-down production. That's the version I trust going forward."),
  t("big_rush", "marcus", "I'll credit {player} for {value} yards, but I want the film before I decide how much of that was scheme versus the runner himself."),
  t("big_rush", "marcus", "{value} yards on the ground for {player}. Discipline in his reads, patience behind his blocks. That travels."),
  t("big_rush", "marcus", "A {value}-yard week from {player} against {opponent} is a real building block if the offensive line can repeat that push."),
  t("big_rush", "vaughn", "{player} ran through {opponent} for {value} yards and I promise you it wasn't all the O-line. Some of that's just want-to."),
  t("big_rush", "vaughn", "{opponent} couldn't tackle {player} today. {value} yards. That's not scheme, that's a want-to problem and everybody in that building knows it."),
  t("big_rush", "vaughn", "{player} treated {opponent}'s front seven like a warm-up drill. {value} rushing yards. Eyes peeled for the next victim."),
  t("big_rush", "vaughn", "I don't need {opponent} to explain the {value} yards. I already watched the tape. Y'all should too."),
  t("big_rush", "vaughn", "{value} yards for {player} and {opponent} never landed a clean shot. That's not variance, that's a mismatch somebody should've caught in the film room."),
  t("big_rush", "elliot", "{player}'s {value} rushing yards this week push his season pace into territory worth actually tracking. I'll have the full number next update."),
  t("big_rush", "elliot", "Logging a {value}-yard week for {player}. Yards after contact will tell us if this was O-line push or the runner himself -- report incoming."),
  t("big_rush", "elliot", "{value} yards on the ground for {player} against {opponent}. That's a real per-carry outlier, not just volume."),
  t("big_rush", "darius", "You can see it on tape before you see it in the box score -- {player} was getting movement at the point of attack all game. {value} yards is the receipt, not the story."),
  t("big_rush", "darius", "{player} was reading his blocks a half-second faster than usual today. {value} yards is what that half-second buys you."),
  t("big_rush", "darius", "{opponent} was in the right gaps most of the game and {player} still found {value} yards. That's vision, not scheme."),
  t("big_rush", "generic", "{player} broke {opponent} in half today. {value} yards. RUN IT BACK."),
  t("big_rush", "generic", "{player} out here playing a different sport than everyone else. {value} rush yards 😤"),
  t("big_rush", "generic", "{opponent} could NOT bring {player} down. {value} yards. actually unfair."),
  t("big_rush", "generic", "{value} rushing yards from {player}?? somebody sub him out he's embarrassing people."),
  t("big_rush", "generic", "{player} running through arm tackles like they're not even there. {value} yards vs {opponent}."),
  t("big_rush", "generic", "{opponent} fans are quiet after {player} dropped {value} yards on them."),

  // ================= big_receiving =================
  t("big_receiving", "marcus", "{player} had a real day -- {value} {statLabel}. The question is whether that's a matchup win or a repeatable role."),
  t("big_receiving", "marcus", "{value} {statLabel} for {player} against {opponent}. I want to see the target share stay consistent before I call this his new normal."),
  t("big_receiving", "marcus", "Clean route work from {player} on his way to {value} {statLabel}. That's the kind of week that earns more targets next time out."),
  t("big_receiving", "marcus", "{player}'s {value}-{statLabel} week is a good sign, but one matchup rarely tells the whole story at that position."),
  t("big_receiving", "vaughn", "{opponent}'s coverage plan for {player} today was hope. {value} {statLabel}. Hope's not a scheme, that's a flaw."),
  t("big_receiving", "vaughn", "{player} was open all game and {opponent} never adjusted. {value} {statLabel}. That's a coordinator who didn't dial it in."),
  t("big_receiving", "vaughn", "{value} {statLabel} for {player} and {opponent}'s secondary looked like strangers out there. I noticed. Everybody noticed."),
  t("big_receiving", "vaughn", "{player} put {opponent}'s coverage unit on notice today. {value} {statLabel}. That tape doesn't get buried."),
  t("big_receiving", "vaughn", "Somebody explain how {player} finishes with {value} {statLabel} against a defense that \"prepared all week.\" I'll wait."),
  t("big_receiving", "elliot", "{player}: {value} {statLabel} in Week {week}. Target volume and per-catch value both matter here -- I'll have the split next report."),
  t("big_receiving", "elliot", "{value} {statLabel} for {player}. I want to see the separation numbers before deciding if that's a coverage bust or real route-running gains."),
  t("big_receiving", "elliot", "Logging {player}'s {value}-{statLabel} week. If the target share holds, this becomes a real season-long signal, not a one-off."),
  t("big_receiving", "darius", "{player} was winning his release before the ball was even out. {value} {statLabel} is what clean releases turn into."),
  t("big_receiving", "darius", "{player} sold that route so well {opponent}'s corner bit on the double move. {value} {statLabel} says the rest."),
  t("big_receiving", "darius", "{opponent} had eyes on {player} most of the game and he still finished with {value} {statLabel}. That's technique beating attention."),
  t("big_receiving", "generic", "{player} was WIDE open all game and {opponent} never adjusted. {value} {statLabel}."),
  t("big_receiving", "generic", "{player} really just cooked {opponent}'s secondary for {value} {statLabel} like it was nothing."),
  t("big_receiving", "generic", "{opponent} needs a new coverage plan after {player} went for {value} {statLabel} today."),
  t("big_receiving", "generic", "{value} {statLabel} for {player}?! somebody get him more targets immediately."),

  // ================= multi_td =================
  t("multi_td", "marcus", "{player} found the end zone multiple times against {opponent}. Good football. I'd still like to see the full game before calling it a trend."),
  t("multi_td", "marcus", "Multiple scores for {player} this week -- what I actually liked was how unhurried he looked doing it."),
  t("multi_td", "marcus", "{player}'s multi-touchdown week against {opponent} is a good building block, provided the offense keeps finding him in those situations."),
  t("multi_td", "marcus", "Good week in the red zone for {player}. That's a decision-maker doing his job when it matters most."),
  t("multi_td", "marcus", "{player} scoring multiple times this week is encouraging -- I want to see if the offense can manufacture those same looks against a better defense."),
  t("multi_td", "vaughn", "{player} scored more than once on {opponent} and never even looked winded doing it. That's a problem somebody didn't fix."),
  t("multi_td", "vaughn", "{opponent} let {player} in the end zone MULTIPLE times. That's not one mistake, that's a pattern, and patterns get exposed on The Price Check."),
  t("multi_td", "vaughn", "{player} is treating the end zone like his own address. {opponent} has real questions to answer."),
  t("multi_td", "vaughn", "How's {player} scoring more than once in the same game against {opponent}? Ain't nobody stopping him. Somebody get in the film room."),
  t("multi_td", "vaughn", "{player}'s multi-TD weeks are becoming a real problem for whoever plays {opponent} next. Write that down."),
  t("multi_td", "elliot", "Multi-touchdown week for {player}. Scoring efficiency like that doesn't happen by accident -- I'll have the red-zone rate in the next report."),
  t("multi_td", "elliot", "{player} logging multiple scores against {opponent} this week. Red-zone opportunity share is what I'll be checking next."),
  t("multi_td", "elliot", "Two-plus-touchdown weeks are a strong signal at any position. Adding {player}'s to the tracker."),
  t("multi_td", "darius", "{player} wasn't just scoring, he was finishing. That's the difference between a good week and a great one."),
  t("multi_td", "darius", "{player} made the tough, contested catches AND the easy ones this week. That's a complete performance, not a lucky one."),
  t("multi_td", "darius", "Multiple scores for {player} against {opponent} -- he was finishing through contact, not just finding soft grass."),
  t("multi_td", "generic", "{player} in the end zone AGAIN. {opponent} needs to answer some questions on Monday."),
  t("multi_td", "generic", "{player} treating the goal line like his personal apartment this week."),
  t("multi_td", "generic", "how many times is {player} allowed to score in one game against {opponent}?? asking for a friend."),
  t("multi_td", "generic", "{player} multi-TD games should be illegal at this point. {opponent} fans I'm so sorry."),
  t("multi_td", "generic", "{player} scored TWICE and I still don't think he broke a sweat."),
  t("multi_td", "generic", "not {opponent} letting {player} into the end zone more than once. couldn't be me."),

  // ================= turnover_heavy =================
  t("turnover_heavy", "marcus", "{player} put the ball on the ground more than once against {opponent}. Talent isn't the question there -- decision-making under pressure is."),
  t("turnover_heavy", "marcus", "Rough week with the ball for {player}. I'd want to see him bounce back clean next week before I read too much into it."),
  t("turnover_heavy", "marcus", "{value} turnovers is a correctable problem, not a character problem. I want to see the fix next week, not an excuse."),
  t("turnover_heavy", "marcus", "{player}'s turnover week against {opponent} is the kind of thing good coaching staffs fix with reps, not benchings."),
  t("turnover_heavy", "marcus", "Every good player has a week like this. What matters is whether {player} tightens it up or it becomes a pattern."),
  t("turnover_heavy", "vaughn", "{player} tried to hand the game to {opponent} and almost got away with it. That's a flaw, not bad luck, and I'm calling it what it is."),
  t("turnover_heavy", "vaughn", "{value} turnovers from {player}? That's going straight to the film room and it ain't gonna be pretty."),
  t("turnover_heavy", "vaughn", "{player} was out here doing {opponent}'s job for them. {value} turnovers. Somebody's getting checked on."),
  t("turnover_heavy", "vaughn", "I don't care how good last week was. {player} handing {opponent} {value} turnovers erases the goodwill fast. That's how this works."),
  t("turnover_heavy", "vaughn", "{player} played hero ball against {opponent} and it cost him {value} turnovers. Pick a lane or get exposed."),
  t("turnover_heavy", "elliot", "Turnover-worthy plays are the single most predictive bad-week indicator we track. {player} had a rough one there -- the number doesn't lie."),
  t("turnover_heavy", "elliot", "{value} turnovers for {player} this week. I'll have the pressure-rate context in the next report, but the raw number alone is concerning."),
  t("turnover_heavy", "elliot", "Logging {player}'s {value}-turnover week. One bad week rarely predicts the next, but it's worth tracking if it repeats."),
  t("turnover_heavy", "darius", "Some of that was {opponent} making a play. Some of that was {player} trying to force something that wasn't there. Both things can be true."),
  t("turnover_heavy", "darius", "{player} was trying to make something out of nothing on a couple of those. Sometimes the right answer is throwing it away."),
  t("turnover_heavy", "darius", "I watched the tape -- {opponent} disguised well on at least one of {player}'s turnovers. Not all {value} were on him."),
  t("turnover_heavy", "generic", "{player} really said \"let me give {opponent} the ball\" TWICE today. Rough one."),
  t("turnover_heavy", "generic", "someone check on {player}, he had a day out there."),
  t("turnover_heavy", "generic", "{value} turnovers from {player}?? {opponent} thanks you for the assist."),
  t("turnover_heavy", "generic", "not {player} just handing the ball to {opponent} like it's a gift exchange."),
  t("turnover_heavy", "generic", "rough day at the office for {player}. {value} turnovers. we've all been there... kind of."),

  // ================= def_takeover =================
  t("def_takeover", "marcus", "{player} controlled that game defensively. {value} {statLabel} against {opponent} is the kind of week that actually shows up on film for the rest of the season."),
  t("def_takeover", "marcus", "{value} {statLabel} for {player}. That's a defender setting the tone early and the offense adjusting around him."),
  t("def_takeover", "marcus", "I want to see {player} repeat that {value}-{statLabel} week before I call it a real level-up, but it's an encouraging sign."),
  t("def_takeover", "marcus", "{player}'s {value} {statLabel} against {opponent} is exactly the kind of down-to-down consistency that wins a defense a reputation."),
  t("def_takeover", "vaughn", "{player} made {opponent}'s offense look lost in the mud. {value} {statLabel}. That's a flaw in the protection somebody's gonna have to answer for."),
  t("def_takeover", "vaughn", "{opponent}'s OC needs to explain {player}'s {value} {statLabel} in the presser. I already know what he's gonna say and it won't hold up."),
  t("def_takeover", "vaughn", "{player} wasn't letting {opponent} have a good day. {value} {statLabel}. That's disrespectful and I respect it."),
  t("def_takeover", "vaughn", "{value} {statLabel} for {player}? {opponent}'s offense owes him a thank-you card for all that free film."),
  t("def_takeover", "elliot", "{player} logged {value} {statLabel} this week. That's a real production spike -- worth tracking whether it's matchup-driven or a genuine role change."),
  t("def_takeover", "elliot", "{value} {statLabel} for {player} against {opponent}. I'll have the snap-share context next report, but that raw total is a clear outlier."),
  t("def_takeover", "elliot", "Adding {player}'s {value}-{statLabel} week to the tracker. If it repeats even once more, that's a real trend, not a fluke matchup."),
  t("def_takeover", "darius", "{player} was in the backfield before the ball was even out half the time. {value} {statLabel} tells you what the tape already showed."),
  t("def_takeover", "darius", "{player} was reading the play before it developed all game. {value} {statLabel} against {opponent} is recognition, not just effort."),
  t("def_takeover", "darius", "You could see {opponent} start avoiding {player}'s side by the second half. {value} {statLabel} and he was still affecting plays away from him."),
  t("def_takeover", "generic", "{player} was NOT letting {opponent} breathe today. {value} {statLabel}. Absolute menace."),
  t("def_takeover", "generic", "{player} playing a completely different game than everyone else out there. {value} {statLabel}."),
  t("def_takeover", "generic", "{opponent}'s offensive line has some explaining to do after {player}'s {value}-{statLabel} day."),
  t("def_takeover", "generic", "{value} {statLabel} from {player}?? somebody give that man the game ball."),

  // ================= playmaker =================
  t("playmaker", "marcus", "{player} came up with a real momentum-swinging play against {opponent}. That's the kind of thing that wins close games later in the year."),
  t("playmaker", "marcus", "Good situational awareness from {player} to come up with that takeaway. Those plays are earned, not lucky."),
  t("playmaker", "marcus", "{player}'s takeaway against {opponent} is the kind of winning-football play that doesn't always show up in the box score story."),
  t("playmaker", "marcus", "That's a veteran-caliber read from {player}. He saw it before it happened and made {opponent} pay for it."),
  t("playmaker", "vaughn", "{player} took the ball AND the momentum from {opponent} on the same play. That's not luck, that's somebody who studied."),
  t("playmaker", "vaughn", "{opponent} wasn't ready for {player} to make that play. Not even a little. That's a scouting flaw right there."),
  t("playmaker", "vaughn", "{player} single-handedly flipped that whole game against {opponent}. One play. I don't need ten more to make my point."),
  t("playmaker", "vaughn", "Somebody check on {opponent}'s sideline after that play from {player}. Rough spot to be in."),
  t("playmaker", "elliot", "Takeaway from {player} this week. Turnover margin is one of the strongest predictors we have for who's actually winning close games."),
  t("playmaker", "elliot", "Logging {player}'s takeaway against {opponent}. Individual playmaking rate is a real, trackable skill -- not just variance."),
  t("playmaker", "elliot", "{player} generating a takeaway this week matters more to the win column than most people realize. I'll have the full impact number next report."),
  t("playmaker", "darius", "{player} read that play before it happened. That's not luck, that's recognition -- the kind you can't coach into somebody."),
  t("playmaker", "darius", "{player} trusted what he saw pre-snap and it paid off against {opponent}. That's the whole ballgame right there."),
  t("playmaker", "darius", "That wasn't hustle, that was anticipation. {player} was moving before {opponent} even committed."),
  t("playmaker", "generic", "{player} just ended a drive AND a career with that play on {opponent}."),
  t("playmaker", "generic", "{player} really said \"not today\" and took it from {opponent}. LOVE to see it."),
  t("playmaker", "generic", "{opponent} fans went SILENT after {player} made that play. instant."),
  t("playmaker", "generic", "{player} with the play of the week, no debate needed."),

  // ================= quiet_game =================
  t("quiet_game", "marcus", "{player} didn't have much of a stat line against {opponent} this week. One quiet week means very little on its own -- I'll wait for a pattern before I say more."),
  t("quiet_game", "marcus", "Not every week is a headline week for {player}, and that's fine. I'm more interested in the next three than this one."),
  t("quiet_game", "marcus", "{player}'s quiet week against {opponent} isn't a red flag on its own. I'll be watching how the offense responds next week."),
  t("quiet_game", "vaughn", "{player} was a ghost against {opponent} today. If that's a trend and not a matchup, we're gonna have a real conversation about it."),
  t("quiet_game", "vaughn", "Where was {player} today? {opponent} basically played that game by themselves."),
  t("quiet_game", "vaughn", "I'm not calling it a slump yet. But {player}'s quiet week against {opponent} is going in my notes, and I don't forget what's in my notes."),
  t("quiet_game", "elliot", "Low-volume week for {player}. Could be game-plan driven, could be matchup driven -- one data point isn't enough to separate those yet."),
  t("quiet_game", "elliot", "Logging a quiet week for {player}. I'll flag it if it repeats -- one week is noise, two starts to be signal."),
  t("quiet_game", "darius", "Sometimes a quiet box score means {opponent} took something away and {player} didn't force it. That's actually the right decision, even if it doesn't show up in the numbers."),
  t("quiet_game", "darius", "{opponent} game-planned specifically for {player} this week, and to his credit, he didn't force anything that wasn't there."),
  t("quiet_game", "generic", "where was {player} today? {opponent} had that one locked down."),
  t("quiet_game", "generic", "quiet week for {player}. hope everything's alright over there."),
  t("quiet_game", "generic", "{opponent} really shut {player} down today. didn't expect that."),

  // ================= milestone =================
  t("milestone", "marcus", "{player} crossed {value} {statLabel} on the season. That's a real, sustained body of work -- not a single big week inflating a number."),
  t("milestone", "marcus", "{value} {statLabel} for {player} through Week {week}. That's the kind of quiet consistency that gets overlooked until you actually add it up."),
  t("milestone", "marcus", "Crossing {value} {statLabel} isn't flashy, but it's the mark of a player who's been available and productive all year."),
  t("milestone", "marcus", "{player} hitting {value} {statLabel} on the season is a good marker of where his role has settled -- worth watching if it keeps climbing."),
  t("milestone", "vaughn", "{player} hit {value} {statLabel} on the season and the league still hasn't clocked it. They will after this."),
  t("milestone", "vaughn", "{value} {statLabel} on the season for {player}? That's a whole season of disrespect for whoever's covering him next."),
  t("milestone", "vaughn", "Put some respect on {player}'s name. {value} {statLabel} through Week {week} is not a small number and I'm not letting it slide by quiet."),
  t("milestone", "vaughn", "{player} quietly climbing to {value} {statLabel} while nobody's talking about him is exactly how you sneak up and win a league."),
  t("milestone", "elliot", "Milestone check: {player} is now at {value} {statLabel} through Week {week}. I'll have the full season pace projection in the next report."),
  t("milestone", "elliot", "{player} crossing {value} {statLabel} on the season keeps him on pace for a real career-year number if the volume holds."),
  t("milestone", "elliot", "Logging the {value}-{statLabel} threshold for {player}. Round numbers don't matter mathematically, but they're a clean checkpoint for the season model."),
  t("milestone", "darius", "{value} {statLabel} on the season for {player}. Numbers like that come from being trusted with the ball snap after snap -- that trust was earned."),
  t("milestone", "darius", "{player} getting to {value} {statLabel} this year isn't an accident. That's a coaching staff that believes in him and a player cashing it in."),
  t("milestone", "generic", "{player} just hit {value} {statLabel} on the season?! Immortality watch is ON."),
  t("milestone", "generic", "{value} {statLabel} and counting for {player}. Somebody update the record boards."),
  t("milestone", "generic", "{player} quietly at {value} {statLabel} this year and nobody's talking about it enough."),
  t("milestone", "generic", "{value} {statLabel} through Week {week} for {player}. remember this tweet."),

  // ================= blowout_win =================
  t("blowout_win", "marcus", "{team} controlled that game from start to finish against {opponent}, final {score}. That's the kind of complete performance you build a season around."),
  t("blowout_win", "marcus", "{team}'s {score} win over {opponent} was as complete a performance as you'll see -- offense, defense, and situational football all clicking."),
  t("blowout_win", "marcus", "A margin like {margin} points doesn't happen by accident. {team} did everything right against {opponent} this week."),
  t("blowout_win", "vaughn", "{team} did not come to play nice with {opponent} today. {score} final. Somebody's getting exposed in that film room tonight."),
  t("blowout_win", "vaughn", "{team} embarrassed {opponent} {score} and I don't think {opponent} has an answer for that yet."),
  t("blowout_win", "vaughn", "{opponent} shouldn't have even shown up today. {team} {score}. That's just the truth."),
  t("blowout_win", "vaughn", "{team} put {opponent} in the record books for the wrong reason. {score}. Brutal, and I mean that."),
  t("blowout_win", "elliot", "{team} {score} over {opponent}. A margin like that usually means the underlying efficiency gap was even bigger than the score shows."),
  t("blowout_win", "elliot", "Logging {team}'s {margin}-point win over {opponent}. That kind of margin correlates strongly with real, not lucky, team strength."),
  t("blowout_win", "darius", "{team} took {opponent}'s will away by the second quarter. {score}. That's the mark of a team that's confident in what it's doing."),
  t("blowout_win", "generic", "{team} just embarrassed {opponent} {score}. Screenshot this."),
  t("blowout_win", "generic", "not {team} putting up {score} on {opponent}. that's disrespectful."),
  t("blowout_win", "generic", "{opponent} fans, I am so sorry about that {score} loss. truly."),
  t("blowout_win", "generic", "{team} {score}?! somebody check on {opponent}'s locker room."),

  // ================= close_game =================
  t("close_game", "marcus", "{team} found a way to win a tight one against {opponent}, {score}. Those are the games that separate contenders from pretenders later in the year."),
  t("close_game", "marcus", "A {margin}-point win over {opponent} isn't dominant, but {team} did what good teams do -- found a way."),
  t("close_game", "marcus", "{team}'s {score} win over {opponent} won't look pretty in the box score, but close wins build the habits you need in the postseason."),
  t("close_game", "vaughn", "{team} survived {opponent} {score}. Survived. Barely. I'm not gonna pretend that was dominant, because it wasn't."),
  t("close_game", "vaughn", "{team} made that way harder than it needed to be against {opponent}. {score}. A win's a win, but that's a flaw somebody needs to fix."),
  t("close_game", "vaughn", "{opponent} had {team} on the ropes and let 'em off. {score}. That's gonna sting when they watch it back."),
  t("close_game", "elliot", "{team} {score} over {opponent}. A margin that thin usually means the box score is closer to a coin flip than the standings will show."),
  t("close_game", "elliot", "Logging a {margin}-point game between {team} and {opponent}. Close margins are the noisiest data points we track -- I wouldn't overreact either direction."),
  t("close_game", "darius", "{team} made the one more play than {opponent} did when it mattered. {score}. That's the whole ballgame right there."),
  t("close_game", "darius", "That game came down to who wanted it more in the fourth quarter, and {team} answered that question against {opponent}."),
  t("close_game", "generic", "my heart cannot take {team} vs {opponent} games. {score}. I need a minute."),
  t("close_game", "generic", "{team} escaping with a {score} win over {opponent} and I aged ten years watching it."),
  t("close_game", "generic", "{score}?! that {team} vs {opponent} game was NOT for the faint of heart."),

  // ================= bad_loss =================
  t("bad_loss", "marcus", "{team} has real questions to answer after {score} against {opponent}. I'd want to see the full game before drawing conclusions, but that's a rough result."),
  t("bad_loss", "marcus", "A {margin}-point loss to {opponent} isn't the end of a season, but {team} needs a real response next week, not excuses."),
  t("bad_loss", "marcus", "{team} didn't have an answer for {opponent} today, {score}. The tape will tell us whether that's fixable or a real problem."),
  t("bad_loss", "vaughn", "{team} lost to {opponent} {score} and I've got questions that aren't going away. That's not a bad week, that's a bad week people bring up all season."),
  t("bad_loss", "vaughn", "{team} really lost to {opponent} {score}? Not the {team} I had ranked top 5 last week. Somebody explain that flaw to me."),
  t("bad_loss", "vaughn", "Somebody walk me through {team}'s {score} loss to {opponent}, because I've been staring at that box score and it still doesn't add up."),
  t("bad_loss", "vaughn", "{team} fans, I know it's rough, but {score} against {opponent} is not something I'm gonna sugarcoat for you."),
  t("bad_loss", "elliot", "{team} {score} vs {opponent}. I'll need the underlying numbers before I call this a trend, but the scoreboard alone isn't good."),
  t("bad_loss", "elliot", "Logging {team}'s {margin}-point loss to {opponent}. One bad week rarely predicts the next, but it's worth watching if it repeats."),
  t("bad_loss", "darius", "{team} didn't lose because {opponent} was unstoppable. They lost because they didn't answer the adjustments. That's coachable."),
  t("bad_loss", "generic", "{team} really lost to {opponent} {score}?? not the {team} I had ranked top 5 last week 💀"),
  t("bad_loss", "generic", "{team} fans are quiet after that {score} loss to {opponent}. Understandably."),
  t("bad_loss", "generic", "{team} needs to have a team meeting after that {score} loss to {opponent}. immediately."),

  // ================= hype =================
  t("hype", "marcus", "Week {week} is in the books. Some real football was played -- I'll have the full breakdown once every result is in."),
  t("hype", "marcus", "A good week of football across the league. I'll have my full notes once I've been through every box score."),
  t("hype", "marcus", "Week {week} had a little bit of everything. Give me a day and I'll separate the real signals from the noise."),
  t("hype", "vaughn", "Week {week} delivered. There's about to be some real uncomfortable conversations once people actually watch the tape."),
  t("hype", "vaughn", "I've got takes after Week {week} and none of 'em are gonna be popular. That's kind of the whole point."),
  t("hype", "vaughn", "Week {week} humbled a lot of people who were talking real confident last week. Names are coming. Eyes peeled."),
  t("hype", "elliot", "Week {week} data is in. Give me a little time and I'll have the numbers that actually explain what just happened."),
  t("hype", "elliot", "Full Week {week} stat pull is done. The box scores tell a very different story than the group chats do, as usual."),
  t("hype", "elliot", "Week {week} in the books. I'll have the efficiency-adjusted breakdown once the dust settles."),
  t("hype", "darius", "Some guys showed up on tape this week and some guys didn't. We'll get into it."),
  t("hype", "darius", "Week {week} tape is going to separate who's actually built for this from who's just been getting good matchups."),
  t("hype", "darius", "Every week tells you something real if you're watching close enough. Week {week} told us plenty."),
  t("hype", "generic", "Week {week} of Rise to Immortality was UNDEFEATED for storylines. Let's go."),
  t("hype", "generic", "the RTI group chat after this week's results 💀💀💀"),
  t("hype", "generic", "Week {week} chaos already?? this league is never boring."),
  t("hype", "generic", "everybody go check the box scores from Week {week} right now. don't wait."),
  t("hype", "generic", "RTI Week {week} recap is going to be a LOT. get your popcorn ready."),

  // ================= taunt =================
  t("taunt", "vaughn", "I said it before Week {week} and I'll say it again: I don't believe in {team} till the tape backs it up."),
  t("taunt", "vaughn", "{team} fans have been way too confident lately. Week {week} might've been a real reality check."),
  t("taunt", "vaughn", "Not {team} thinking they're a top team right now. Cute story. Doesn't hold up."),
  t("taunt", "generic", "not {team} thinking they're contenders. Cute."),
  t("taunt", "generic", "{team} fans really out here celebrating that? Set the bar higher next week."),
  t("taunt", "generic", "watching {team} play is a genuinely stressful experience and I say that with love."),
  t("taunt", "generic", "{team} is one bad week away from a REAL problem and everyone knows it."),
  t("taunt", "generic", "I'm just saying, {team} hasn't beaten anybody good yet this season."),
  t("taunt", "generic", "{opponent} was the softest matchup on {team}'s schedule and they still made it close. Noted."),

  // ================= praise =================
  t("praise", "generic", "{team} deserves their flowers this week. Real performance."),
  t("praise", "generic", "{player} is quietly having a special season and nobody's talking about it enough."),
  t("praise", "generic", "{team} has been consistently good all season and it's still not getting enough respect."),
  t("praise", "generic", "{player} just doesn't miss lately. Respect where it's due."),
  t("praise", "darius", "{player} doesn't get the attention some of the bigger names in this league get. He should."),
  t("praise", "darius", "{team} is playing disciplined, fundamentally sound football right now. That's the hardest thing to fake."),
  t("praise", "marcus", "{team} has done the unglamorous things well all season. That's usually the team still playing in December."),
  t("praise", "elliot", "{player}'s per-snap production has been quietly elite all season -- the counting stats undersell how good this stretch has been."),
  t("praise", "vaughn", "{player} has been putting in real work all season and people are finally catching up. About time somebody noticed what I already knew."),
  t("praise", "generic", "{player} slander is officially not allowed in my replies anymore. Man's been elite all year."),
  t("praise", "generic", "{team} fans deserve this stretch of football after some rough seasons. Enjoy it."),
  t("praise", "darius", "{player} plays the same way whether the cameras are on him or not. That's the tell for me."),
  t("praise", "generic", "somebody give {player} his flowers before the season's over, not after."),
  t("praise", "elliot", "{team}'s point differential has quietly been top-tier all season even when the results didn't show it."),
  t("praise", "marcus", "{player} has answered every challenge thrown at him this season. That's the real evaluation, not any single week."),
  t("praise", "generic", "{team} really been that team all season and people still sleeping on them. wake up."),
  t("praise", "vaughn", "{team} has earned the right to talk their talk at this point in the season. I don't hand that out easy."),
  t("praise", "darius", "You don't have to love {team}'s style to respect that it's been working all season."),
  t("praise", "generic", "{player} appreciation post. that's it, that's the tweet."),

  t("taunt", "vaughn", "{team} fans have gone quiet in my mentions lately. Wonder why. I don't."),
  t("taunt", "generic", "{team} really thought they turned the corner. Cute story."),
  t("taunt", "generic", "I'll believe {team} is a real contender when they beat somebody with a winning record."),
  t("taunt", "vaughn", "{opponent} just exposed exactly what I've been saying about {team} for weeks. I'll take the credit."),
  t("taunt", "generic", "{team} living off one good week from a month ago at this point. Time's up."),
  t("taunt", "generic", "the {team} bandwagon got a lot quieter after this week. Interesting."),
  t("taunt", "vaughn", "I'm not saying {team} is a paper tiger. I'm saying the numbers agree with me, and the numbers don't lie."),
  t("taunt", "generic", "{team} fans in the group chat have been suspiciously silent since Week {week}."),
  t("taunt", "vaughn", "{team} needs to figure out how to win without their whole schedule being layups. That's a flaw, not a résumé."),
  t("taunt", "generic", "not {team} still getting benefit of the doubt after that performance. curious."),
  t("taunt", "generic", "{opponent} really showed the blueprint on how to beat {team}. Everyone's watching now."),

  t("bad_loss", "vaughn", "{team} really lost to {opponent} {score} and I've got nothing nice to say about it. Nothing."),
  t("bad_loss", "generic", "{team} lost to {opponent} {score}?! that's a top 5 upset of the season honestly."),
  t("bad_loss", "elliot", "{team}'s loss to {opponent} at {score} is a real outlier relative to their season-long performance. Worth watching if it repeats."),
  t("bad_loss", "marcus", "{team} will learn more from that {score} loss to {opponent} than they would from ten easy wins. That's how you use a result like this."),
  t("bad_loss", "darius", "{opponent} simply wanted it more than {team} did today. {score}. That's not scheme, that's want-to."),
  t("bad_loss", "generic", "{team} owes their fans an explanation for that {score} loss to {opponent}."),
  t("bad_loss", "vaughn", "That {team} film room after the {score} loss to {opponent} has to be a rough scene. I wouldn't want to be in there."),
  t("bad_loss", "generic", "not {team} blowing it against {opponent} {score}. painful to watch."),
  t("bad_loss", "marcus", "One rough {score} result against {opponent} doesn't define {team}'s season, but it will be a long week in that building."),

  t("close_game", "vaughn", "{team} needed every single second of that {score} win over {opponent}. Too close for my taste, and I'm never wrong about that."),
  t("close_game", "generic", "{team} vs {opponent} {score} was NOT good for anybody's blood pressure tonight."),
  t("close_game", "elliot", "A {margin}-point margin between {team} and {opponent} means the result could've gone either way -- I wouldn't overreact to it."),
  t("close_game", "marcus", "{team} showed real composure closing out {opponent} {score}. That's a trait that shows up again in the playoffs."),
  t("close_game", "darius", "{team} didn't blink when {opponent} made their push. {score}. That's the separator late in games."),
  t("close_game", "generic", "{team} really made {opponent} sweat for that {score} win. entertaining football though."),
  t("close_game", "vaughn", "{opponent} had {team} dead to rights and let it slip. {score}. That one's gonna haunt somebody in that building."),
  t("close_game", "generic", "{score}? {team} and {opponent} trying to give me a heart attack today."),
  t("close_game", "elliot", "{team} {score} over {opponent} -- logging it as a coin-flip result for the season model, not a statement win."),

  t("blowout_win", "darius", "{opponent} had no answer for {team} from the opening snap. {score}. That's domination, not a fluke."),
  t("blowout_win", "generic", "{team} {score} over {opponent}. absolute statement game."),
  t("blowout_win", "vaughn", "{team} sent a message to the whole league with that {score} win over {opponent}. I heard it loud and clear."),
  t("blowout_win", "marcus", "That {score} win over {opponent} is the kind of complete-game performance you point to later in the season."),
  t("blowout_win", "generic", "{opponent} really had no answers today. {team} {score}. dominant."),
  t("blowout_win", "elliot", "{team}'s {margin}-point win over {opponent} is one of the more decisive results of the season so far -- worth noting."),
  t("blowout_win", "vaughn", "{team} could've called it off and still won by {margin}. That's how dominant that {score} win was. No argument there."),
  t("blowout_win", "generic", "not {team} hanging {score} on {opponent}. somebody's getting a stern talking to."),
  t("blowout_win", "marcus", "Complementary football from {team} all game long against {opponent}, {score}. That's a full-team effort."),
  t("blowout_win", "darius", "{team} took {opponent}'s best shot in the first quarter and just kept scoring anyway. {score}."),

  t("quiet_game", "elliot", "{player} finishing quiet against {opponent} this week -- I'll check if that's usage or matchup before reading into it."),
  t("quiet_game", "generic", "{player} way too quiet today. hope he's good."),
  t("quiet_game", "marcus", "{player} not showing up in the box score this week doesn't mean he didn't do his job -- I'd want the film before judging."),
  t("quiet_game", "darius", "{opponent} took away {player}'s first read all game and he didn't force the issue. Smart, even if it's a quiet stat line."),
  t("quiet_game", "vaughn", "{player} really had one of those weeks against {opponent}. We're not gonna talk about it. Yet."),
  t("quiet_game", "generic", "{opponent} really made {player} disappear today. impressive defensive gameplan honestly."),
  t("quiet_game", "elliot", "Quiet week logged for {player}. Nothing alarming yet -- one data point rarely is."),

  t("milestone", "generic", "{player} hitting {value} {statLabel} this year is actually a huge deal and nobody's covering it enough."),
  t("milestone", "elliot", "{player}'s pace toward {value} {statLabel} puts him in real statistical territory for the season -- I'll keep the projection updated."),
  t("milestone", "vaughn", "{value} {statLabel} through Week {week} for {player}. Screenshot it. I called it before y'all did."),
  t("milestone", "marcus", "{value} {statLabel} for {player} is a real season-long marker -- the kind of number that holds up regardless of matchup."),
  t("milestone", "darius", "That {value}-{statLabel} mark for {player} didn't come easy. Ask anybody who's had to defend him this year."),
  t("milestone", "generic", "{player} at {value} {statLabel} and the season isn't even over yet. scary."),

  t("def_takeover", "generic", "{player} was a problem ALL game for {opponent}. {value} {statLabel}. no other way to put it."),
  t("def_takeover", "marcus", "{player}'s {value}-{statLabel} week against {opponent} is the kind of tape opposing coordinators actually game-plan around next time."),
  t("def_takeover", "vaughn", "{opponent}'s offense should send {player} a fruit basket for how much tape he just handed them to fix."),
  t("def_takeover", "darius", "{player} was disruptive before the play even fully developed. {value} {statLabel} against {opponent} says it plainly."),

  t("playmaker", "generic", "{player} making winning plays when it matters most. that's the difference maker right there."),
  t("playmaker", "elliot", "{player}'s takeaway swung the win probability more than the box score alone will show. I'll have the full number next report."),
  t("playmaker", "marcus", "{player} making that play against {opponent} is exactly the kind of situational football that wins close games in December."),

  t("turnover_heavy", "generic", "not {player} turning it over {value} times against {opponent}. we don't speak of this week."),
  t("turnover_heavy", "elliot", "{player}'s {value}-turnover week is a real outlier relative to his season average -- I wouldn't extrapolate from one game."),
  t("turnover_heavy", "marcus", "Every good player has a week like {player}'s against {opponent}. The response next week tells you more than this one did."),

  t("multi_td", "generic", "{player} scoring like it's a video game cheat code out there against {opponent}."),
  t("multi_td", "elliot", "{player}'s multi-score week is the third of the season -- that's not variance anymore, that's a real role."),
  t("multi_td", "darius", "{player} kept finishing plays all the way through against {opponent}. That's why he had multiple scores and not just chances."),

  t("big_receiving", "marcus", "{player}'s {value}-{statLabel} week against {opponent} is the kind of role expansion worth watching over the next few games."),
  t("big_receiving", "generic", "{player} putting up {value} {statLabel} like it's just another Tuesday. absurd."),

  t("big_rush", "generic", "{player} running angry today. {value} yards against {opponent} and he wasn't done after contact either."),
  t("big_rush", "elliot", "{player}'s {value}-yard week is a real per-carry outlier -- I'll have the yards-after-contact split in the next report."),

  t("big_pass", "darius", "{player} was throwing with real anticipation all game -- {value} {statLabel} against {opponent} is what trusting your reads looks like."),
  t("big_pass", "generic", "{player} really out here averaging a small city's population in passing yards. {value} against {opponent}."),

  // ================= camp_buzz =================
  // No game has been played yet in this stretch (preseason/training camp, or the wider
  // offseason pipeline between seasons) -- these never reference {opponent}/{score}/{week}/
  // {margin} or imply any result, unlike praise/taunt which assume a season already in progress.
  t("camp_buzz", "marcus", "Nobody's played a snap that counts yet, but {player} is exactly the kind of {team} storyline I'll be tracking once the season actually starts."),
  t("camp_buzz", "marcus", "Too early to grade anybody off camp buzz alone, but {player}'s name keeps coming up around {team} and that's worth watching."),
  t("camp_buzz", "marcus", "I don't put much stock in camp hype, but {player} has earned a real look from {team}'s coaching staff heading into the season."),
  t("camp_buzz", "vaughn", "{player} pulling up to {team} camp with that energy already. Season hasn't even started and I've already got him on my list."),
  t("camp_buzz", "vaughn", "I don't care that nothing's official yet. {player} is must-watch the second {team} kicks off. Write it down."),
  t("camp_buzz", "elliot", "No stats to pull yet, but I'm already setting up the tracker for {player} once {team}'s season opens."),
  t("camp_buzz", "elliot", "Preseason noise is preseason noise -- I'll have real numbers on {player} once games actually count. For now, just watching the buzz."),
  t("camp_buzz", "darius", "You can see it in how {player} carries himself in camp before a single game's been played. That's not hype, that's readiness."),
  t("camp_buzz", "darius", "{player} looks like a guy who's been putting in the work this offseason. We'll find out for real once {team} kicks off."),
  t("camp_buzz", "generic", "{player} allegedly looking DIFFERENT in camp this year. we'll see when {team} actually plays somebody."),
  t("camp_buzz", "generic", "{team} fans already talking about {player} like the season started. I respect the confidence."),
  t("camp_buzz", "generic", "not a single game played yet and {player} is already the {team} storyline everybody's watching."),
  t("camp_buzz", "generic", "kickoff can't get here fast enough, {player} and {team} have me way too hyped for a season that hasn't started."),
  ...TWEET_TEMPLATES_WAVE2,
];
