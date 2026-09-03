// Conversation banks keyed by voice family so a film-room account never sounds like a
// hater huddle, and a player with praise lean never reads like Jalen. tweet-generation
// mixes these with per-account signatures from tweet-bank-voices.ts and rejects recently
// used template keys so the channel doesn't loop the same exchange.

export type ConversationKind = "reply" | "mention" | "clapback";
export type ConversationMood =
  | "praise" | "hate" | "trash" | "angry" | "hype" | "analysis" | "vulgar" | "witty";
export type VoiceFamily =
  | "marcus" | "jalen" | "elliot" | "darius"
  | "media" | "analyst" | "fan_hater" | "fan_homer" | "fan_stats"
  | "player_praise" | "player_instigate" | "player_mixed";

export type ConversationTemplate = { kind: ConversationKind; mood: ConversationMood; family: VoiceFamily; text: string };

function line(family: VoiceFamily, kind: ConversationKind, mood: ConversationMood, text: string): ConversationTemplate {
  return { family, kind, mood, text };
}

export function conversationTemplateKey(text: string): string {
  return text.replace(/\{[^}]+\}/g, "{}").replace(/@\w+/g, "{}").toLowerCase().replace(/\s+/g, " ").trim();
}

const MARCUS: ConversationTemplate[] = [
  line("marcus", "reply", "analysis", "{toHandle} I need a second look before I climb on that."),
  line("marcus", "reply", "analysis", "{toHandle} the result is fine. The operation is what I'm grading."),
  line("marcus", "reply", "analysis", "{toHandle} that's September talk. I live in December tape."),
  line("marcus", "reply", "witty", "{toHandle} you're faster than my board and that's not a compliment."),
  line("marcus", "reply", "praise", "{toHandle} I'll give the process its due. I still want it repeated."),
  line("marcus", "reply", "analysis", "{toHandle} one clean week against a soft look isn't a profile change."),
  line("marcus", "reply", "witty", "{toHandle} if the timeline is this sure, I get more careful."),
  line("marcus", "reply", "analysis", "{toHandle} show me the same feet against a real four-man rush."),
  line("marcus", "mention", "analysis", "{toHandle} rank him where the tape says, not where the clip says."),
  line("marcus", "mention", "witty", "{toHandle} I want your Tuesday evaluation, not your Sunday one."),
  line("marcus", "mention", "analysis", "{toHandle} don't promote a sample size of one on my timeline."),
  line("marcus", "mention", "praise", "{toHandle} if you saw the same details I did, say which ones."),
  line("marcus", "clapback", "analysis", "{toHandle} I can like the player and still wait on the proof."),
  line("marcus", "clapback", "witty", "{toHandle} yelling doesn't move my board. Repetition does."),
  line("marcus", "clapback", "analysis", "{toHandle} I'm not hedging. I'm refusing to guess."),
  line("marcus", "clapback", "praise", "{toHandle} when he stacks it, I'll be first to say so. Not before."),
];

const JALEN: ConversationTemplate[] = [
  line("jalen", "reply", "hype", "{toHandle} YES. Talk your shit."),
  line("jalen", "reply", "vulgar", "{toHandle} that's nasty and I need it louder."),
  line("jalen", "reply", "angry", "{toHandle} how is this even a debate. Watch the damn game."),
  line("jalen", "reply", "trash", "{toHandle} somebody catch a body after this tweet."),
  line("jalen", "reply", "hate", "{toHandle} the slander should be illegal after that."),
  line("jalen", "reply", "vulgar", "{toHandle} sit down. You're embarrassing yourself."),
  line("jalen", "reply", "hype", "{toHandle} I'm screaming in the car. This is it."),
  line("jalen", "reply", "trash", "{toHandle} they got cooked and you still defending them? Wild."),
  line("jalen", "mention", "trash", "{toHandle} come get cooked in public."),
  line("jalen", "mention", "vulgar", "{toHandle} don't lurk. Say the disrespectful thing."),
  line("jalen", "mention", "angry", "{toHandle} I know you saw that. Don't play cute."),
  line("jalen", "mention", "hype", "{toHandle} we turning this into a problem on purpose."),
  line("jalen", "clapback", "vulgar", "{toHandle} I will die on this hill and mock you from it."),
  line("jalen", "clapback", "trash", "{toHandle} keep the essay. I brought a flamethrower."),
  line("jalen", "clapback", "angry", "{toHandle} you thought I was playing. I'm not."),
  line("jalen", "clapback", "hate", "{toHandle} blocked in my heart. Still reading you for sport."),
];

