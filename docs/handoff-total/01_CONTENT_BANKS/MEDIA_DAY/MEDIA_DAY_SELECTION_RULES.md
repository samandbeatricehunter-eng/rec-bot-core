# Media Day Selection and Answer Rules

## Canonical banks
- Offseason/stage questions: `offseason_media_day_questions.json`
- Weekly challenge questions: `weekly_challenge_media_questions.json`
- RTI questions: `rti_media_day_questions.json`
- Answer families: `answer_families.json`
- Semantic answer bank: `answer_bank.json`
- Clarifying questions: `clarifiers.json`
- Confidence/contract/Dev event questions: dedicated bank in `CONFIDENCE_CONTRACT_DEV`

## Selection
Build a context snapshot first, then:
1. filter to the current event/stage;
2. remove templates with unresolved required placeholders;
3. strongly prefer exact event tags such as pickup, champion, missed_playoffs, rookie, prior_statement;
4. penalize recent repetition for the same user/topic;
5. select deterministically from the best matching candidates;
6. store the chosen template ID, rendered wording and context snapshot permanently.

## Free Agent Frenzy
REC does not model or expose Madden's internal Free Agent Frenzy rounds on the site.

### Opening interview
`free_agency_open` fires **when REC advances into the Free Agency stage**.

That is the only Free Agent Frenzy interview shown while REC is in Free Agency. Internal Madden bidding rounds do not create REC advances, site stages, Media Day events, or any other user-facing REC state.

The stored opening answer can carry target position, named target, aggression level and stated priority so REC can compare that statement with the eventual roster outcome.

### Exit interview
REC has no separate "Frenzy complete" action and does not try to infer the final Madden bidding round.

Instead, when the commissioner performs the normal REC **Advance** from Free Agency into the next REC stage:

1. complete the advance;
2. run the normal post-advance import/diff needed to see the final Free Agency roster outcome;
3. generate `free_agency_exit` from that completed Free Agency period;
4. attach it to the **new stage's Media Day interview queue**;
5. show the Free Agency Exit interview **first**, before the new stage's normal interview.

So the first Media Day visit after leaving Free Agency can contain two interviews in this order:

1. **Free Agency Exit** — closes the Free Agency storyline.
2. **Current-stage interview** — opens the stage REC just advanced into.

If the new stage would not otherwise have a Media Day interview, only the appended Free Agency Exit interview is shown.

### Exit question priority
1. meaningful roster pickup detected from the completed Free Agency roster diff;
2. prior Free Agency Open promise/statement;
3. if both exist, prefer a question that can reference both.

The exit interview belongs logically to Free Agency for history/story tracking even though it is displayed after the advance as the first interview in the new stage.

## Weekly challenge Media Day
The challenge engine assigns the primary challenge first.
Then Media Day selects one of that challenge's five question variants.

The 190 primary challenges control this flow.
The 10 Special Teams challenges are secondary and do not replace the primary Media Day assignment.

## Answers
Selectable answers are not text-only.
Each answer stores:
- visible wording
- semantic payload
- resolved canonical entity IDs where applicable

Consequential freeform claims require confidence/confirmation before REC treats them as durable facts.

## Promise ledger
Statements can create durable promises including:
- team need
- free-agency priority
- named target
- draft priority
- player commitment
- expectation
- challenge confidence
- transaction preference

Later verified results classify a promise as fulfilled, partially fulfilled, pivoted or missed.


## Interview depth
Non-RTI:
- normally 2–4 questions total;
- up to 6 only on unusually eventful advances;
- multiple owed topics become phases of one continuous team press conference.

RTI:
- normally 1–3 questions per relevant subject;
- maximum 4 for a subject when the data/story justifies it;
- Owner / Offensive Player / Defensive Player are separate named subjects.

A conditional tone follow-up counts toward the applicable limit.

## Challenge secrecy
Weekly challenge assignment may inform the interview theme, but:
- do not show the challenge name;
- do not show Bronze/Silver/Gold requirements;
- do not tell the user they are answering a challenge question.

The challenge is revealed only after Media Day, Rewards Recap and Media Posture.
