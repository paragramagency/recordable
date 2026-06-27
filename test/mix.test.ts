import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { addAudio } from "../src/compose/mix.js";
import { getDuration } from "../src/ffmpeg.js";
import {
  tmpDir,
  makeVideo,
  makeTone,
  probe,
  recordingLogger,
} from "./helpers.js";

// addAudio muxes the audio track onto the silent video via real ffmpeg. The pure
// filter-graph/overrun maths is covered in audio.test.ts; here we exercise the
// actual mux: output exists, gains an audio stream, and is clamped to the video.

test("addAudio: muxes a clip onto the video, output has audio, clamped to video length", async () => {
  const dir = tmpDir();
  const v = join(dir, "v.mp4");
  const a = join(dir, "a.wav");
  const out = join(dir, "out.mp4");
  await makeVideo(v, 1);
  await makeTone(a, 0.5);

  await addAudio(
    v,
    [{ path: a, startMs: 0, durationMs: 500 }],
    out,
    recordingLogger(),
  );

  assert.equal(existsSync(out), true);
  assert.match(await probe(out), /Audio:/);
  const d = await getDuration(out);
  assert.ok(Math.abs(d - 1) < 0.15, `expected ~1s (video length), got ${d}`);
});

test("addAudio: warns when a clip runs past the video end", async () => {
  const dir = tmpDir();
  const v = join(dir, "v.mp4");
  const a = join(dir, "a.wav");
  const out = join(dir, "out.mp4");
  await makeVideo(v, 1);
  await makeTone(a, 0.5);

  const log = recordingLogger();
  // durationMs is what overrun detection reads — 2s past a 1s video → warn.
  await addAudio(v, [{ path: a, startMs: 0, durationMs: 2000 }], out, log);

  assert.ok(
    log.lines.some((l) => /runs \d+ms past the video end/.test(l)),
    `expected an overrun warning, got: ${JSON.stringify(log.lines)}`,
  );
});