const ELLIOT: ConversationTemplate[] = [
  line("elliot", "reply", "analysis", "{toHandle} I need the rate, not the total."),
  line("elliot", "reply", "analysis", "{toHandle} one week moved the mean. It did not rewrite the prior."),
  line("elliot", "reply", "witty", "{toHandle} that's a feeling with a number taped to it."),
  line("elliot", "reply", "analysis", "{toHandle} wait for the opponent-adjusted look. Please."),
  line("elliot", "reply", "praise", "{toHandle} the efficiency actually backs you this time. Rare."),
  line("elliot", "reply", "witty", "{toHandle} I already had a cell for this. You're late to my sheet."),
  line("elliot", "reply", "analysis", "{toHandle} small sample, loud take. I won't publish that pairing."),
  line("elliot", "reply", "analysis", "{toHandle} split it by down. The headline disappears."),
  line("elliot", "mention", "analysis", "{toHandle} send a per-play number or I'm ignoring the speech."),
  line("elliot", "mention", "witty", "{toHandle} I will not be rushed by a quote tweet."),
  line("elliot", "mention", "analysis", "{toHandle} define the metric before we fight."),
  line("elliot", "mention", "praise", "{toHandle} if your model's with you, show the output."),
  line("elliot", "clapback", "analysis", "{toHandle} the model didn't flinch. I won't either."),
  line("elliot", "clapback", "witty", "{toHandle} being early is not a methodology."),
  line("elliot", "clapback", "analysis", "{toHandle} I'll update when the n increases. Not when you yell."),
  line("elliot", "clapback", "witty", "{toHandle} save the coronation for a two-week stack."),
];

const DARIUS: ConversationTemplate[] = [
  line("darius", "reply", "hype", "{toHandle} that's a competitor. I don't need the rest."),
  line("darius", "reply", "trash", "{toHandle} want-to showed up. Scheme can catch the bus."),
  line("darius", "reply", "vulgar", "{toHandle} that was a nasty attitude. I love it."),
  line("darius", "reply", "praise", "{toHandle} locker room knows. Timeline's just late."),
  line("darius", "reply", "angry", "{toHandle} don't compliment the stat and ignore the violence."),
  line("darius", "reply", "hype", "{toHandle} that's how you set a standard in public."),
  line("darius", "reply", "trash", "{toHandle} they felt that. You can see it in the jog back."),
  line("darius", "reply", "analysis", "{toHandle} pre-snap answers. That's the whole game."),
  line("darius", "mention", "hype", "{toHandle} come talk like you still play."),
  line("darius", "mention", "trash", "{toHandle} I want the competitive version of you, not the polite one."),
  line("darius", "mention", "vulgar", "{toHandle} say it with your chest or get out the circle."),
  line("darius", "mention", "praise", "{toHandle} you know a dog when you see one. Say it."),
  line("darius", "clapback", "trash", "{toHandle} I ain't here to make friends with a take."),
  line("darius", "clapback", "vulgar", "{toHandle} keep it cute. I'll keep it honest."),
  line("darius", "clapback", "hype", "{toHandle} we can shake hands after the whistle."),
  line("darius", "clapback", "angry", "{toHandle} you wanted edge. Don't flinch now."),
];

const MEDIA: ConversationTemplate[] = [
  line("media", "reply", "hype", "{toHandle} that's the hit. We're leading with it."),
  line("media", "reply", "analysis", "{toHandle} we need a second source and then it's a blast."),
  line("media", "reply", "witty", "{toHandle} don't delete, we already screenshotted."),
  line("media", "reply", "hype", "{toHandle} push alert energy. Keep talking."),
  line("media", "reply", "analysis", "{toHandle} we'll dress it for the AM. Don't add fluff."),
  line("media", "reply", "witty", "{toHandle} that's a better lede than our intern wrote."),
  line("media", "reply", "praise", "{toHandle} clean quote. That's going on the graphic."),
  line("media", "reply", "angry", "{toHandle} if that's true it's a bigger story than you're treating it."),
  line("media", "mention", "hype", "{toHandle} 15 seconds for the recap. Go."),
  line("media", "mention", "analysis", "{toHandle} on record or we write around you."),
  line("media", "mention", "witty", "{toHandle} we saving you a chryon. Don't waste it."),
  line("media", "mention", "hype", "{toHandle} live hit. You in or we move?"),
  line("media", "clapback", "witty", "{toHandle} too late — it's already in the rundown."),
  line("media", "clapback", "analysis", "{toHandle} we filed it. Send a correction if you have one."),
  line("media", "clapback", "hype", "{toHandle} thanks for the content. Truly."),
  line("media", "clapback", "witty", "{toHandle} next segment is your rebuttal. Bring facts."),
];

