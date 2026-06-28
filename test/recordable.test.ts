import { test } from "node:test";
import assert from "node:assert/strict";
import { Recordable } from "../src/compose/recordable.js";
import { isRecordableError } from "../src/errors.js";
import type { Script } from "../src/script.js";

// Browser-free coverage of the compose-layer builder: the synchronous
// build/load/validate path. These exercise fromJSON / fromMarkdown (no
// voiceover) only — they enqueue actions without ever calling run(), so no
// browser, ffmpeg, or network is touched.

// Assert a thunk throws a RecordableError with the given code; return it for
// further message assertions.
function assertRecordableError(fn: () => unknown, code: string) {
  let caught: unknown;
  assert.throws(fn, (err: unknown) => {
    caught = err;
    assert.ok(isRecordableError(err), "expected a RecordableError");
    assert.equal(err.code, code);
    return true;
  });
  return caught as { message: string };
}

// ─── fromJSON: happy paths (chainable) ───────────────────────────────────────

test("fromJSON: a bare actions array loads and returns the same instance", () => {
  const r = new Recordable();
  const ret = r.fromJSON([
    { action: "visit", url: "https://example.com" },
    { action: "wait", ms: 100 },
  ]);
  assert.equal(ret, r);
});

test("fromJSON: the { config, actions } object form loads and chains", () => {
  const r = new Recordable();
  const ret = r.fromJSON({
    config: { cursor: true },
    actions: [{ action: "wait", ms: 50 }],
  } as Script);
  assert.equal(ret, r);
});

test("fromJSON: a raw JSON string form loads and chains", () => {
  const r = new Recordable();
  const json = JSON.stringify([
    { action: "visit", url: "https://example.com" },
    { action: "wait", ms: 100 },
  ]);
  assert.equal(r.fromJSON(json), r);
});

// ─── fromJSON: validation / error paths (re-wrapped as RecordableError) ───────

test("fromJSON: a non-array / non-{actions} shape throws CONFIG_INVALID", () => {
  const err = assertRecordableError(
    () => new Recordable().fromJSON({} as unknown as Script),
    "CONFIG_INVALID",
  );
  assert.match(err.message, /Script must be an array/);

  // A scalar takes the same path (.actions reads undefined off the primitive).
  const err2 = assertRecordableError(
    () => new Recordable().fromJSON(42 as unknown as Script),
    "CONFIG_INVALID",
  );
  assert.match(err2.message, /Script must be an array/);
});

test("fromJSON: an unknown action throws CONFIG_INVALID with step context", () => {
  const err = assertRecordableError(
    () => new Recordable().fromJSON([{ action: "frobnicate" }] as Script),
    "CONFIG_INVALID",
  );
  assert.match(err.message, /step 0/);
  assert.match(err.message, /frobnicate/);
});

test("fromJSON: a known action with a bad arg type throws CONFIG_INVALID", () => {
  assertRecordableError(
    () =>
      new Recordable().fromJSON([
        { action: "zoom", level: "big" },
      ] as unknown as Script),
    "CONFIG_INVALID",
  );
});

test("fromJSON: an unknown key on an action (strictObject) throws CONFIG_INVALID", () => {
  assertRecordableError(
    () =>
      new Recordable().fromJSON([
        { action: "wait", ms: 10, oops: 1 },
      ] as unknown as Script),
    "CONFIG_INVALID",
  );
});

// ─── Recording control: start / end / split load via JSON ────────────────────

test("fromJSON: start/end/split actions (with and without a name) load and chain", () => {
  const r = new Recordable();
  const ret = r.fromJSON([
    { action: "start", name: "intro" },
    { action: "visit", url: "https://example.com" },
    { action: "split", name: "checkout" },
    { action: "wait", ms: 50 },
    { action: "end" },
  ] as Script);
  assert.equal(ret, r);
});

test("fromJSON: end with a stray arg is rejected (strictObject)", () => {
  assertRecordableError(
    () =>
      new Recordable().fromJSON([
        { action: "end", name: "nope" },
      ] as unknown as Script),
    "CONFIG_INVALID",
  );
});

// ─── fromMarkdown: synchronous flatten (no voiceover frontmatter) ─────────────

test("fromMarkdown: a no-voiceover doc flattens markers and returns the same instance", () => {
  const md = [
    "```ts",
    'visit("https://example.com")',
    "wait(100)",
    "```",
    "",
  ].join("\n");
  const r = new Recordable();
  assert.equal(r.fromMarkdown(md), r);
});
