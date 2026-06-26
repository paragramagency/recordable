import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMethodCall,
  parseArgList,
  parseMethodCall,
  parseMethodCalls,
} from "../src/markdown/method.js";

// ─── Argument parsing ────────────────────────────────────────────────────────

test("parseArgList: strings, numbers, booleans, null", () => {
  assert.deepEqual(parseArgList(`"a", 1.5, -2, true, false, null`), [
    "a",
    1.5,
    -2,
    true,
    false,
    null,
  ]);
});

test("parseArgList: single and double quotes both parse to plain strings", () => {
  assert.deepEqual(parseArgList(`'single', "double"`), ["single", "double"]);
});

test("parseArgList: objects with bare keys, nested objects and arrays", () => {
  assert.deepEqual(parseArgList(`{ origin: "#hero", duration: 800 }`), [
    { origin: "#hero", duration: 800 },
  ]);
  assert.deepEqual(parseArgList(`{ a: [1, 2], b: { c: "x" } }`), [
    { a: [1, 2], b: { c: "x" } },
  ]);
});

test("parseArgList: commas and parens inside strings are not split", () => {
  assert.deepEqual(parseArgList(`"text:Hi, there", "input[name=\\"a,b\\"]"`), [
    "text:Hi, there",
    'input[name="a,b"]',
  ]);
  assert.deepEqual(parseArgList(`"button:has(span)"`), ["button:has(span)"]);
});

test("parseArgList: empty list and trailing comma", () => {
  assert.deepEqual(parseArgList(``), []);
  assert.deepEqual(parseArgList(`1, 2,`), [1, 2]);
});

test("parseArgList: escapes inside strings", () => {
  assert.deepEqual(parseArgList(`"line1\\nline2\\t!"`), ["line1\nline2\t!"]);
});

// ─── Method-call parsing ─────────────────────────────────────────────────────

test("isMethodCall: only call-shaped strings qualify", () => {
  assert.equal(isMethodCall(`visit("x")`), true);
  assert.equal(isMethodCall(`  zoom(1.5)`), true);
  assert.equal(isMethodCall(`#title`), false);
  assert.equal(isMethodCall(`text:Upload`), false);
});

test("parseMethodCall: one call, trimmed; no-arg call yields empty args", () => {
  assert.deepEqual(parseMethodCall(`select("#r", "a")`), {
    name: "select",
    args: ["#r", "a"],
  });
  assert.deepEqual(parseMethodCall(`  resetZoom()  `), {
    name: "resetZoom",
    args: [],
  });
});

test("parseMethodCall: the trailing ')' delimits args, so inner parens are literal", () => {
  // The whole span is one call; commas/parens inside a string never split it.
  assert.deepEqual(parseMethodCall(`click("a(b),c")`), {
    name: "click",
    args: ["a(b),c"],
  });
});

test("parseMethodCall: two calls in one span is rejected (one call per span/line)", () => {
  assert.throws(
    () => parseMethodCall(`a() b()`),
    /Invalid arguments|must end with/,
  );
  assert.throws(() => parseMethodCall(`#title`), /Not a method call/);
});

test("parseMethodCalls: one call per non-blank line, in order", () => {
  const src = `visit("https://x.test")\n\nzoom(1.5, { origin: "#h" })\nwait(2000)`;
  assert.deepEqual(parseMethodCalls(src), [
    { name: "visit", args: ["https://x.test"] },
    { name: "zoom", args: [1.5, { origin: "#h" }] },
    { name: "wait", args: [2000] },
  ]);
});