const ANALYST: ConversationTemplate[] = [
  line("analyst", "reply", "analysis", "{toHandle} I need the alignment, not the adjective."),
  line("analyst", "reply", "analysis", "{toHandle} that's a leverage problem dressed up as a narrative."),
  line("analyst", "reply", "witty", "{toHandle} the clip starts too late to prove your point."),
  line("analyst", "reply", "analysis", "{toHandle} watch the unblocked man, then rewrite the tweet."),
  line("analyst", "reply", "praise", "{toHandle} that's the right detail. People are staring at the ball."),
  line("analyst", "reply", "angry", "{toHandle} you can't grade a coverage you didn't identify."),
  line("analyst", "reply", "analysis", "{toHandle} feet first. Outcome second. Always."),
  line("analyst", "reply", "witty", "{toHandle} All-22 would humble that sentence."),
  line("analyst", "mention", "analysis", "{toHandle} name the coverage or I'm gone."),
  line("analyst", "mention", "witty", "{toHandle} film room's open. Leave the slogans."),
  line("analyst", "mention", "analysis", "{toHandle} send the cutup if you actually watched it."),
  line("analyst", "mention", "praise", "{toHandle} if you saw the same tell I did, say it."),
  line("analyst", "clapback", "analysis", "{toHandle} I paused it. Your story doesn't survive the pause."),
  line("analyst", "clapback", "witty", "{toHandle} rewind it. I'll wait."),
  line("analyst", "clapback", "analysis", "{toHandle} that's a highlight grade. I'm not in that business."),
  line("analyst", "clapback", "angry", "{toHandle} don't lecture scheme if you missed the motion."),
];

const FAN_HATER: ConversationTemplate[] = [
  line("fan_hater", "reply", "hate", "{toHandle} I hate this and I'm comfortable here."),
  line("fan_hater", "reply", "vulgar", "{toHandle} this is some bullshit and everybody knows it."),
  line("fan_hater", "reply", "trash", "{toHandle} they stink. Say it with me."),
  line("fan_hater", "reply", "angry", "{toHandle} I'm not calming down. This is the point."),
  line("fan_hater", "reply", "witty", "{toHandle} hope is a personality defect."),
  line("fan_hater", "reply", "hate", "{toHandle} I called this in August and I'm still mad."),
  line("fan_hater", "reply", "vulgar", "{toHandle} pack it up. That's a wrap."),
  line("fan_hater", "reply", "trash", "{toHandle} fraud watch just hit overtime."),
  line("fan_hater", "mention", "hate", "{toHandle} come hate with the professionals."),
  line("fan_hater", "mention", "vulgar", "{toHandle} don't bring hope in here."),
  line("fan_hater", "mention", "trash", "{toHandle} nominate a new victim. I'm bored."),
  line("fan_hater", "mention", "witty", "{toHandle} I have scissors and a spreadsheet."),
  line("fan_hater", "clapback", "hate", "{toHandle} we voted. You lost. Sit."),
  line("fan_hater", "clapback", "vulgar", "{toHandle} stay mad. It's my favorite color."),
  line("fan_hater", "clapback", "trash", "{toHandle} I don't do moral victories."),
  line("fan_hater", "clapback", "angry", "{toHandle} keep defending them. It's funny."),
];

const FAN_HOMER: ConversationTemplate[] = [
  line("fan_homer", "reply", "hype", "{toHandle} I'M STANDING UP IN THE BLEACHERS."),
  line("fan_homer", "reply", "praise", "{toHandle} that's my guy. I don't care who hears it."),
  line("fan_homer", "reply", "vulgar", "{toHandle} they ate and I'm unwell in a good way."),
  line("fan_homer", "reply", "hype", "{toHandle} play it again. I paid for this feeling."),
  line("fan_homer", "reply", "trash", "{toHandle} say that to the other sideline."),
  line("fan_homer", "reply", "witty", "{toHandle} beer' s warm, take's hotter."),
  line("fan_homer", "reply", "praise", "{toHandle} put some respect on it. Now."),
  line("fan_homer", "reply", "hype", "{toHandle} that's a closer. That's a dawg."),
  line("fan_homer", "mention", "hype", "{toHandle} you seeing this from your seat?"),
  line("fan_homer", "mention", "praise", "{toHandle} come celebrate before the haters arrive."),
  line("fan_homer", "mention", "trash", "{toHandle} we talking smoke or you lurking?"),
  line("fan_homer", "mention", "witty", "{toHandle} cheap seats, expensive opinions. Hop in."),
  line("fan_homer", "clapback", "hype", "{toHandle} I'll be loud till the lights die."),
  line("fan_homer", "clapback", "trash", "{toHandle} you can sit. We're not."),
  line("fan_homer", "clapback", "praise", "{toHandle} I was here in the bad years. Let me have this."),
  line("fan_homer", "clapback", "vulgar", "{toHandle} don't dull my night. Get your own."),
];

