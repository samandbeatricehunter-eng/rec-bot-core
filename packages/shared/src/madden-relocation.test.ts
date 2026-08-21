import assert from "node:assert/strict";
import test from "node:test";
import {
  MADDEN_RELOCATION_BRANDS,
  MADDEN_RELOCATION_CITIES,
  maddenRelocationBrandsForCity,
  maddenRelocationCityById,
} from "./madden-relocation.js";

test("Madden 27 relocation catalog has 34 cities and unique ids", () => {
  assert.equal(MADDEN_RELOCATION_CITIES.length, 34);
  const ids = MADDEN_RELOCATION_CITIES.map((city) => city.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(maddenRelocationCityById("st-louis"));
  assert.ok(maddenRelocationCityById("mexico-city"));
});

test("relocation brands have unique slugs and abbrs; Oilers is Houston-only", () => {
  const slugs = MADDEN_RELOCATION_BRANDS.map((brand) => brand.slug);
  const abbrs = MADDEN_RELOCATION_BRANDS.map((brand) => brand.abbr);
  assert.equal(MADDEN_RELOCATION_BRANDS.length, 32);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(abbrs).size, abbrs.length);
  assert.equal(maddenRelocationBrandsForCity("austin").some((brand) => brand.slug === "oilers"), false);
  assert.equal(maddenRelocationBrandsForCity("houston").some((brand) => brand.slug === "oilers"), true);
});
