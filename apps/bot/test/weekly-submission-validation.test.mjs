import test from "node:test";import assert from "node:assert/strict";import{validPlayerName,validateStatValues}from"../dist/flows/weekly-submission-validation.js";
test("player names require first and last names",()=>{assert.equal(validPlayerName("Jayden Daniels"),true);assert.equal(validPlayerName("Prince"),false)});
test("passing completions cannot exceed attempts",()=>{assert.throws(()=>validateStatValues("passing",{completions:21,attempts:20}),/Completions/);assert.deepEqual(validateStatValues("passing",{completions:20,attempts:21,yards:300}),{completions:20,attempts:21,yards:300})});
test("made kicks cannot exceed attempts",()=>{assert.throws(()=>validateStatValues("kicking",{fg_made:4,fg_attempted:3}),/Made kicks/)});