const FAN_STATS: ConversationTemplate[] = [
  line("fan_stats", "reply", "analysis", "{toHandle} I already have the row. You're describing it."),
  line("fan_stats", "reply", "witty", "{toHandle} pretty total, ugly volume."),
  line("fan_stats", "reply", "analysis", "{toHandle} per-play it dies. Sorry."),
  line("fan_stats", "reply", "hate", "{toHandle} that's empty calories and you know it."),
  line("fan_stats", "reply", "witty", "{toHandle} I don't trust a stat that needs a speech."),
  line("fan_stats", "reply", "analysis", "{toHandle} show attempts or I'm gone."),
  line("fan_stats", "reply", "praise", "{toHandle} the efficiency is actually real this time."),
  line("fan_stats", "reply", "analysis", "{toHandle} I highlighted the cell. That's the tweet."),
  line("fan_stats", "mention", "analysis", "{toHandle} CSV or it didn't happen."),
  line("fan_stats", "mention", "witty", "{toHandle} quote a number I can sort."),
  line("fan_stats", "mention", "analysis", "{toHandle} I want the split, not the vibe."),
  line("fan_stats", "mention", "hate", "{toHandle} your projection is a crime."),
  line("fan_stats", "clapback", "analysis", "{toHandle} the sheet already answered you."),
  line("fan_stats", "clapback", "witty", "{toHandle} I formatted the truth in bold."),
  line("fan_stats", "clapback", "analysis", "{toHandle} feelings aren't a rate stat."),
  line("fan_stats", "clapback", "hate", "{toHandle} I faded this. Invoice is pride."),
];

const PLAYER_PRAISE: ConversationTemplate[] = [
  line("player_praise", "reply", "praise", "{toHandle} respect. That's how you talk about the work."),
  line("player_praise", "reply", "hype", "{toHandle} I see you. Keep going."),
  line("player_praise", "reply", "witty", "{toHandle} you said it nicer than I would. I'll take it."),
  line("player_praise", "reply", "praise", "{toHandle} locker room already knew. Glad it's public."),
  line("player_praise", "reply", "hype", "{toHandle} that's a teammate tweet. I like that."),
  line("player_praise", "reply", "praise", "{toHandle} flowers while we're still playing. Thank you."),
  line("player_praise", "reply", "witty", "{toHandle} I'll take the compliment and still show up tomorrow."),
  line("player_praise", "reply", "hype", "{toHandle} we needed that energy tonight."),
  line("player_praise", "mention", "praise", "{toHandle} you already know I got you."),
  line("player_praise", "mention", "hype", "{toHandle} come get your flowers before I steal them."),
  line("player_praise", "mention", "witty", "{toHandle} don't be shy, I tagged you on purpose."),
  line("player_praise", "mention", "praise", "{toHandle} real ones talk like this."),
  line("player_praise", "clapback", "praise", "{toHandle} appreciate you. We good."),
  line("player_praise", "clapback", "hype", "{toHandle} I'll stand on the kind version too."),
  line("player_praise", "clapback", "witty", "{toHandle} I'm smiling. That's not me folding."),
  line("player_praise", "clapback", "praise", "{toHandle} love the back and forth. Keep it clean-ish."),
];

