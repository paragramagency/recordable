import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget, isPositionValue } from "../src/targets.js";

// ─── resolveTarget ───────────────────────────────────────────────────────────

test("resolveTarget: text: prefix maps to a Puppeteer text selector", () => {
  assert.equal(resolveTarget("text:Upload"), "::-p-text(Upload)");
  // everything after the prefix is kept verbatim (spaces, punctuation)
  assert.equal(resolveTarget("text:Save changes"), "::-p-text(Save changes)");
});

test("resolveTarget: anything else passes through as a CSS selector", () => {
  assert.equal(resolveTarget("#title"), "#title");
  assert.equal(resolveTarget("button.primary"), "button.primary");
  assert.equal(resolveTarget('input[name="a,b"]'), 'input[name="a,b"]');
});

// ─── isPositionValue ─────────────────────────────────────────────────────────

test("isPositionValue: single keywords", () => {
  for (const v of ["top", "bottom", "left", "right", "center"]) {
    assert.equal(isPositionValue(v), true, v);
  }
});

test("isPositionValue: percentages and one/two-token combos", () => {
  assert.equal(isPositionValue("50%"), true);
  assert.equal(isPositionValue("top left"), true);
  assert.equal(isPositionValue("100% 0%"), true);
  assert.equal(isPositionValue("center 25%"), true);
});

test("isPositionValue: case-insensitive and trims surrounding space", () => {
  assert.equal(isPositionValue("TOP"), true);
  assert.equal(isPositionValue("  center  "), true);
});

test("isPositionValue: rejects selectors and three+ tokens", () => {
  assert.equal(isPositionValue("#hero"), false);
  assert.equal(isPositionValue("top left right"), false);
  assert.equal(isPositionValue(".foo"), false);
  assert.equal(isPositionValue("middle"), false);
  assert.equal(isPositionValue(""), false);
});
