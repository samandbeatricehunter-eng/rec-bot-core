# Media Day Carry-Forward Queue Rule

## Free Agency carry-forward
Free Agency has one opening interview and one closing interview.

### Entering Free Agency
On REC Advance into Free Agency:
- create/show `free_agency_open`;
- store its semantic answer and any durable promises.

### While in Free Agency
REC does nothing special between Madden Free Agent Frenzy bidding rounds.
There is:
- no REC round counter;
- no per-round interview;
- no site control for completing Frenzy;
- no attempt to detect which internal Madden round the commissioner is on.

### Leaving Free Agency
On the normal REC Advance out of Free Agency:
- complete the new REC stage transition first;
- obtain the post-advance roster/import state;
- compare it with the Free Agency opening snapshot;
- generate `free_agency_exit`;
- enqueue that interview onto the destination stage;
- assign it queue priority ahead of that destination stage's own interview.

Display order:
1. Free Agency Exit
2. Destination-stage Media Day interview

The Free Agency Exit record retains `origin_stage = free_agency` and `event_type = free_agency_exit`; its display stage is the destination stage only because that is when the completed outcome is available.

## Idempotency
Use a stable key such as:
`league_id + season + free_agency_stage_instance + free_agency_exit`

A repeated import, page refresh, retry or duplicated advance callback must not create a second Free Agency Exit interview.

## Failure handling
If the post-advance import has not completed successfully:
- do not fabricate an exit evaluation;
- keep the carry-forward interview pending;
- surface the destination stage's normal interview only if product rules allow it independently;
- once a verified roster snapshot is available, generate and prepend the exit interview.

No commissioner action is required beyond the ordinary REC Advance.
