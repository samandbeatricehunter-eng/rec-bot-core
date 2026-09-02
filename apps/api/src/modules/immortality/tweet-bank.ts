// Rise to Immortality "tweets" feed -- REC Network's four named hosts, plus a rotating pool of
// generic fan/hater accounts, reacting to the week's actual stat lines. Templates use {slot}
// placeholders filled from real data (see tweet-generation.service.ts) rather than one
// fully-authored sentence per output, so a modest authored bank produces hundreds of distinct
// real posts once you multiply it by which player/team/value actually fills each slot on a
// given week -- the same approach roundtable-take-bank.ts/interview-title-bank.ts use for takes
// and interview prompts.

export type TweetHostKey = "marcus" | "jalen" | "elliot" | "darius";
export type TweetAuthor = TweetHostKey | "generic";

export const TWEET_HOSTS: Record<TweetHostKey, { handle: string; displayName: string }> = {
  marcus: { handle: "@MarcusValeREC", displayName: "Marcus Vale" },
  jalen: { handle: "@JalenCrossREC", displayName: "Jalen Cross" },
  elliot: { handle: "@ElliotMercerREC", displayName: "Elliot Mercer" },
  darius: { handle: "@DariusKingREC", displayName: "Darius King" },
};

// A crowd of fake fan/hater handles a "generic" tweet gets randomly attributed to, so the feed
// reads like a real timeline instead of the same four hosts talking to themselves.
export const GENERIC_HANDLES: Array<{ handle: string; displayName: string }> = [
  { handle: "@GridironGospel", displayName: "Gridiron Gospel" },
  { handle: "@ColdTakesOnly", displayName: "Cold Takes Only" },
  { handle: "@BleacherBarry", displayName: "Barry from the Bleachers" },
  { handle: "@RecLeagueLurker", displayName: "REC League Lurker" },
  { handle: "@FantasyFraud88", displayName: "Fantasy Fraud Detector" },
  { handle: "@SundayScaries_", displayName: "Sunday Scaries" },
  { handle: "@TapeDontLie", displayName: "The Tape Don't Lie" },
  { handle: "@ThirdAndLong", displayName: "Third & Long Pod" },
  { handle: "@RookieWallWatch", displayName: "Rookie Wall Watch" },
  { handle: "@BoxScoreBandit", displayName: "Box Score Bandit" },
  { handle: "@NoHuddleNate", displayName: "No-Huddle Nate" },
  { handle: "@ClipboardCritic", displayName: "The Clipboard Critic" },
  { handle: "@PrimeTimeOrBust", displayName: "Prime Time or Bust" },
  { handle: "@RedZoneRuiner", displayName: "Red Zone Ruiner" },
  { handle: "@SackDanceDaily", displayName: "Sack Dance Daily" },
  { handle: "@FranchiseFatigue", displayName: "Franchise Fatigue" },
  { handle: "@TrenchWarfareHQ", displayName: "Trench Warfare HQ" },
  { handle: "@OverreactionOwl", displayName: "The Overreaction Owl" },
  { handle: "@DraftBustAlert", displayName: "Draft Bust Alert" },
  { handle: "@CoinCounterRec", displayName: "The Coin Counter" },
  { handle: "@GameballGrandma", displayName: "Gameball Grandma" },
  { handle: "@LeagueOfficeMole", displayName: "League Office Mole" },
  { handle: "@ChainGangChad", displayName: "Chain Gang Chad" },
  { handle: "@WaiverWireWitch", displayName: "Waiver Wire Witch" },
  { handle: "@ImmortalityIntel", displayName: "Immortality Intel" },
  { handle: "@PylonCam", displayName: "Pylon Cam" },
  { handle: "@FilmRoomFanatic", displayName: "Film Room Fanatic" },
  { handle: "@HatersHuddle", displayName: "The Haters' Huddle" },
  { handle: "@StatSheetStan", displayName: "Stat Sheet Stan" },
  { handle: "@BackupQBTruther", displayName: "Backup QB Truther" },
  { handle: "@GoalLineGossip", displayName: "Goal Line Gossip" },
  { handle: "@RTIRecapRadio", displayName: "RTI Recap Radio" },
  { handle: "@CutdayCassie", displayName: "Cutday Cassie" },
  { handle: "@FourthQuarterFred", displayName: "Fourth Quarter Fred" },
  { handle: "@ScoutingScrolls", displayName: "Scouting Scrolls" },
  { handle: "@BlitzPickupBetty", displayName: "Blitz Pickup Betty" },
  { handle: "@RingChaserReport", displayName: "Ring Chaser Report" },
  { handle: "@PracticeSquadPete", displayName: "Practice Squad Pete" },
  { handle: "@EndZoneEcho", displayName: "End Zone Echo" },
  { handle: "@TrophyCaseTalk", displayName: "Trophy Case Talk" },
];

