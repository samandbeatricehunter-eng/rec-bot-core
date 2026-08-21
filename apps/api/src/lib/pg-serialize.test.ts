import assert from "node:assert/strict";
import test from "node:test";
import { serializePgValue } from "./pg-serialize.js";

test("native text[] league-config rule columns stay JS arrays", () => {
  const keys = ["failure_to_schedule", "missed_window", "dashing", "rule_violation"];
  assert.equal(
    serializePgValue("rec_league_configuration", "force_win_rules_regular", keys),
    keys,
  );
  assert.equal(
    serializePgValue("rec_league_configuration", "force_win_rules_postseason", keys),
    keys,
  );
  const fairSim = ["scheduling_disagreement", "cant_make_game_no_autopilot"];
  assert.equal(
    serializePgValue("rec_league_configuration", "fair_sim_rules_regular", fairSim),
    fairSim,
  );
  assert.equal(
    serializePgValue("rec_league_configuration", "fair_sim_rules_postseason", fairSim),
    fairSim,
  );
});

test("jsonb array columns are JSON-stringified", () => {
  assert.equal(
    serializePgValue("rec_league_configuration", "core_attributes", ["SPD", "ACC"]),
    JSON.stringify(["SPD", "ACC"]),
  );
  assert.equal(
    serializePgValue("rec_league_configuration", "custom_rules", [{ id: "1", title: "No cheese" }]),
    JSON.stringify([{ id: "1", title: "No cheese" }]),
  );
});

test("jsonb objects are JSON-stringified", () => {
  assert.equal(
    serializePgValue("rec_league_configuration", "slider_settings", { qb_acc: 50 }),
    JSON.stringify({ qb_acc: 50 }),
  );
});

test("other native text[] columns stay JS arrays", () => {
  const ids = ["111", "222"];
  assert.equal(
    serializePgValue("rec_box_score_submissions", "extra_discord_message_ids", ids),
    ids,
  );
  const roles = ["commissioner"];
  assert.equal(serializePgValue("rec_user_league_history", "roles", roles), roles);
});

test("json-stringifying a text[] value is the settings-save 500", () => {
  const keys = ["failure_to_schedule", "missed_window", "dashing", "rule_violation"];
  const broken = JSON.stringify(keys);
  assert.match(broken, /^\["failure_to_schedule"/);
  const encoded = serializePgValue("rec_league_configuration", "force_win_rules_regular", keys);
  assert.ok(Array.isArray(encoded));
  assert.notEqual(encoded, broken);
});

test("nullish values become null and scalars pass through", () => {
  assert.equal(serializePgValue("rec_league_configuration", "league_password", null), null);
  assert.equal(serializePgValue("rec_league_configuration", "league_password", undefined), null);
  assert.equal(serializePgValue("rec_league_configuration", "quarter_length_minutes", 8), 8);
  assert.equal(serializePgValue("rec_league_configuration", "difficulty", "all_madden"), "all_madden");
});
