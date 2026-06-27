import { test } from "node:test";
import assert from "node:assert/strict";
import { sleep, truncate } from "../src/utils.js";

// ─── truncate ────────────────────────────────────────────────────────────────

test("truncate: returns the text unchanged at or under the limit", () => {
  assert.equal(truncate("short"), "short");
  assert.equal(truncate("x".repeat(40)), "x".repeat(40)); // exactly 40, default max
});

test("truncate: clips to max chars and appends an ellipsis", () => {
  assert.equal(truncate("x".repeat(41)), "x".repeat(40) + "…");
});

test("truncate: honours a custom max", () => {
  assert.equal(truncate("abcdef", 3), "abc…");
  assert.equal(truncate("abc", 3), "abc");
});

// ─── sleep ───────────────────────────────────────────────────────────────────

test("sleep: resolves after roughly the given delay", async () => {
  const start = process.hrtime.bigint();
  await sleep(20);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  // generous lower bound — timers can fire a hair early, but not 5ms early
  assert.ok(elapsedMs >= 15, `slept ${elapsedMs}ms`);
});
