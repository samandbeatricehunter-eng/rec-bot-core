import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../lib/errors.js";
import { assertPurchaseDeadlineOpen } from "./purchase-deadlines.js";

test("purchase deadline stays open before the configured week", () => {
  assert.doesNotThrow(() =>
    assertPurchaseDeadlineOpen({
      purchaseType: "custom_player",
      deadlines: { custom_player: { stage: "regular_season", week: 5 } },
      currentStage: "regular_season",
      currentWeek: 4,
    }),
  );
});

test("purchase deadline closes after the same stage week", () => {
  assert.throws(
    () =>
      assertPurchaseDeadlineOpen({
        purchaseType: "custom_player",
        deadlines: { custom_player: { stage: "regular_season", week: 5 } },
        currentStage: "regular_season",
        currentWeek: 6,
      }),
    (error: unknown) => error instanceof ApiError && error.statusCode === 409,
  );
});

test("purchase deadline closes after a later stage", () => {
  assert.throws(
    () =>
      assertPurchaseDeadlineOpen({
        purchaseType: "custom_player",
        deadlines: { custom_player: { stage: "regular_season", week: 18 } },
        currentStage: "wild_card",
        currentWeek: 1,
      }),
    (error: unknown) => error instanceof ApiError && error.statusCode === 409,
  );
});

test("enabled: false bypasses an otherwise-passed deadline, keeping the schedule on file", () => {
  assert.doesNotThrow(() =>
    assertPurchaseDeadlineOpen({
      purchaseType: "custom_player",
      deadlines: { custom_player: { stage: "regular_season", week: 5 } },
      enabled: false,
      currentStage: "regular_season",
      currentWeek: 99,
    }),
  );
});

test("enabled defaults to true when omitted -- a passed deadline still blocks", () => {
  assert.throws(
    () =>
      assertPurchaseDeadlineOpen({
        purchaseType: "custom_player",
        deadlines: { custom_player: { stage: "regular_season", week: 5 } },
        currentStage: "regular_season",
        currentWeek: 6,
      }),
    (error: unknown) => error instanceof ApiError && error.statusCode === 409,
  );
});

test("missing or malformed deadlines are a no-op", () => {
  assert.doesNotThrow(() =>
    assertPurchaseDeadlineOpen({
      purchaseType: "custom_player",
      deadlines: null,
      currentStage: "regular_season",
      currentWeek: 99,
    }),
  );
  assert.doesNotThrow(() =>
    assertPurchaseDeadlineOpen({
      purchaseType: "custom_player",
      deadlines: ["not", "an", "object"],
      currentStage: "regular_season",
      currentWeek: 99,
    }),
  );
  assert.doesNotThrow(() =>
    assertPurchaseDeadlineOpen({
      purchaseType: "custom_player",
      deadlines: { custom_player: "week-5" },
      currentStage: "regular_season",
      currentWeek: 99,
    }),
  );
  assert.doesNotThrow(() =>
    assertPurchaseDeadlineOpen({
      purchaseType: "custom_player",
      deadlines: { custom_player: { stage: "", week: 5 } },
      currentStage: "regular_season",
      currentWeek: 99,
    }),
  );
  assert.doesNotThrow(() =>
    assertPurchaseDeadlineOpen({
      purchaseType: "custom_player",
      deadlines: { other_type: { stage: "regular_season", week: 1 } },
      currentStage: "regular_season",
      currentWeek: 99,
    }),
  );
});
