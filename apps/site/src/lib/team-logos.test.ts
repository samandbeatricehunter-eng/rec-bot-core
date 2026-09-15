import assert from "node:assert/strict";
import test from "node:test";
import { resolveTeamLogoAbbr, teamLogoUrl } from "./team-logos.js";

test("resolves standard Madden abbreviations to a logo file", () => {
  assert.equal(resolveTeamLogoAbbr("SF"), "SF");
  assert.equal(resolveTeamLogoAbbr("atl"), "ATL");
  assert.match(teamLogoUrl("SF") ?? "", /\/assets\/team-logos\/SF\.png/);
});

test("maps Madden/stats aliases onto the filename set", () => {
  assert.equal(resolveTeamLogoAbbr("SFO"), "SF");
  assert.equal(resolveTeamLogoAbbr("WSH"), "WAS");
  assert.equal(resolveTeamLogoAbbr("JAC"), "JAX");
  assert.equal(resolveTeamLogoAbbr("BLT"), "BAL");
});

test("returns null for CFB / unknown / empty abbreviations", () => {
  assert.equal(resolveTeamLogoAbbr(null), null);
  assert.equal(resolveTeamLogoAbbr(""), null);
  assert.equal(resolveTeamLogoAbbr("CLT"), null);
  assert.equal(teamLogoUrl("CLT"), null);
});
