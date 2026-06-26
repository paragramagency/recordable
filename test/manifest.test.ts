import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, buildArgs } from "../src/actions.js";

// ─── API normalization: optional positionals → trailing options object ───────
//
// After normalization, the JSON layer stays fully keyed (origin/duration are
// top-level step keys) while buildArgs gathers them into the single trailing
// options object the chain methods now take. These assertions pin that mapping.

test("zoom: origin+duration gather into the options object", () => {
  assert.deepEqual(
    buildArgs(
      { action: "zoom", level: 1.5, origin: "#hero", duration: 800 },
      ACTIONS.zoom,
    ),
    [1.5, { origin: "#hero", duration: 800 }],
  );
});

test("zoom: bare level emits just the required positional (method defaults apply)", () => {
  assert.deepEqual(buildArgs({ action: "zoom", level: 2 }, ACTIONS.zoom), [2]);
});

test("zoom: duration without origin still lands in the options object", () => {
  assert.deepEqual(
    buildArgs({ action: "zoom", level: 1.2, duration: 400 }, ACTIONS.zoom),
    [1.2, { duration: 400 }],
  );
});

test("scroll: duration gathers; bare target trims the empty options", () => {
  assert.deepEqual(
    buildArgs(
      { action: "scroll", target: "top", duration: 500 },
      ACTIONS.scroll,
    ),
    ["top", { duration: 500 }],
  );
  assert.deepEqual(
    buildArgs({ action: "scroll", target: "top" }, ACTIONS.scroll),
    ["top"],
  );
});

test("resetZoom: lone optional gather", () => {
  assert.deepEqual(
    buildArgs({ action: "resetZoom", duration: 300 }, ACTIONS.resetZoom),
    [{ duration: 300 }],
  );
  assert.deepEqual(buildArgs({ action: "resetZoom" }, ACTIONS.resetZoom), []);
});

test("type: duration gathers after the two required positionals", () => {
  assert.deepEqual(
    buildArgs(
      { action: "type", target: "#t", text: "hi", duration: 4000 },
      ACTIONS.type,
    ),
    ["#t", "hi", { duration: 4000 }],
  );
  assert.deepEqual(
    buildArgs({ action: "type", target: "#t", text: "hi" }, ACTIONS.type),
    ["#t", "hi"],
  );
});
