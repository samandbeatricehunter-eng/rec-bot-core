import assert from "node:assert/strict";
import test from "node:test";
import { extractEaEnvelopeRows } from "./ea-datasets.js";

const player = (rosterId: number, extra: Record<string, unknown> = {}) => ({
  rosterId,
  firstName: "Test",
  lastName: `Player${rosterId}`,
  // Nested arrays exist on every real EA player row. A buggy extractor that treats a
  // top-level player array as an object and looks for "the sole array property" would
  // either miss these (Object.values of the array are player objects, not arrays) or,
  // on a single player object, pick signatureSlotList as the "rows".
  signatureSlotList: [{ slot: 0 }],
  ...extra,
});

test("extractEaEnvelopeRows reads snallabot's { rosterInfoList, success, message } envelope", () => {
  const raw = {
    rosterInfoList: [player(1), player(2)],
    message: "",
    success: true,
  };
  const rows = extractEaEnvelopeRows(raw, "rosterInfoList");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.rosterId, 1);
  assert.equal(rows[1]?.rosterId, 2);
});

test("extractEaEnvelopeRows reads a flattened player array (the first-import empty-roster bug)", () => {
  // fetchAllTeamRosters used to return allRows directly. extractEaRows then looked for
  // rosterInfoList on that array; typeof [] === "object", so it never took the array
  // branch, found no rosterInfoList key, and returned [] — aborting the first import.
  const raw = [player(11), player(12), player(13)];
  const rows = extractEaEnvelopeRows(raw, "rosterInfoList");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.rosterId), [11, 12, 13]);
});

test("extractEaEnvelopeRows prefers rosterInfoList when a sibling array exists", () => {
  const raw = {
    rosterInfoList: [player(21)],
    extraList: [{ not: "a player" }],
    success: true,
    message: "",
  };
  const rows = extractEaEnvelopeRows(raw, "rosterInfoList");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.rosterId, 21);
});

test("extractEaEnvelopeRows falls back to the sole array when the envelope key is missing", () => {
  const raw = { leagueTeamInfoList: [{ teamId: 7 }] };
  const rows = extractEaEnvelopeRows(raw, "rosterInfoList");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.teamId, 7);
});

test("extractEaEnvelopeRows returns [] for empty / non-row payloads", () => {
  assert.deepEqual(extractEaEnvelopeRows(null, "rosterInfoList"), []);
  assert.deepEqual(extractEaEnvelopeRows(undefined, "rosterInfoList"), []);
  assert.deepEqual(extractEaEnvelopeRows({}, "rosterInfoList"), []);
  assert.deepEqual(extractEaEnvelopeRows({ rosterInfoList: [] }, "rosterInfoList"), []);
  assert.deepEqual(extractEaEnvelopeRows("nope", "rosterInfoList"), []);
});
