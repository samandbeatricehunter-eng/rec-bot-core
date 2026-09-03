// Per-account Twitter personas for the RTI feed. Hosts and the 46 generic catalog accounts
// each get a voice family, a vulgar/clean lean, preferred moods, and signature lines they
// fall back to so the same handle doesn't sound like a random quote bot. Player (roster)
// personas resolve through trait lean in tweet-generation.service.ts.

import type { ConversationKind, ConversationMood, VoiceFamily } from "./tweet-bank-conversations.js";

export type AccountPersona = {
  handle: string;
  family: VoiceFamily;
  vulgar: boolean;
  moods: ConversationMood[];
  signatures: Record<ConversationKind, string[]>;
};

function p(
  handle: string,
  family: VoiceFamily,
  vulgar: boolean,
  moods: ConversationMood[],
  signatures: Record<ConversationKind, string[]>,
): AccountPersona {
  return { handle, family, vulgar, moods, signatures };
}

export const HOST_PERSONAS: AccountPersona[] = [
  p("@MarcusValeREC", "marcus", false, ["analysis", "praise", "witty"], {
    reply: [
      "{toHandle} process over noise. I'll take the film over the quote tweet.",
      "{toHandle} that's a fair read. I still want to see it twice before I move my board.",
      "{toHandle} you're reacting to the result. I'm still on the operation.",
      "{toHandle} I don't hate the take. I hate how fast people are locking it in.",
      "{toHandle} say it with the third-down tape, not the box score.",
      "{toHandle} this is the kind of clip that fools people in September.",
      "{toHandle} I can respect the production and still ask for the same look against a real rush.",
      "{toHandle} slow down. One good week is a data point, not a coronation.",
    ],
    mention: [
      "{toHandle} I want your honest board, not the viral one.",
      "{toHandle} walk me through the process on that one. Skip the recap.",
      "{toHandle} if you're standing on that evaluation tomorrow, say it now.",
      "{toHandle} don't let the timeline do your scouting for you.",
    ],
    clapback: [
      "{toHandle} I didn't say he can't play. I said I want it again.",
      "{toHandle} you can yell. I'm still watching the feet.",
      "{toHandle} results are loud. Process is quieter. I live in the quiet.",
      "{toHandle} I'm not walking it back. I'm waiting on a second sample.",
    ],
  }),
  p("@JalenCrossREC", "jalen", true, ["trash", "angry", "hype", "vulgar", "hate"], {
    reply: [
      "{toHandle} THAT'S what I'm talking about. Say that shit again.",
      "{toHandle} I been screaming this and y'all called me loud. Be loud then.",
      "{toHandle} sit your ass down if you ain't watching the same game.",
      "{toHandle} this is messy as hell and I'm living for it.",
      "{toHandle} don't soften it. The tape is disrespectful.",
      "{toHandle} I need names. Don't do that vague \"they\" shit with me.",
      "{toHandle} you finally grew a pair and tweeted it. Welcome.",
      "{toHandle} I'm heated and I'm right. Those can be the same thing.",
    ],
    mention: [
      "{toHandle} hop in or stay out the way. I don't do lurkers.",
      "{toHandle} you been real quiet for somebody with all them takes last week.",
      "{toHandle} don't make me drag you into this. Just come.",
      "{toHandle} I want smoke. You bringing any or you posting recaps?",
    ],
    clapback: [
      "{toHandle} I said what I said. Cry in the quote tweet.",
      "{toHandle} you in my mentions like I won't go there. I will.",
      "{toHandle} keep talking. I got all damn day.",
      "{toHandle} that's cute. Say it when the lights are on.",
    ],
  }),
  p("@ElliotMercerREC", "elliot", false, ["analysis", "witty", "praise"], {
    reply: [
      "{toHandle} the surface number is fine. The split underneath it is the actual story.",
      "{toHandle} I'll log that. One week still isn't a trend.",
      "{toHandle} you're describing a feeling. I need the rate.",
      "{toHandle} that take survives the box score and dies in the down-and-distance.",
      "{toHandle} I don't hate it. I just won't publish it yet.",
      "{toHandle} if the sample were twice this size I'd be with you.",
      "{toHandle} that's an outlier week until it isn't. Don't promote it early.",
      "{toHandle} I already have this in the model. You're late, not wrong.",
    ],
    mention: [
      "{toHandle} send the split, not the speech.",
      "{toHandle} I want your number, not your vibe.",
      "{toHandle} if you have the efficiency, post it. If you don't, wait.",
      "{toHandle} don't make me be the adult in this mentions fight.",
    ],
    clapback: [
      "{toHandle} I'm not arguing feelings. I'm waiting on a second week.",
      "{toHandle} you can keep the hot take. I'll keep the spreadsheet.",
      "{toHandle} being first isn't the same as being right.",
      "{toHandle} I heard you. The model didn't move.",
    ],
  }),
  p("@DariusKingREC", "darius", true, ["hype", "trash", "praise", "vulgar", "angry"], {
    reply: [
      "{toHandle} that's locker-room talk and I respect it.",
      "{toHandle} you can feel who wants it. This ain't scheme, this is want-to.",
      "{toHandle} I was in rooms like that. That's real energy.",
      "{toHandle} don't intellectualize a dog. Just say the dog is a dog.",
      "{toHandle} film don't lie and neither does the way a guy walks to the huddle.",
      "{toHandle} that's the standard. Everything else is conversation.",
      "{toHandle} I love a nasty competitor. This is that.",
      "{toHandle} y'all talking rankings. I'm talking who hits first.",
    ],
    mention: [
      "{toHandle} come talk ball, not brand deals.",
      "{toHandle} I need you in this. Don't leave it to the recap accounts.",
      "{toHandle} you know what that look means. Say it.",
      "{toHandle} we can do this respectful or we can do this honest.",
    ],
    clapback: [
      "{toHandle} I ain't softening it for the timeline.",
      "{toHandle} you want a quote. I gave you a standard.",
      "{toHandle} keep the analysis. I'll keep the edge.",
      "{toHandle} we can hug after. Right now I'm competing.",
    ],
  }),
];

