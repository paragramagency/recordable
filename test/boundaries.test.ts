import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBoundaries } from "../src/compose/boundaries.js";
import { isRecordableError } from "../src/errors.js";

// The recording-control state machine (ROADMAP §6), validated statically before a
// browser ever launches. Pure: it reads only the ordered control-action kinds.

function assertInvalid(kinds: Parameters<typeof validateBoundaries>[0]) {
  assert.throws(
    () => validateBoundaries(kinds),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
}

// ─── Legal sequences ─────────────────────────────────────────────────────────

test("no boundaries: implicit start at top, implicit end at bottom", () => {
  assert.doesNotThrow(() => validateBoundaries([]));
  // pause/resume/insert/audio are all fine inside the implicit file.
  assert.doesNotThrow(() =>
    validateBoundaries(["pause", "resume", "insert", "audio"]),
  );
});

test("explicit start with no end: implicit end at the bottom is legal", () => {
  assert.doesNotThrow(() => validateBoundaries(["start"]));
  assert.doesNotThrow(() => validateBoundaries(["start", "insert", "audio"]));
});

test("start … end, and a second start … (implicit end) is legal", () => {
  assert.doesNotThrow(() =>
    validateBoundaries(["start", "end", "start", "end"]),
  );
  assert.doesNotThrow(() => validateBoundaries(["start", "end", "start"]));
});

test("split mid-file is legal; end/split allowed while paused", () => {
  assert.doesNotThrow(() => validateBoundaries(["split"])); // implicit file open
  assert.doesNotThrow(() => validateBoundaries(["pause", "split", "resume"]));
  assert.doesNotThrow(() => validateBoundaries(["start", "pause", "end"]));
});

test("redundant pause/resume are no-ops, not errors", () => {
  assert.doesNotThrow(() =>
    validateBoundaries(["pause", "pause", "resume", "resume"]),
  );
});

// ─── Illegal sequences ───────────────────────────────────────────────────────

test("start while already recording is an error", () => {
  assertInvalid(["start", "start"]); // second start with the first still open
  assertInvalid(["start", "split", "start"]); // split kept the file open
});

test("end / split / pause / resume with no open file is an error", () => {
  // An explicit start exists, so the file opens closed: anything before it errors.
  assertInvalid(["end", "start"]);
  assertInvalid(["split", "start"]);
  assertInvalid(["pause", "start"]);
  assertInvalid(["resume", "start"]);
  // After an end with no following start, the file is closed again.
  assertInvalid(["start", "end", "end"]);
  assertInvalid(["start", "end", "pause"]);
});

test("insert / audio in an off-camera gap is an error", () => {
  assertInvalid(["start", "end", "insert"]);
  assertInvalid(["start", "end", "audio"]);
});
