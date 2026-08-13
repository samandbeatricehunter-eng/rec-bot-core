import assert from "node:assert/strict";
import test from "node:test";

import {
  REC_IMMORTAL_PRICE,
  REC_LEGEND_PRICE,
  REC_SPECIAL_TEAMS_LEGEND_PRICE,
  priceForPurchase,
} from "./purchases.js";

test("K and P legends always use the special-teams price", () => {
  assert.equal(priceForPurchase("legend", { position: "K", legendTier: "legend" }), REC_SPECIAL_TEAMS_LEGEND_PRICE);
  assert.equal(priceForPurchase("legend", { position: "P", legendTier: "immortal" }), REC_SPECIAL_TEAMS_LEGEND_PRICE);
});

test("other legends retain their tier price", () => {
  assert.equal(priceForPurchase("legend", { position: "QB", legendTier: "legend" }), REC_LEGEND_PRICE);
  assert.equal(priceForPurchase("legend", { position: "QB", legendTier: "immortal" }), REC_IMMORTAL_PRICE);
});
