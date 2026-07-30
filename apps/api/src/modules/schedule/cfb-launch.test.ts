import assert from "node:assert/strict";
import test from "node:test";
import { CFB_27_TEAMS, CFB_BOWL_NAMES, normalizeCfbDifficulty } from "@rec/shared";
import { bracketDefinition } from "./cfp-bracket.service.js";

test("CFB 27 catalog contains 138 playable teams with unique identities", () => {
  const playable = CFB_27_TEAMS.filter((team) => !team.isSchedulePlaceholder);
  assert.equal(playable.length, 138);
  assert.equal(new Set(playable.map((team) => team.name)).size, 138);
  assert.equal(new Set(playable.map((team) => team.abbreviation)).size, 138);
  const byAbbr = new Map(playable.map((team) => [team.abbreviation, team]));
  assert.equal(byAbbr.get("NDSU")?.mascot, "Bison");
  assert.equal(byAbbr.get("SAC")?.mascot, "Hornets");
  assert.equal(byAbbr.get("NIU")?.conference, "Mountain West");
  assert.equal(byAbbr.get("TXST")?.conference, "Pac-12");
});

test("CFB legacy difficulty values normalize to CFB-specific values", () => {
  assert.equal(normalizeCfbDifficulty("all_madden"), "heisman");
  assert.equal(normalizeCfbDifficulty("all_pro"), "all_american");
  assert.equal(normalizeCfbDifficulty("pro"), "varsity");
});

test("CFP bracket uses the official first-round seed pairings", () => {
  const seeds = new Map(Array.from({ length: 12 }, (_, index) => [index + 1, `team-${index + 1}`]));
  assert.deepEqual(
    bracketDefinition(seeds).firstRound.map((slot) => [slot.homeSeed, slot.awaySeed]),
    [[5, 12], [6, 11], [7, 10], [8, 9]],
  );
});

test("bowl catalog includes real bowls and a final unrestricted Custom Bowl", () => {
  assert.equal(CFB_BOWL_NAMES.at(-1), "Custom Bowl");
  assert.ok(CFB_BOWL_NAMES.includes("Rose Bowl Game"));
  assert.ok(CFB_BOWL_NAMES.includes("Allstate Sugar Bowl"));
});