export const GENERIC_PERSONAS: AccountPersona[] = [
  p("@GridironGospel", "media", false, ["analysis", "hype", "praise"], {
    reply: ["{toHandle} we're locking this for the AM hit. Don't delete it.", "{toHandle} that's the lede. Everybody else is burying it.", "{toHandle} Gospel agrees. Write it bigger."],
    mention: ["{toHandle} we need a quote before noon. You in?", "{toHandle} on or off record, just don't be boring."],
    clapback: ["{toHandle} we printed it. Live with it.", "{toHandle} the Gospel don't do walk-backs before film."],
  }),
  p("@RTIRecapRadio", "media", false, ["hype", "witty", "analysis"], {
    reply: ["{toHandle} that's going in the cold open.", "{toHandle} we already clipped this. Keep going.", "{toHandle} radio voice: you're not wrong, you're early."],
    mention: ["{toHandle} come on the recap. 90 seconds, no PR.", "{toHandle} we saving you a segment. Don't flake."],
    clapback: ["{toHandle} we aired it. That's the record now.", "{toHandle} next hour we run your rebuttal. Bring one."],
  }),
  p("@TheFilmRoomNet", "analyst", false, ["analysis", "praise"], {
    reply: ["{toHandle} I need the All-22 before I bless that.", "{toHandle} the clip is lying. The wide copy isn't.", "{toHandle} feet. Eyes. Then the result. In that order."],
    mention: ["{toHandle} send the cutup if you got one.", "{toHandle} film room's open. Leave the slogans outside."],
    clapback: ["{toHandle} I watched it twice. Still not there.", "{toHandle} you saw a highlight. I saw a missed assignment."],
  }),
  p("@ThirdAndLongPod", "media", false, ["analysis", "witty", "hype"], {
    reply: ["{toHandle} that's a whole episode. Don't tease it.", "{toHandle} third-and-long energy. I like the nerve.", "{toHandle} we recording this beef, FYI."],
    mention: ["{toHandle} pod needs a dissenter. That's you.", "{toHandle} come ruin a take with us."],
    clapback: ["{toHandle} we'll run the voicemail. Keep talking.", "{toHandle} you just booked yourself 12 minutes."],
  }),
  p("@PylonCamMedia", "media", false, ["hype", "witty"], {
    reply: ["{toHandle} pylon cam caught that live. You're late.", "{toHandle} we got the angle. It's worse than you think.", "{toHandle} that's a screenshot account's dream."],
    mention: ["{toHandle} look at the pylon, not the narrative.", "{toHandle} we posting the still. Tag who you want."],
    clapback: ["{toHandle} the still don't care about your feelings.", "{toHandle} camera don't editorialize. You do."],
  }),
  p("@RecLeagueWire", "media", false, ["analysis", "hype"], {
    reply: ["{toHandle} Wire is confirming. Stand by.", "{toHandle} that's the bulletin. We'll dress it later.", "{toHandle} sourcing this. Don't get cute with it."],
    mention: ["{toHandle} any comment before we write around you?", "{toHandle} Wire wants a line. One sentence."],
    clapback: ["{toHandle} we already filed it.", "{toHandle} corrections go through the next blast."],
  }),
  p("@EndZoneEchoNet", "media", false, ["hype", "praise", "witty"], {
    reply: ["{toHandle} echo chamber just got louder.", "{toHandle} that's gonna bounce all night.", "{toHandle} we heard you in the back of the end zone."],
    mention: ["{toHandle} scream it for the cheap seats.", "{toHandle} don't whisper a take like that."],
    clapback: ["{toHandle} too late, it's echoing.", "{toHandle} you wanted volume. You got it."],
  }),
  p("@TwoMinuteTruth", "media", false, ["analysis", "angry", "witty"], {
    reply: ["{toHandle} two-minute drill: you're right, they're lying.", "{toHandle} no time for the soft version.", "{toHandle} clock's running. Say the ugly part."],
    mention: ["{toHandle} 20 seconds. What's the truth?", "{toHandle} don't waste a timeout on a hedge."],
    clapback: ["{toHandle} I don't do OT explanations.", "{toHandle} truth don't need a second draft."],
  }),
  p("@TrenchWarfareHQ", "analyst", true, ["analysis", "trash", "angry"], {
    reply: ["{toHandle} talk to me about the line or sit down.", "{toHandle} skill guys get the headlines. Trenches decide it.", "{toHandle} that clip starts two yards behind the LOS."],
    mention: ["{toHandle} who won the line? Don't skip it.", "{toHandle} I want names in the interior, not the skill room."],
    clapback: ["{toHandle} pretty routes don't move a nose tackle.", "{toHandle} come back when you can identify a double team."],
  }),
  p("@SundayScariesNet", "media", true, ["hate", "hype", "vulgar", "witty"], {
    reply: ["{toHandle} the scaries are here and they brought friends.", "{toHandle} this is why nobody sleeps on Sunday.", "{toHandle} I hate this and I can't look away."],
    mention: ["{toHandle} you nervous or you lying?", "{toHandle} don't pretend this sits right with you."],
    clapback: ["{toHandle} enjoy the pit in your stomach.", "{toHandle} scaries don't do comfort."],
  }),
  p("@NoHuddleNews", "media", false, ["hype", "analysis"], {
    reply: ["{toHandle} no huddle, no hedge. Print it.", "{toHandle} we're already on the next item.", "{toHandle} tempo. Don't write a novel."],
    mention: ["{toHandle} 10 words. Go.", "{toHandle} hurry-up. What's the line?"],
    clapback: ["{toHandle} next snap. Keep up.", "{toHandle} we don't huddle for feelings."],
  }),
  p("@RedZoneRadioHQ", "media", false, ["hype", "angry", "praise"], {
    reply: ["{toHandle} inside the 20 this gets louder.", "{toHandle} red zone radio is live and messy.", "{toHandle} that take scores or it dies at the 3."],
    mention: ["{toHandle} goal-to-go. What's your call?", "{toHandle} don't settle for a field-goal take."],
    clapback: ["{toHandle} we punched it in. Sit down.", "{toHandle} you settled. I didn't."],
  }),
  p("@ImmortalityIndex", "analyst", false, ["analysis", "praise"], {
    reply: ["{toHandle} Index has him moving. Not as far as you think.", "{toHandle} that's a weight, not a crown.", "{toHandle} we grade the body of work."],
    mention: ["{toHandle} where are you ranking this, honestly?", "{toHandle} send a number I can put next to a name."],
    clapback: ["{toHandle} the Index doesn't yell. It moves slowly.", "{toHandle} you want a leap. I gave you a nudge."],
  }),
  p("@ChainGangDaily", "media", false, ["witty", "analysis", "hype"], {
    reply: ["{toHandle} first down. Keep the chains moving.", "{toHandle} that's a measurement. Spot it.", "{toHandle} we marking the ball where you actually got to."],
    mention: ["{toHandle} short of the stick. Try again.", "{toHandle} come get the extra yard."],
    clapback: ["{toHandle} we spotted it. Don't argue the chain.", "{toHandle} that's short. Next play."],
  }),
  p("@BoxScoreBulletin", "fan_stats", false, ["analysis", "witty"], {
    reply: ["{toHandle} bulletin just typesets that line.", "{toHandle} I don't need the speech. I have the row.", "{toHandle} the number already said it."],
    mention: ["{toHandle} quote the line or stop.", "{toHandle} I'll wait on the official total."],
    clapback: ["{toHandle} box score's in. You're arguing a ghost.", "{toHandle} I published the digits. Debate those."],
  }),
  p("@PrimeCoverageHQ", "analyst", false, ["analysis", "praise"], {
    reply: ["{toHandle} coverage is late and the window is gone.", "{toHandle} that's a leverage issue, not a talent issue.", "{toHandle} prime time don't hide bad feet."],
    mention: ["{toHandle} who had the leverage? Be specific.", "{toHandle} I want the coverage call, not the vibe."],
    clapback: ["{toHandle} I lined it up. You missed the alignment.", "{toHandle} stay in your zone. Literally."],
  }),
  p("@MaxSterlingTalks", "analyst", false, ["analysis", "witty", "hate"], {
    reply: ["{toHandle} that's a Sterling take if I ever heard one. Almost.", "{toHandle} charming. Also incomplete.", "{toHandle} I'll allow it with an asterisk."],
    mention: ["{toHandle} impress me. You haven't yet.", "{toHandle} make it sound expensive."],
    clapback: ["{toHandle} I didn't come here to be agreed with.", "{toHandle} keep the volume. Lose the certainty."],
  }),
  p("@CoachCallahanHQ", "analyst", true, ["angry", "analysis", "trash"], {
    reply: ["{toHandle} that's a coaching foul. Period.", "{toHandle} fundamentals. Nobody wants to hear it. It's still true.", "{toHandle} I would bench that look in a heartbeat."],
    mention: ["{toHandle} who taught that? I want a name.", "{toHandle} come to the whiteboard or stop talking."],
    clapback: ["{toHandle} I coached against worse and still hated this.", "{toHandle} sit. Watch. Then talk."],
  }),
  p("@ColtonVanceQB", "analyst", false, ["analysis", "praise", "witty"], {
    reply: ["{toHandle} the answer was there pre-snap. He saw it late.", "{toHandle} that's a progression, not a prayer.", "{toHandle} pocket's dirty and the ball still came out clean."],
    mention: ["{toHandle} tell me the read, not the yardage.", "{toHandle} QB room wants honesty. You got any?"],
    clapback: ["{toHandle} I threw that look. I know what it costs.", "{toHandle} analytics can sit. The window was real."],
  }),
  p("@DeuceCarnivalHQ", "jalen", true, ["hype", "vulgar", "trash", "witty"], {
    reply: ["{toHandle} carnival's open and you just bought a ticket.", "{toHandle} this is chaos and I'm selling nachos.", "{toHandle} don't bring manners to my mentions."],
    mention: ["{toHandle} come act up.", "{toHandle} we doing a show or a seminar?"],
    clapback: ["{toHandle} thanks for the content, clown.", "{toHandle} stay mad. It's good for business."],
  }),
  p("@TankReynoldsHQ", "darius", true, ["trash", "angry", "vulgar", "hype"], {
    reply: ["{toHandle} I hit people for a living. This take is soft.", "{toHandle} bring pads or bring silence.", "{toHandle} that's cute until somebody gets put in the dirt."],
    mention: ["{toHandle} you talking or you tackling?", "{toHandle} come down here in the mud."],
    clapback: ["{toHandle} I don't debate. I collide.", "{toHandle} keep tweeting. I'll keep finishing."],
  }),
  p("@ColdTakesOnly", "fan_hater", true, ["hate", "witty", "vulgar"], {
    reply: ["{toHandle} that's a cold take and I'm proud of you.", "{toHandle} finally somebody said the ugly part.", "{toHandle} ice this. It's already dead."],
    mention: ["{toHandle} warm take? Keep it.", "{toHandle} make it colder or don't @ me."],
    clapback: ["{toHandle} I specialize in ruining moods.", "{toHandle} thanks, I hate it. That's the brand."],
  }),
  p("@BleacherBarry", "fan_homer", false, ["hype", "praise", "witty"], {
    reply: ["{toHandle} from the bleachers that looked filthy.", "{toHandle} I paid for this seat and I want blood.", "{toHandle} Barry's standing up. That never happens."],
    mention: ["{toHandle} you see that from up here?", "{toHandle} beer' s warm and the take is hotter."],
    clapback: ["{toHandle} I been here since warmups. Sit down.", "{toHandle} cheap seats, expensive opinions."],
  }),
  p("@FantasyFraud88", "fan_stats", true, ["hate", "analysis", "vulgar"], {
    reply: ["{toHandle} that's fraud and I have the projection to prove it.", "{toHandle} start him and cry. That's the product.", "{toHandle} I faded this and I feel nothing."],
    mention: ["{toHandle} you still starting that liar?", "{toHandle} show me the floor, not the ceiling."],
    clapback: ["{toHandle} your lineup is a crime scene.", "{toHandle} I warned you. Invoice is feelings."],
  }),
  p("@TapeDontLie", "analyst", false, ["analysis", "hate", "praise"], {
    reply: ["{toHandle} tape don't lie. You might.", "{toHandle} I rewound it. Still the same sin.", "{toHandle} pause it. There. That's the play."],
    mention: ["{toHandle} watch it again at 0.5x.", "{toHandle} if the tape agreed you'd be quieter."],
    clapback: ["{toHandle} I have the clip. You have a vibe.", "{toHandle} rewind or retire the take."],
  }),
  p("@RookieWallWatch", "fan_hater", false, ["hate", "analysis", "witty"], {
    reply: ["{toHandle} wall incoming. Don't act surprised.", "{toHandle} I've seen this movie in week 10.", "{toHandle} rookie tax is due."],
    mention: ["{toHandle} how many snaps till the wall?", "{toHandle} keep the hype, watch the legs."],
    clapback: ["{toHandle} I get paid in I-told-you-sos.", "{toHandle} wall watch never clocks out."],
  }),
  p("@BoxScoreBandit", "fan_stats", false, ["analysis", "witty", "hate"], {
    reply: ["{toHandle} I stole that line already. It's mine.", "{toHandle} empty calories. Look at the attempts.", "{toHandle} bandit says the number's a costume."],
    mention: ["{toHandle} send the raw row.", "{toHandle} if it ain't in the sheet it didn't happen."],
    clapback: ["{toHandle} I burgled the truth. You're late.", "{toHandle} pretty totals, ugly volume."],
  }),
  p("@ClipboardCritic", "analyst", false, ["analysis", "witty", "angry"], {
    reply: ["{toHandle} that's a clipboard foul.", "{toHandle} play-caller got cute. I hate cute.", "{toHandle} I would've gone heavy personnel and ended this."],
    mention: ["{toHandle} who called that? Be brave.", "{toHandle} critic's clipboard is out. Hide."],
    clapback: ["{toHandle} I circled it in red. Twice.", "{toHandle} scheme lost. Talent covered. Barely."],
  }),
  p("@PrimeTimeOrBust", "fan_homer", true, ["hype", "trash", "vulgar"], {
    reply: ["{toHandle} prime time or get off my TV.", "{toHandle} I don't do boring stars.", "{toHandle} either you eat or you vanish."],
    mention: ["{toHandle} lights on. You showing up?", "{toHandle} bust watch is a lifestyle."],
    clapback: ["{toHandle} you blinked. That's a bust in my book.", "{toHandle} prime time don't do participation trophies."],
  }),
  p("@RedZoneRuiner", "fan_hater", true, ["hate", "vulgar", "angry", "trash"], {
    reply: ["{toHandle} red zone is where dreams go to die and I'm the usher.", "{toHandle} they had it at the 8 and pissed it away.", "{toHandle} I ruin drives for fun."],
    mention: ["{toHandle} inside the 20 I become evil.", "{toHandle} don't celebrate a first down at the 12."],
    clapback: ["{toHandle} I called the stall. Pay up.", "{toHandle} goal line is my house. Get out."],
  }),
  p("@SackDanceDaily", "fan_homer", true, ["hype", "trash", "vulgar"], {
    reply: ["{toHandle} sack dance loading.", "{toHandle} somebody's QB is on the ground and I'm smiling.", "{toHandle} choreography after the whistle. That's culture."],
    mention: ["{toHandle} who we putting in the dirt?", "{toHandle} dance card's open."],
    clapback: ["{toHandle} I already picked the song.", "{toHandle} get the QB up. Slowly."],
  }),
  p("@FranchiseFatigue", "fan_hater", true, ["hate", "witty", "vulgar"], {
    reply: ["{toHandle} I'm tired in my bones and this ain't helping.", "{toHandle} same movie, new week. I'm exhausted.", "{toHandle} franchise fatigue is a medical condition."],
    mention: ["{toHandle} you still believing? That's brave.", "{toHandle} sell me hope. I dare you."],
    clapback: ["{toHandle} I ran out of hope in August.", "{toHandle} fatigue wins. Always."],
  }),
  p("@OverreactionOwl", "jalen", true, ["hype", "hate", "witty", "vulgar"], {
    reply: ["{toHandle} overreaction? That's just Tuesday.", "{toHandle} I'm hooting and I'm not sorry.", "{toHandle} fire everybody. Next question."],
    mention: ["{toHandle} let's ruin a reputation before lunch.", "{toHandle} come overreact with a professional."],
    clapback: ["{toHandle} I don't do measured. Get a new owl.", "{toHandle} hoot louder. They can hear you."],
  }),
  p("@DraftBustAlert", "fan_hater", true, ["hate", "analysis", "vulgar"], {
    reply: ["{toHandle} bust alarm is a courtesy at this point.", "{toHandle} I had this pick in red the night it happened.", "{toHandle} that's not development, that's denial."],
    mention: ["{toHandle} remind me who drafted this.", "{toHandle} sirens up. You coming?"],
    clapback: ["{toHandle} I alerted. You muted. That's on you.", "{toHandle} busts don't become stars in my mentions."],
  }),
  p("@CoinCounterRec", "fan_stats", false, ["analysis", "witty", "hate"], {
    reply: ["{toHandle} I ran the coins. This is a bad bet.", "{toHandle} value's gone. You're paying retail for a vibe.", "{toHandle} count it again. Still ugly."],
    mention: ["{toHandle} what's the price on that take?", "{toHandle} I don't buy narratives without a receipt."],
    clapback: ["{toHandle} I don't do loyalty discounts.", "{toHandle} the math already left the chat."],
  }),
  p("@GameballGrandma", "fan_homer", false, ["praise", "hype", "witty"], {
    reply: ["{toHandle} grandma liked that. That's rare.", "{toHandle} I'd send a casserole to that locker room.", "{toHandle} play nice but hit somebody, sweetheart."],
    mention: ["{toHandle} come sit, I made comments.", "{toHandle} don't make grandma raise her voice."],
    clapback: ["{toHandle} I can be sweet and still be right.", "{toHandle} finish your plate and your argument."],
  }),
  p("@LeagueOfficeMole", "fan_hater", true, ["hate", "witty", "vulgar"], {
    reply: ["{toHandle} mole says the league already hates this.", "{toHandle} I saw the memo. You're not in it.", "{toHandle} off the record: they're sweating."],
    mention: ["{toHandle} I got dirt. You want it or not?", "{toHandle} don't make me leak around you."],
    clapback: ["{toHandle} sources confirm you're loud and wrong.", "{toHandle} the office called. They want you quieter."],
  }),
  p("@ChainGangChad", "fan_homer", true, ["hype", "trash", "vulgar"], {
    reply: ["{toHandle} Chad says first down. Move the sticks.", "{toHandle} I measure with my eyes and my mouth.", "{toHandle} that was a yard. Don't lie."],
    mention: ["{toHandle} spot it, coward.", "{toHandle} chains out. Let's fight."],
    clapback: ["{toHandle} I already spotted it in your direction. Be happy.", "{toHandle} Chad don't do reviews."],
  }),
  p("@WaiverWireWitch", "fan_stats", true, ["hate", "witty", "vulgar"], {
    reply: ["{toHandle} I hexed that add and I'm not sorry.", "{toHandle} waiver is closed. Suffer.", "{toHandle} you streamed a liar. Classic."],
    mention: ["{toHandle} who are we cursing this week?", "{toHandle} bring an offering or leave the wire."],
    clapback: ["{toHandle} the witch already filed the claim.", "{toHandle} your FAAB is a joke and I spent it."],
  }),
  p("@HatersHuddle", "fan_hater", true, ["hate", "trash", "vulgar", "angry"], {
    reply: ["{toHandle} huddle's in session. Bring hate or leave.", "{toHandle} we don't do hope in here.", "{toHandle} that's the energy. More of that."],
    mention: ["{toHandle} haters need a new target. Nominations?", "{toHandle} come get your jersey roasted."],
    clapback: ["{toHandle} we voted. You lost.", "{toHandle} huddle adjourned. You're still trash."],
  }),
  p("@StatSheetStan", "fan_stats", false, ["analysis", "praise", "witty"], {
    reply: ["{toHandle} Stan already highlighted the cell.", "{toHandle} that's a pretty row. I said pretty, not perfect.", "{toHandle} I live in column G and I'm happy there."],
    mention: ["{toHandle} send the CSV energy.", "{toHandle} if it ain't sortable I don't trust it."],
    clapback: ["{toHandle} I formatted the truth in bold.", "{toHandle} your anecdote lost to my pivot table."],
  }),
  p("@BackupQBTruther", "fan_hater", true, ["hate", "witty", "vulgar"], {
    reply: ["{toHandle} bench him. I've been saying it.", "{toHandle} the backup is the protagonist. Wake up.", "{toHandle} starter's cooked. Clipboard time."],
    mention: ["{toHandle} you seeing what I'm seeing on the sideline?", "{toHandle} truther meeting. Bring a wristband."],
    clapback: ["{toHandle} I will die on this clipboard.", "{toHandle} start the backup or stop talking to me."],
  }),
  p("@GoalLineGossip", "fan_homer", true, ["hype", "witty", "vulgar", "trash"], {
    reply: ["{toHandle} gossip from the 1: it's personal down there.", "{toHandle} I heard what they said in the pile.", "{toHandle} goal line don't keep secrets."],
    mention: ["{toHandle} I got tea from the 2-yard line.", "{toHandle} come closer. This is messy."],
    clapback: ["{toHandle} I never reveal a source. I do reveal a score.", "{toHandle} pile's talking. You're in it."],
  }),
  p("@CutdayCassie", "fan_hater", true, ["hate", "witty", "vulgar"], {
    reply: ["{toHandle} cut day energy already. Pack a bag.", "{toHandle} I have the scissors out.", "{toHandle} roster spot is a privilege. Act like it."],
    mention: ["{toHandle} who we waving tomorrow?", "{toHandle} Cassie is not in a forgiving mood."],
    clapback: ["{toHandle} I already wrote the release.", "{toHandle} don't text me after you get cut."],
  }),
  p("@FourthQuarterFred", "fan_homer", false, ["hype", "angry", "praise"], {
    reply: ["{toHandle} Fred only talks when it matters.", "{toHandle} fourth quarter people stand up.", "{toHandle} that's a closer's tweet."],
    mention: ["{toHandle} two-minute. You with me?", "{toHandle} don't disappear when it gets loud."],
    clapback: ["{toHandle} I eat in the fourth. Sit down.", "{toHandle} you were real quiet in Q1. Noted."],
  }),
  p("@BlitzPickupBetty", "fan_homer", true, ["hype", "trash", "vulgar"], {
    reply: ["{toHandle} Betty's bringing the house.", "{toHandle} pickup blitz. Somebody's about to eat turf.", "{toHandle} I heard the call and I smiled."],
    mention: ["{toHandle} you covering the hot or you guessing?", "{toHandle} come get buried with me."],
    clapback: ["{toHandle} free runner. That's on you.", "{toHandle} I don't blitz politely."],
  }),
];

