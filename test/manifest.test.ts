import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArgs, validateAction } from "../src/actions.js";
import { isRecordableError } from "../src/errors.js";

// ─── API normalization: optional positionals → trailing options object ───────
//
// After normalization, the JSON layer stays fully keyed (origin/duration are
// top-level step keys) while buildArgs gathers them into the single trailing
// options object the chain methods now take. These assertions pin that mapping.

test("zoom: origin+duration gather into the options object", () => {
  assert.deepEqual(
    buildArgs(
      { action: "zoom", level: 1.5, origin: "#hero", duration: 800 },
      "zoom",
    ),
    [1.5, { origin: "#hero", duration: 800 }],
  );
});

test("zoom: bare level emits just the required positional (method defaults apply)", () => {
  assert.deepEqual(buildArgs({ action: "zoom", level: 2 }, "zoom"), [2]);
});

test("zoom: duration without origin still lands in the options object", () => {
  assert.deepEqual(
    buildArgs({ action: "zoom", level: 1.2, duration: 400 }, "zoom"),
    [1.2, { duration: 400 }],
  );
});

test("scroll: duration gathers; bare target trims the empty options", () => {
  assert.deepEqual(
    buildArgs({ action: "scroll", target: "top", duration: 500 }, "scroll"),
    ["top", { duration: 500 }],
  );
  assert.deepEqual(buildArgs({ action: "scroll", target: "top" }, "scroll"), [
    "top",
  ]);
});

test("scroll: container gathers into the options object", () => {
  assert.deepEqual(
    buildArgs(
      { action: "scroll", target: "bottom", container: ".pane" },
      "scroll",
    ),
    ["bottom", { container: ".pane" }],
  );
});

test("scroll: axis gathers into the options object alongside container", () => {
  assert.deepEqual(
    buildArgs(
      { action: "scroll", target: 300, container: ".row", axis: "x" },
      "scroll",
    ),
    [300, { container: ".row", axis: "x" }],
  );
  assert.deepEqual(buildArgs({ action: "scroll", target: "right" }, "scroll"), [
    "right",
  ]);
});

test("scroll: axis only accepts x or y", () => {
  assert.doesNotThrow(() =>
    validateAction({ action: "scroll", target: 0, axis: "x" }),
  );
  assert.throws(
    () => validateAction({ action: "scroll", target: 0, axis: "z" }),
    /axis/,
  );
});

test("resetZoom: lone optional gather", () => {
  assert.deepEqual(
    buildArgs({ action: "resetZoom", duration: 300 }, "resetZoom"),
    [{ duration: 300 }],
  );
  assert.deepEqual(buildArgs({ action: "resetZoom" }, "resetZoom"), []);
});

test("type: duration gathers after the two required positionals", () => {
  assert.deepEqual(
    buildArgs(
      { action: "type", target: "#t", text: "hi", duration: 4000 },
      "type",
    ),
    ["#t", "hi", { duration: 4000 }],
  );
  assert.deepEqual(
    buildArgs({ action: "type", target: "#t", text: "hi" }, "type"),
    ["#t", "hi"],
  );
});

test("click: followNewTab + waitForNav gather into the options object", () => {
  assert.deepEqual(
    buildArgs(
      { action: "click", target: "text:Open", followNewTab: true },
      "click",
    ),
    ["text:Open", { followNewTab: true }],
  );
  // Bare target trims the empty options bag so the method default applies.
  assert.deepEqual(
    buildArgs({ action: "click", target: "text:Open" }, "click"),
    ["text:Open"],
  );
});

test("click: trimNavigation gathers into the options object", () => {
  assert.deepEqual(
    buildArgs(
      {
        action: "click",
        target: "text:Next",
        waitForNav: true,
        trimNavigation: false,
      },
      "click",
    ),
    ["text:Next", { waitForNav: true, trimNavigation: false }],
  );
});

test("validateAction: click accepts trimNavigation, rejects a non-boolean", () => {
  assert.doesNotThrow(() =>
    validateAction({ action: "click", target: "#go", trimNavigation: false }),
  );
  assert.throws(
    () =>
      validateAction({ action: "click", target: "#go", trimNavigation: "no" }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

// ─── Recording control: start / end / split (ROADMAP §6) ─────────────────────

test("start/split: optional name is positional; bare call trims it", () => {
  assert.deepEqual(buildArgs({ action: "start", name: "intro" }, "start"), [
    "intro",
  ]);
  assert.deepEqual(buildArgs({ action: "start" }, "start"), []);
  assert.deepEqual(buildArgs({ action: "split", name: "checkout" }, "split"), [
    "checkout",
  ]);
  assert.deepEqual(buildArgs({ action: "split" }, "split"), []);
});

test("end: takes no arguments", () => {
  assert.deepEqual(buildArgs({ action: "end" }, "end"), []);
});

test("validateAction: start/end/split accept their schema, reject bad shapes", () => {
  assert.doesNotThrow(() => validateAction({ action: "start", name: "intro" }));
  assert.doesNotThrow(() => validateAction({ action: "end" }));
  assert.doesNotThrow(() => validateAction({ action: "split" }));
  assert.throws(
    () => validateAction({ action: "start", name: 5 }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
  assert.throws(
    () => validateAction({ action: "end", name: "x" }), // end takes no args
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

// ─── Value-level validation (the gap the Zod manifest closes) ─────────────────

test("validateAction: click accepts followNewTab, rejects a non-boolean", () => {
  assert.doesNotThrow(() =>
    validateAction({ action: "click", target: "#go", followNewTab: true }),
  );
  assert.throws(
    () =>
      validateAction({ action: "click", target: "#go", followNewTab: "yes" }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

test("validateAction: scroll accepts container, rejects a non-string", () => {
  assert.doesNotThrow(() =>
    validateAction({ action: "scroll", target: "bottom", container: ".pane" }),
  );
  assert.throws(
    () => validateAction({ action: "scroll", target: "bottom", container: 5 }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

test("validateAction: accepts a well-typed action", () => {
  assert.doesNotThrow(() =>
    validateAction({ action: "zoom", level: 1.5, origin: "#hero" }),
  );
});

test("validateAction: rejects a wrong-typed value with CONFIG_INVALID", () => {
  // Previously only key *names* were checked, so `level: "big"` slipped through.
  assert.throws(
    () => validateAction({ action: "zoom", level: "big" }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

test("validateAction: rejects an unknown action", () => {
  assert.throws(
    () => validateAction({ action: "teleport" }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

test("validateAction: rejects an unknown key (typo)", () => {
  assert.throws(
    () => validateAction({ action: "zoom", level: 1.5, orgin: "#h" }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});
