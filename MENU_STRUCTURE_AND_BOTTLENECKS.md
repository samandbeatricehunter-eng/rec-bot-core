# Historical Menu Bottleneck Analysis

This file is retained only as a historical note. It predates the platform trim and refers to menu branches and API modules that are no longer exposed.

Current canonical status lives in `docs/menu-map.md`.

Post-trim bottlenecks:

- Rebuild imports before restoring schedule management.
- Rebuild advance before restoring GOTW, POTW, game channels, weekly automation, and EOS flows.
- Build player-facing store, wager, screenshots, team requests, and richer schedule views as separate slices.
- Keep schema/table drops out of the trim until rebuilt feature ownership is stable.
