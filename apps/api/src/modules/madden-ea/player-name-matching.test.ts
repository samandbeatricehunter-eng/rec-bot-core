import assert from "node:assert/strict";
import test from "node:test";
import { levenshtein, normalizePlayerName } from "./player-name-matching.js";

test("normalizePlayerName strips accents, punctuation, and collapses whitespace", () => {
  assert.equal(normalizePlayerName("O'Brien"), "obrien");
  assert.equal(normalizePlayerName("Jean-Baptiste"), "jeanbaptiste");
  assert.equal(normalizePlayerName("Déjà"), "deja"); // Déjà -> deja
  assert.equal(normalizePlayerName("  Payton   Manning "), "payton manning");
  assert.equal(normalizePlayerName(null), "");
});

test("levenshtein distance is 0 for identical strings and symmetric", () => {
  assert.equal(levenshtein("manning", "manning"), 0);
  assert.equal(levenshtein("manning", "mannning"), 1);
  assert.equal(levenshtein("payton manning", "peyton manning"), 1);
  assert.equal(levenshtein("smith", "jones"), levenshtein("jones", "smith"));
});

test("levenshtein treats real name substitutions as small, unrelated names as large", () => {
  // A single-letter typo/nickname drift should be a tiny distance...
  assert.ok(levenshtein("cj stroud", "c.j. stroud".replace(/\./g, "")) <= 1);
  // ...while two genuinely different names should not accidentally look close.
  assert.ok(levenshtein("tom brady", "aaron rodgers") > 5);
});
