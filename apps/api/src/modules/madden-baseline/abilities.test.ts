import assert from "node:assert/strict";
import test from "node:test";
import { parseAbilitiesRaw } from "./abilities.js";

test("parses concatenated-prose abilities_raw into name/description pairs", () => {
  const raw = "Bazooka Quarterbacks with generational arms have the power to stretch any defense to its breaking point. Fastbreak Passers with this ability receive better blocking support on designed quarterback run plays.";
  const parsed = parseAbilitiesRaw(raw);
  assert.deepEqual(parsed.map((entry) => entry.name), ["Bazooka", "Fastbreak"]);
  assert.match(parsed[0].description, /generational arms/);
  assert.match(parsed[1].description, /blocking support/);
});

test("a short gap between two name-like matches merges into the preceding description instead of splitting", () => {
  // "Dots" appearing mid-sentence with no real description following it must not be treated
  // as the start of a new ability -- MIN_DESCRIPTION_LENGTH exists exactly for this.
  const raw = "Enforcer Defenders with this ability dominate blocks. Dots are on the i.";
  const parsed = parseAbilitiesRaw(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Enforcer");
});

test("detects a structured JSON abilities_raw (id/label/type) and reads it directly, instead of misparsing its own punctuation as description text", () => {
  // Real, confirmed-live shape (Josh Allen, Madden 27 baseline dataset) -- confirmed this used
  // to fall through to the prose scanner, which found "Bazooka" inside the label field and
  // treated the surrounding JSON syntax as its "description".
  const raw = '[{"id":"Z_06","label":"Bazooka","type":"xFactor"},{"id":"035","label":"Fastbreak","type":"superstarAbility"},{"id":"008","label":"Dashing Deadeye","type":"superstarAbility"}]';
  const parsed = parseAbilitiesRaw(raw);
  assert.deepEqual(parsed, [
    { name: "Bazooka", description: "" },
    { name: "Fastbreak", description: "" },
    { name: "Dashing Deadeye", description: "" },
  ]);
});

test("an empty JSON array yields no abilities, not a crash", () => {
  assert.deepEqual(parseAbilitiesRaw("[]"), []);
});

test("null, undefined, and blank input all yield no abilities", () => {
  assert.deepEqual(parseAbilitiesRaw(null), []);
  assert.deepEqual(parseAbilitiesRaw(undefined), []);
  assert.deepEqual(parseAbilitiesRaw("   "), []);
});

test("text that merely starts with '[' but isn't valid JSON falls back to the prose scanner instead of throwing", () => {
  const raw = "[Not actually JSON] Bazooka Quarterbacks with generational arms have the power to stretch any defense to its breaking point.";
  const parsed = parseAbilitiesRaw(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "Bazooka");
});

test("site footer junk after the last real ability is trimmed off", () => {
  const raw = "Bazooka Quarterbacks with generational arms have the power to stretch any defense to its breaking point. View More All images, logos are trademarks of their respective owners.";
  const parsed = parseAbilitiesRaw(raw);
  assert.equal(parsed.length, 1);
  assert.doesNotMatch(parsed[0].description, /View More/);
});
