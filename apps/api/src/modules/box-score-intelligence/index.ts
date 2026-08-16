// Box-score intelligence engine — pure story/profile logic over tracked stats.
//
// Computation happens at box-score IMPORT time: generate the game story and
// tactical profile from this engine, then persist. Advance only reads and
// publishes what was already computed; it must never run these rules.
export * from "./types.js";
export * from "./story-angles.js";
export * from "./game-profile.js";
// NOTE: ./persistence is intentionally NOT re-exported here — it imports the
// Supabase client (env-dependent). Import it directly where needed so the pure
// engine stays usable without a DB/env.
