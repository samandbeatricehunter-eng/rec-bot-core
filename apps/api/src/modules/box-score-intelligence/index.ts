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
