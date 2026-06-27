import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTarget,
  isPositionValue,
  parseOptionSpec,
} from "../src/targets.js";

// ─── resolveTarget: :text() pseudo ───────────────────────────────────────────

test("resolveTarget: bare :text() compiles to a Puppeteer text selector", () => {
  assert.equal(resolveTarget(":text(Save)"), "::-p-text(Save)");
  assert.equal(resolveTarget(":text(Save changes)"), "::-p-text(Save changes)");
});

test("resolveTarget: :text() composes with a scoping selector", () => {
  assert.equal(resolveTarget("button:text(Save)"), "button::-p-text(Save)");
  assert.equal(resolveTarget("nav a:text(Pricing)"), "nav a::-p-text(Pricing)");
});

test("resolveTarget: :text() composes with nesting and positional CSS", () => {
  assert.equal(
    resolveTarget("table tr:nth-child(3) td:text(Done)"),
    "table tr:nth-child(3) td::-p-text(Done)",
  );
});

test("resolveTarget: :text() inner whitespace kept, surrounding trimmed", () => {
  assert.equal(
    resolveTarget(":text(  Save changes  )"),
    "::-p-text(Save changes)",
  );
});

test("resolveTarget: multiple :text() occurrences each compile", () => {
  assert.equal(
    resolveTarget("li:text(One) ~ li:text(Two)"),
    "li::-p-text(One) ~ li::-p-text(Two)",
  );
});

// ─── resolveTarget: legacy text: prefix ──────────────────────────────────────

test("resolveTarget: legacy text: prefix still maps to a text selector", () => {
  assert.equal(resolveTarget("text:Upload"), "::-p-text(Upload)");
  assert.equal(resolveTarget("text:Save changes"), "::-p-text(Save changes)");
});

// ─── resolveTarget: plain CSS passes through untouched ────────────────────────

test("resolveTarget: plain CSS passes through verbatim", () => {
  for (const sel of [
    "#title",
    "button.primary",
    'input[name="a,b"]',
    "nav > ul li[data-active]",
    "tr:nth-child(2) td:first-child",
    "section:has(> h2)",
    ":scope >>> .inside-shadow",
    "button::-p-text(Already explicit)",
  ]) {
    assert.equal(resolveTarget(sel), sel, sel);
  }
});

// ─── parseOptionSpec: select value pseudos ───────────────────────────────────

test("parseOptionSpec: :option-index() is parsed 1-based", () => {
  assert.deepEqual(parseOptionSpec(":option-index(1)"), { index: 1 });
  assert.deepEqual(parseOptionSpec(":option-index(12)"), { index: 12 });
});

test("parseOptionSpec: :option-label() keeps inner space, trims surrounding", () => {
  assert.deepEqual(parseOptionSpec(":option-label(Pro tier)"), {
    label: "Pro tier",
  });
  assert.deepEqual(parseOptionSpec(":option-label(  Free  )"), {
    label: "Free",
  });
});

test("parseOptionSpec: a literal value returns null", () => {
  for (const v of ["pro", "", "1", ":text(Save)", "option-index(1)"]) {
    assert.equal(parseOptionSpec(v), null, v);
  }
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
