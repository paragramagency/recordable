import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../src/logger.js";

// Capture everything written to console.{log,warn,error} while `fn` runs.
function capture(fn: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (m?: unknown) => out.push(String(m));
  console.warn = (m?: unknown) => err.push(String(m));
  console.error = (m?: unknown) => err.push(String(m));
  try {
    fn();
  } finally {
    Object.assign(console, orig);
  }
  return { out, err };
}

// ─── silent gating ───────────────────────────────────────────────────────────

test("createLogger: not silent → progress/success to stdout, warn/error to stderr", () => {
  const log = createLogger(() => false);
  const { out, err } = capture(() => {
    log("Start", "recording…");
    log.success("Done");
    log.warn("careful");
    log.error("boom");
  });
  assert.equal(out.length, 2);
  assert.equal(err.length, 2);
  assert.match(out[0], /\[Recordable]/);
});

test("createLogger: silent suppresses progress/success/warn but never error", () => {
  const log = createLogger(() => true);
  const { out, err } = capture(() => {
    log("Start", "recording…");
    log.success("Done");
    log.warn("careful");
    log.error("boom");
  });
  assert.equal(out.length, 0);
  assert.deepEqual(err.length, 1);
  assert.match(err[0], /boom/);
});

test("createLogger: silence is read live, per call", () => {
  let silent = false;
  const log = createLogger(() => silent);
  const first = capture(() => log("A"));
  silent = true;
  const second = capture(() => log("B"));
  assert.equal(first.out.length, 1);
  assert.equal(second.out.length, 0);
});

// ─── formatting ──────────────────────────────────────────────────────────────

test("createLogger: a value is padded after an 8-wide label", () => {
  const log = createLogger(() => false);
  const { out } = capture(() => log("OK", "ready"));
  assert.equal(out[0], "[Recordable] OK      ready");
});

test("createLogger: no ANSI colour codes on a non-TTY stream", () => {
  // process.stdout.isTTY is falsy under the test runner, so colour is disabled.
  const log = createLogger(() => false);
  const { out } = capture(() => log("Plain"));
  assert.equal(out[0], "[Recordable] Plain");
  assert.equal(out[0].includes("\x1b["), false); // no ANSI escape sequence
});
