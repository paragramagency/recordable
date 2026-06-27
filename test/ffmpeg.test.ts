import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { getDuration, runFfmpeg } from "../src/ffmpeg.js";
import { isRecordableError } from "../src/errors.js";
import { tmpDir, makeVideo } from "./helpers.js";

// ─── getDuration ─────────────────────────────────────────────────────────────

test("getDuration: parses a real clip's duration (seconds)", async () => {
  const dir = tmpDir();
  const v = join(dir, "v.mp4");
  await makeVideo(v, 1);
  const d = await getDuration(v);
  assert.ok(Math.abs(d - 1) < 0.1, `expected ~1s, got ${d}`);
});

test("getDuration: unreadable / missing file resolves to 0", async () => {
  assert.equal(await getDuration(join(tmpDir(), "nope.mp4")), 0);
});

// ─── runFfmpeg ───────────────────────────────────────────────────────────────

test("runFfmpeg: resolves on a successful invocation", async () => {
  const dir = tmpDir();
  const v = join(dir, "v.mp4");
  const out = join(dir, "copy.mp4");
  await makeVideo(v, 1);
  await runFfmpeg(["-y", "-i", v, "-c", "copy", out]);
  assert.equal(existsSync(out), true);
});

test("runFfmpeg: rejects with a RecordableError FFMPEG_FAILED on non-zero exit", async () => {
  await assert.rejects(
    () =>
      runFfmpeg(["-y", "-i", "/no/such/input.mp4", join(tmpDir(), "x.mp4")]),
    (err) => isRecordableError(err) && err.code === "FFMPEG_FAILED",
  );
});
