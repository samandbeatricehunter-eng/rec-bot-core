// Box-score intelligence engine — pure badge + story logic over tracked stats.
//
// Computation happens at box-score IMPORT time (see the blueprint): qualify
// weekly badges, roll up season/global progress, and generate the game story
// from this engine, then persist. Advance only reads and publishes what was
// already computed; it must never run these rules.
export * from "./types.js";
export * from "./badge-rules.js";
export * from "./story-angles.js";
export * from "./game-profile.js";
export * from "./aggregate.js";
// NOTE: ./persistence is intentionally NOT re-exported here — it imports the
// Supabase client (env-dependent). Import it directly where needed so the pure
// engine stays usable without a DB/env (e.g. scripts/badge-rules-verify.ts).
