# RTI Media Day UI 

## Active blocks
Render as a paged stack/carousel rather than three side-by-side cards:
- Offensive Immortal
- Defensive Immortal
- Owner

Show progress, e.g. `1 of 3 statements remaining`, but do not show completed pages again.

## Completion behavior
After primary answer + required clarifier(s) submit successfully:
- mark block complete
- animate/remove it from active page stack
- advance to next incomplete block
- persist so reload does not restore completed blocks

When all three complete, replace the section content with exactly:

**All Media Day Statements Have Been Recorded For This Week.**

## Question focus
Offensive block: the user's offensive custom prospect is the principal subject.
Defensive block: the user's defensive custom prospect is the principal subject.
Owner block: franchise direction, transactions, contracts, roster, rivalry, standings, prospects as a pair.

Opponent/rival/GOTW/POTW/league-leader data is framing context, not a reason to turn a prospect question into a generic league question.

## Clarifiers
Every RTI block has at least one follow-up clarifier. A second clarifier may be invoked for entity or intent selection.
