# Final Consistency Audit

## Overall result
The active target is internally coherent after consolidation.

Each active product decision is expressed once, with one authoritative rule per domain.

## Resolved consistency issues

### Commands
Final member set is explicit.
There is no standalone availability command and no draft command.
`/matchup` owns the availability entry point without duplicating the game-channel scheduler.
Rules are ephemeral and have no assigned REC Rules channel.

### Rules channel
REC-specific Rules-channel setup, DB storage and public-post logic are dead relative to the target and are implementation cleanup items.

### Highlight destination
Weekly reels post to Highlights, not Headlines.

### Highlight duration and size
Raw 30–45 second source clips are preserved on the web.
Discord uses fixed 10-second commissioner-approved cuts, 10 clips per part, with each part targeting <=10 MB.

### Legend OVR / Head #
Catalog values do not become canonical merely because a workbook cell is populated.
Capture status requires an actual verified Madden-build source.

Replacement player is never permanent Legend data.

### OVR
Imported roster OVR uses `playerBestOvr`.
REC never predicts post-upgrade OVR.
`playerSchemeOvr` remains supplemental.

### Attribute pricing
The rating-band cost curve is single-source.
Combined post-draft discounts are capped at 35% so high-rating upgrades cannot collapse to trivial cost.

### Dev ceiling batching
One pending batch per player plus a conservative batch-point cap reduces the risk of a large unseen OVR jump without inventing an OVR formula.

### REC career stats
A first-import baseline prevents pre-REC Madden production from leaking into "Career in REC."

### UI
No blur, no full-width ordinary cards, no stretched low-resolution texture.

## Remaining launch gates

### 1. Non-RTI progression node cost map
The final branch names and several approved tier effects are known, and full-tree cost is 133 Franchise XP.

The exact per-node XP cost map is not present in a retrievable authoritative source.

This is a real implementation blocker for enabling the tree.

Do not infer or evenly distribute the 133 XP.

### Ordinary non-RTI Player XP
Resolved.

The final earning system now defines weekly position-specific stat-line tiers, position-relative performance, splash bonuses, streaks, season bonuses, awards/records, postseason treatment, Dev Trait multipliers, anti-farming rules and target progression pace.

### 2. Legend catalog evidence completion
The catalog has a complete rating draft, but not every player has an equally strong player-specific evidence package.

Production-readiness must be per row.

This is work, not an architectural uncertainty.

## Non-blocking discovery

### Madden Persona DNA lock matrix
EA does not publish a complete pairwise matrix.
The observation-based Known/Unknown/Incompatible model handles this safely.

### Temporary Persona DNA import
No verified stable EA field is mapped.
The feature ships without pretending it exists in imported state.

### `playerSchemeOvr`
Its exact scheme semantics are non-blocking.
Keep internal/supplemental until a controlled test confirms behavior.

## Repo-state concerns confirmed during review
The current rules slash flow still contains a public-post control/handler in `apps/bot/src/flows/rules-slash.ts` even though the target no longer has a Rules channel. The handoff explicitly removes that path.

The current repository has also continued changing during planning; the latest reviewed commit removes the REC Guide feature entirely. Implementation must always rebase its phase audit on current `main` rather than assuming the reviewed baseline remains HEAD.

## Final release posture
Everything except the remaining non-RTI progression node-cost configuration gate can be handed to implementation now.

The progression infrastructure can be implemented now as config-driven. The six-department tree remains feature-gated until its exact node cost map is supplied and simulation-tested.
