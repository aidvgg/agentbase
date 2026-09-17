import { test } from "node:test";
import assert from "node:assert/strict";
import { turnCapNotice } from "../src/agent.js";

test("no notice below the tool turn cap", () => {
  assert.equal(turnCapNotice(0, 25), null);
  assert.equal(turnCapNotice(24, 25), null);
});

test("notice at the tool turn cap names the limit", () => {
  const notice = turnCapNotice(25, 25);
  assert.ok(notice);
  assert.match(notice, /25 tool turn limit/);
});

test("notice past the tool turn cap", () => {
  assert.ok(turnCapNotice(30, 25));
});