const PLAYER_INSTIGATE: ConversationTemplate[] = [
  line("player_instigate", "reply", "trash", "{toHandle} I see you talking. Don't duck."),
  line("player_instigate", "reply", "vulgar", "{toHandle} that's crazy. Say it again."),
  line("player_instigate", "reply", "angry", "{toHandle} you posted that like I wouldn't see it."),
  line("player_instigate", "reply", "trash", "{toHandle} keep my name out your mouth or put it in lights."),
  line("player_instigate", "reply", "hype", "{toHandle} I want all the smoke. Send the address."),
  line("player_instigate", "reply", "vulgar", "{toHandle} sit down before you get embarrassed."),
  line("player_instigate", "reply", "hate", "{toHandle} you real comfortable for somebody I line up across."),
  line("player_instigate", "reply", "trash", "{toHandle} I don't forget tweets. Or snaps."),
  line("player_instigate", "mention", "trash", "{toHandle} run it back. I got time."),
  line("player_instigate", "mention", "vulgar", "{toHandle} you been quiet. I noticed."),
  line("player_instigate", "mention", "angry", "{toHandle} don't hide behind a recap account."),
  line("player_instigate", "mention", "hype", "{toHandle} tag me next time. I like it live."),
  line("player_instigate", "clapback", "vulgar", "{toHandle} I said what I said. Come see me."),
  line("player_instigate", "clapback", "trash", "{toHandle} you wanted a reply. Here it is."),
  line("player_instigate", "clapback", "angry", "{toHandle} keep talking. I'm filing this."),
  line("player_instigate", "clapback", "hype", "{toHandle} this the fun part. Don't get soft now."),
];

const PLAYER_MIXED: ConversationTemplate[] = [
  line("player_mixed", "reply", "witty", "{toHandle} you're not wrong. You're just loud."),
  line("player_mixed", "reply", "hype", "{toHandle} I was gonna let it slide. Then I didn't."),
  line("player_mixed", "reply", "trash", "{toHandle} love the energy. Hate that it's pointed at me."),
  line("player_mixed", "reply", "praise", "{toHandle} I'll give you that one. Don't get used to it."),
  line("player_mixed", "reply", "vulgar", "{toHandle} this is messy and I'm in it now."),
  line("player_mixed", "reply", "angry", "{toHandle} you pulled me in. That's on you."),
  line("player_mixed", "reply", "witty", "{toHandle} quote-tweet energy without the button."),
  line("player_mixed", "reply", "hype", "{toHandle} we can do this all night."),
  line("player_mixed", "mention", "witty", "{toHandle} you and me. Right now."),
  line("player_mixed", "mention", "hype", "{toHandle} don't leave me hanging in public."),
  line("player_mixed", "mention", "trash", "{toHandle} I tagged you with love. Mostly."),
  line("player_mixed", "mention", "vulgar", "{toHandle} hop in before I say something I mean."),
  line("player_mixed", "clapback", "witty", "{toHandle} I hear you. Loud and half-right."),
  line("player_mixed", "clapback", "trash", "{toHandle} we good. Competitive. Different."),
  line("player_mixed", "clapback", "hype", "{toHandle} I'll give you the last word if you earn it."),
  line("player_mixed", "clapback", "praise", "{toHandle} respect the reply. Still not taking mine down."),
];

export const CONVERSATION_TEMPLATES: ConversationTemplate[] = [
  ...MARCUS, ...JALEN, ...ELLIOT, ...DARIUS, ...MEDIA, ...ANALYST,
  ...FAN_HATER, ...FAN_HOMER, ...FAN_STATS, ...PLAYER_PRAISE, ...PLAYER_INSTIGATE, ...PLAYER_MIXED,
];

export function selectConversationLine(input: {
  kind: ConversationKind;
  family: VoiceFamily;
  moods: ConversationMood[];
  vulgar: boolean;
  signatures: string[];
  usedKeys: Iterable<string>;
}): string | null {
  const used = new Set([...input.usedKeys].map((key) => key.toLowerCase()));
  const familyLines = CONVERSATION_TEMPLATES.filter((tmpl) =>
    tmpl.kind === input.kind
    && tmpl.family === input.family
    && input.moods.includes(tmpl.mood)
    && (input.vulgar || tmpl.mood !== "vulgar"));
  const fallbackFamily = CONVERSATION_TEMPLATES.filter((tmpl) =>
    tmpl.kind === input.kind && tmpl.family === input.family && (input.vulgar || tmpl.mood !== "vulgar"));
  const pool = [
    ...input.signatures.map((text) => ({ text, signature: true })),
    ...familyLines.map((tmpl) => ({ text: tmpl.text, signature: false })),
    ...fallbackFamily.map((tmpl) => ({ text: tmpl.text, signature: false })),
  ];
  const fresh = pool.filter((item) => !used.has(conversationTemplateKey(item.text)));
  const preferred = fresh.filter((item) => item.signature);
  const source = preferred.length && Math.random() < 0.55
    ? preferred
    : (fresh.length ? fresh : pool);
  if (!source.length) return null;
  return source[Math.floor(Math.random() * source.length)]!.text;
}
