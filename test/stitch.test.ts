import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { stitch, type Segment } from "../src/video/stitch.js";
import { getDuration } from "../src/ffmpeg.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { tmpDir, makeVideo, recordingLogger } from "./helpers.js";

const seg = (path: string, fadeIn = 0, fadeOut = 0): Segment => ({
  path,
  fadeIn,
  fadeOut,
});

// stitch picks one of three real ffmpeg paths by segment shape.

test("stitch: a single segment is moved to the output", async () => {
  const dir = tmpDir();
  const s = join(dir, "s.mp4");
  const out = join(dir, "out.mp4");
  await makeVideo(s, 1);

  await stitch([seg(s)], DEFAULT_CONFIG, recordingLogger(), out, dir);

  assert.equal(existsSync(out), true);
  assert.equal(existsSync(s), false, "source should be moved, not copied");
  assert.ok(Math.abs((await getDuration(out)) - 1) < 0.15);
});

test("stitch: plain segments concat to the summed duration", async () => {
  const dir = tmpDir();
  const a = join(dir, "a.mp4");
  const b = join(dir, "b.mp4");
  const out = join(dir, "out.mp4");
  await makeVideo(a, 1);
  await makeVideo(b, 1);

  await stitch([seg(a), seg(b)], DEFAULT_CONFIG, recordingLogger(), out, dir);

  assert.equal(existsSync(out), true);
  assert.ok(
    Math.abs((await getDuration(out)) - 2) < 0.25,
    "two 1s segments → ~2s",
  );
});

test("stitch: cross-faded segments overlap, so the result is shorter than the sum", async () => {
  const dir = tmpDir();
  const a = join(dir, "a.mp4");
  const b = join(dir, "b.mp4");
  const out = join(dir, "out.mp4");
  await makeVideo(a, 1);
  await makeVideo(b, 1);

  // 0.4s cross-fade at the interior boundary → ~1.6s total.
  await stitch(
    [seg(a, 0, 0.4), seg(b, 0.4, 0)],
    DEFAULT_CONFIG,
    recordingLogger(),
    out,
    dir,
  );

  assert.equal(existsSync(out), true);
  const d = await getDuration(out);
  assert.ok(d > 1.4 && d < 1.9, `expected ~1.6s (overlapped), got ${d}`);
});