export type TweetCategory =
  | "big_pass" | "big_rush" | "big_receiving" | "multi_td" | "turnover_heavy"
  | "def_takeover" | "playmaker" | "quiet_game" | "milestone" | "blowout_win"
  | "close_game" | "bad_loss" | "hype" | "taunt" | "praise";

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
};

export type TweetTemplate = { category: TweetCategory; voice: TweetAuthor; text: string };

function t(category: TweetCategory, voice: TweetAuthor, text: string): TweetTemplate {
  return { category, voice, text };
}

// {player}/{team}/{opponent}/{week}/{value}/{statLabel}/{secondValue}/{secondStatLabel}/
// {score}/{margin} are filled from TweetSlots by fillTemplate() in tweet-generation.service.ts.
export const TWEET_TEMPLATES: TweetTemplate[] = [
  // ---- big_pass ----
  t("big_pass", "marcus", "{player} put up {value} {statLabel} against {opponent}. One good week doesn't make a season -- I want to see it again before I move him up my board."),
  t("big_pass", "marcus", "{value} yards through the air is real production, but I'm watching whether {player} can repeat that against a defense that actually studies him next."),
  t("big_pass", "jalen", "{player} just dropped {value} {statLabel} on {opponent} and I need somebody to explain how that defense let it happen. Somebody's getting benched."),
  t("big_pass", "jalen", "{value} yards for {player}?! That's not a stat line, that's a personal foul against {opponent}'s secondary."),
  t("big_pass", "elliot", "{player}: {value} {statLabel}, {secondValue} {secondStatLabel} this week. That's not noise, that's a real week. The efficiency numbers back it up."),
  t("big_pass", "elliot", "Week {week} update: {player} posted {value} {statLabel}. I'll have the full efficiency breakdown, but the raw total alone clears the bar."),
  t("big_pass", "generic", "{player} really said {value} yards and went home. Somebody check on {opponent}'s DBs."),
  t("big_pass", "generic", "{player} cooking today. {value} {statLabel}. That's it, that's the tweet."),
  t("big_pass", "generic", "not {player} throwing for {value} against {opponent} like it's nothing 💀"),

  // ---- big_rush ----
  t("big_rush", "marcus", "{value} rushing yards from {player} this week. That's an offensive line doing its job as much as it is a runner doing his."),
  t("big_rush", "jalen", "{player} ran through {opponent} like a revolving door. {value} yards. Somebody get that defensive coordinator a group chat apology."),
  t("big_rush", "elliot", "{player}'s {value} rushing yards this week push his season pace into territory worth actually tracking. I'll have the full number next update."),
  t("big_rush", "darius", "You can see it on tape before you see it in the box score -- {player} was getting movement at the point of attack all game. {value} yards is the receipt, not the story."),
  t("big_rush", "generic", "{player} broke {opponent} in half today. {value} yards. RUN IT BACK."),
  t("big_rush", "generic", "{player} out here playing a different sport than everyone else. {value} rush yards 😤"),

  // ---- big_receiving ----
  t("big_receiving", "marcus", "{player} had a real day -- {value} {statLabel}. The question is whether that's a matchup win or a repeatable role."),
  t("big_receiving", "jalen", "{opponent}'s coverage plan for {player} today was apparently \"hope.\" {value} {statLabel}. Hope did not work."),
  t("big_receiving", "elliot", "{player}: {value} {statLabel} in Week {week}. Target volume and per-catch value both matter here -- I'll have the split next report."),
  t("big_receiving", "darius", "{player} was winning his release before the ball was even out. {value} {statLabel} is what clean releases turn into."),
  t("big_receiving", "generic", "{player} was WIDE open all game and {opponent} never adjusted. {value} {statLabel}."),

  // ---- multi_td ----
  t("multi_td", "marcus", "{player} found the end zone multiple times against {opponent}. Good football. I'd still like to see the full game before calling it a trend."),
  t("multi_td", "jalen", "{player} scored like he had somewhere to be. Multiple trips to the house against {opponent} and he never even looked tired."),
  t("multi_td", "elliot", "Multi-touchdown week for {player}. Scoring efficiency like that doesn't happen by accident -- I'll have the red-zone rate in the next report."),
  t("multi_td", "darius", "{player} wasn't just scoring, he was finishing. That's the difference between a good week and a great one."),
  t("multi_td", "generic", "{player} in the end zone AGAIN. {opponent} needs to answer some questions on Monday."),
  t("multi_td", "generic", "{player} treating the goal line like his personal apartment this week."),

  // ---- turnover_heavy ----
  t("turnover_heavy", "marcus", "{player} put the ball on the ground more than once against {opponent}. Talent isn't the question there -- decision-making under pressure is."),
  t("turnover_heavy", "jalen", "{player} tried to give the game away to {opponent} and almost succeeded. That's not bad luck, that's a bad week."),
  t("turnover_heavy", "elliot", "Turnover-worthy plays are the single most predictive bad-week indicator we track. {player} had a rough one there -- the number doesn't lie."),
  t("turnover_heavy", "darius", "Some of that was {opponent} making a play. Some of that was {player} trying to force something that wasn't there. Both things can be true."),
  t("turnover_heavy", "generic", "{player} really said \"let me give {opponent} the ball\" TWICE today. Rough one."),
  t("turnover_heavy", "generic", "someone check on {player}, he had a day out there."),

  // ---- def_takeover ----
  t("def_takeover", "marcus", "{player} controlled that game defensively. {value} {statLabel} against {opponent} is the kind of week that actually shows up on film for the rest of the season."),
  t("def_takeover", "jalen", "{player} made {opponent}'s offense look like it was running in mud. {value} {statLabel}. Absurd."),
  t("def_takeover", "elliot", "{player} logged {value} {statLabel} this week. That's a real production spike -- worth tracking whether it's matchup-driven or a genuine role change."),
  t("def_takeover", "darius", "{player} was in the backfield before the ball was even out half the time. {value} {statLabel} tells you what the tape already showed."),
  t("def_takeover", "generic", "{player} was NOT letting {opponent} breathe today. {value} {statLabel}. Absolute menace."),

  // ---- playmaker (INT / forced fumble / defensive TD) ----
  t("playmaker", "marcus", "{player} came up with a real momentum-swinging play against {opponent}. That's the kind of thing that wins close games later in the year."),
  t("playmaker", "jalen", "{player} just took the ball AND the momentum from {opponent} in the same play. That's disrespectful, honestly."),
  t("playmaker", "elliot", "Takeaway from {player} this week. Turnover margin is one of the strongest predictors we have for who's actually winning close games."),
  t("playmaker", "darius", "{player} read that play before it happened. That's not luck, that's recognition -- the kind you can't coach into somebody."),
  t("playmaker", "generic", "{player} just ended a drive AND a career with that play on {opponent}."),
  t("playmaker", "generic", "{player} really said \"not today\" and took it from {opponent}. LOVE to see it."),

  // ---- quiet_game ----
  t("quiet_game", "marcus", "{player} didn't have much of a stat line against {opponent} this week. One quiet week means very little on its own -- I'll wait for a pattern before I say more."),
  t("quiet_game", "jalen", "{player} was a ghost against {opponent} today. If that becomes a trend, we're going to have a conversation about it."),
  t("quiet_game", "elliot", "Low-volume week for {player}. Could be game-plan driven, could be matchup driven -- one data point isn't enough to separate those yet."),
  t("quiet_game", "darius", "Sometimes a quiet box score means {opponent} took something away and {player} didn't force it. That's actually the right decision, even if it doesn't show up in the numbers."),
  t("quiet_game", "generic", "where was {player} today? {opponent} had that one locked down."),

  // ---- milestone ----
  t("milestone", "marcus", "{player} crossed {value} {statLabel} on the season. That's a real, sustained body of work -- not a single big week inflating a number."),
  t("milestone", "jalen", "{player} just hit {value} {statLabel} for the season and I don't think the league has fully clocked it yet. They will now."),
  t("milestone", "elliot", "Milestone check: {player} is now at {value} {statLabel} through Week {week}. I'll have the full season pace projection in the next report."),
  t("milestone", "darius", "{value} {statLabel} on the season for {player}. Numbers like that come from being trusted with the ball snap after snap -- that trust was earned."),
  t("milestone", "generic", "{player} just hit {value} {statLabel} on the season?! Immortality watch is ON."),
  t("milestone", "generic", "{value} {statLabel} and counting for {player}. Somebody update the record boards."),

  // ---- blowout_win ----
  t("blowout_win", "marcus", "{team} controlled that game from start to finish against {opponent}, final {score}. That's the kind of complete performance you build a season around."),
  t("blowout_win", "jalen", "{team} did NOT come to play nice with {opponent} today. {score} final. Somebody's getting questions in the group chat tonight."),
  t("blowout_win", "elliot", "{team} {score} over {opponent}. A margin like that usually means the underlying efficiency gap was even bigger than the score shows."),
  t("blowout_win", "generic", "{team} just embarrassed {opponent} {score}. Screenshot this."),
  t("blowout_win", "generic", "{opponent} should not have shown up today honestly. {team} {score}."),

  // ---- close_game ----
  t("close_game", "marcus", "{team} found a way to win a tight one against {opponent}, {score}. Those are the games that separate contenders from pretenders later in the year."),
  t("close_game", "jalen", "{team} survived {opponent} {score}. Survived. Barely. We're not going to pretend that was dominant."),
  t("close_game", "elliot", "{team} {score} over {opponent}. A margin that thin usually means the box score is closer to a coin flip than the standings will show."),
  t("close_game", "darius", "{team} made the one more play than {opponent} did when it mattered. {score}. That's the whole ballgame right there."),
  t("close_game", "generic", "my heart cannot take {team} vs {opponent} games. {score}. I need a minute."),

  // ---- bad_loss ----
  t("bad_loss", "marcus", "{team} has real questions to answer after {score} against {opponent}. I'd want to see the full game before drawing conclusions, but that's a rough result."),
  t("bad_loss", "jalen", "{team} lost to {opponent} {score} and I have SO many questions. That's not a bad week, that's a bad week that's going to get asked about all season."),
  t("bad_loss", "elliot", "{team} {score} vs {opponent}. I'll need the underlying numbers before I call this a trend, but the scoreboard alone isn't good."),
  t("bad_loss", "generic", "{team} really lost to {opponent} {score}?? not the {team} I had ranked top 5 last week 💀"),
  t("bad_loss", "generic", "{team} fans are quiet after that {score} loss to {opponent}. Understandably."),

  // ---- hype (generic, less data-specific) ----
  t("hype", "marcus", "Week {week} is in the books. Some real football was played -- I'll have the full breakdown once every result is in."),
  t("hype", "jalen", "Week {week} delivered. There's about to be some VERY uncomfortable conversations in a few group chats tonight."),
  t("hype", "elliot", "Week {week} data is in. Give me a little time and I'll have the numbers that actually explain what just happened."),
  t("hype", "darius", "Some guys showed up on tape this week and some guys didn't. We'll get into it."),
  t("hype", "generic", "Week {week} of Rise to Immortality was UNDEFEATED for storylines. Let's go."),
  t("hype", "generic", "the RTI group chat after this week's results 💀💀💀"),

  // ---- taunt (generic hater energy) ----
  t("taunt", "jalen", "I said it before Week {week} and I'll say it again after: I don't believe in {team} until the tape says otherwise."),
  t("taunt", "generic", "not {team} thinking they're contenders. Cute."),
  t("taunt", "generic", "{team} fans really out here celebrating that? Set the bar higher next week."),
  t("taunt", "generic", "watching {team} play is a genuinely stressful experience and I say that with love."),

  // ---- praise (generic support) ----
  t("praise", "generic", "{team} deserves their flowers this week. Real performance."),
  t("praise", "generic", "{player} is quietly having a special season and nobody's talking about it enough."),
  t("praise", "darius", "{player} doesn't get the attention some of the bigger names in this league get. He should."),
];
