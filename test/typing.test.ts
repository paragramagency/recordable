import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashString,
  rng,
  typingDuration,
  typingGaps,
} from "../src/timing.js";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ─── typingDuration: the deterministic budget ────────────────────────────────

test("typingDuration: pure function of length and speed", () => {
  assert.equal(typingDuration("hello", 5), 1000); // 5 chars / 5 cps = 1s
  assert.equal(typingDuration("", 7), 0);
  assert.equal(
    typingDuration("abcdefg", 7),
    Math.round((7 / 7) * 1000),
  );
});

test("typingDuration: guards non-positive speed (no Infinity)", () => {
  assert.equal(typingDuration("abc", 0), 3000);
  assert.ok(Number.isFinite(typingDuration("abc", 0)));
});

// ─── typingGaps: jitter is zero-sum (the core invariant) ─────────────────────

test("typingGaps: delays always sum to the total budget", () => {
  for (const text of ["hi", "Hello, world.", "The quick brown fox.", "x"]) {
    const total = typingDuration(text, 7);
    const gaps = typingGaps(text, 7, total);
    assert.ok(
      Math.abs(sum(gaps) - total) < 1e-6,
      `sum ${sum(gaps)} != total ${total} for "${text}"`,
    );
  }
});

test("typingGaps: respects an explicit total override", () => {
  const gaps = typingGaps("anything here", 7, 5000);
  assert.ok(Math.abs(sum(gaps) - 5000) < 1e-6);
});

test("typingGaps: one lead beat + one delay per code point", () => {
  // 'é' as a combining sequence and an emoji exercise code-point counting.
  const text = "a b😀";
  assert.equal(typingGaps(text, 7).length, [...text].length + 1);
});

test("typingGaps: empty text yields no delays", () => {
  assert.deepEqual(typingGaps("", 7), []);
});

test("typingGaps: all delays are strictly positive", () => {
  const gaps = typingGaps("Punctuation, and. spaces here", 7);
  for (const g of gaps) assert.ok(g > 0, `non-positive gap ${g}`);
});

test("typingGaps: punctuation carries a heavier delay than a letter", () => {
  // amount 0 → pure structural weighting (no random perturbation).
  // gaps[0] = lead; the delay after char[k] is gaps[k+1].
  const g = typingGaps("a,aaaaaa", 7, 8000, 0);
  const commaDelay = g[2]; // after char[1] = ','
  const letterDelay = g[1]; // after char[0] = 'a'
  assert.ok(commaDelay > letterDelay, "comma delay should exceed a letter delay");
});

// ─── Reproducibility: same text → same rhythm ────────────────────────────────

test("typingGaps: deterministic for identical text + speed + total", () => {
  const a = typingGaps("Reproducible rhythm.", 7);
  const b = typingGaps("Reproducible rhythm.", 7);
  assert.deepEqual(a, b);
});

test("typingGaps: different text yields a different rhythm", () => {
  const a = typingGaps("alpha beta gamma", 7, 4000);
  const b = typingGaps("gamma beta alpha", 7, 4000);
  assert.notDeepEqual(a, b);
});

// ─── PRNG primitives ─────────────────────────────────────────────────────────

test("hashString: stable and distinct", () => {
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
});

test("rng: same seed reproduces the sequence, in [0,1)", () => {
  const a = rng(123);
  const b = rng(123);
  for (let i = 0; i < 50; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});