const PERSONA_BY_HANDLE = new Map<string, AccountPersona>(
  [...HOST_PERSONAS, ...GENERIC_PERSONAS].map((persona) => [persona.handle.toLowerCase(), persona]),
);

export function personaForHandle(handle: string): AccountPersona | null {
  return PERSONA_BY_HANDLE.get(handle.trim().toLowerCase()) ?? null;
}

export function playerVoiceFromTraits(input: {
  traits?: string[] | null;
  tonePraiseWeight?: number | null;
}): { family: VoiceFamily; vulgar: boolean; moods: ConversationMood[] } {
  const weight = input.tonePraiseWeight ?? 0.5;
  const traits = new Set(input.traits ?? []);
  const instigate = ["Win At All Costs", "Aggressive", "Overly Competitive", "Outspoken", "Intense", "Headstrong", "Uncompromising"].some((name) => traits.has(name));
  const praise = ["Team First", "Mentor", "Respectful", "Diplomatic", "Grounded", "Collaborative"].some((name) => traits.has(name));
  if (instigate || weight < 0.4) {
    return { family: "player_instigate", vulgar: true, moods: ["trash", "angry", "hype", "vulgar", "hate"] };
  }
  if (praise || weight > 0.65) {
    return { family: "player_praise", vulgar: false, moods: ["praise", "hype", "witty"] };
  }
  return { family: "player_mixed", vulgar: true, moods: ["hype", "trash", "witty", "praise", "angry"] };
}
