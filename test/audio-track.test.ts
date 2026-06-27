import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { AudioTrack } from "../src/audio/track.js";
import { isRecordableError } from "../src/errors.js";
import { tmpDir, makeTone } from "./helpers.js";

// AudioTrack.add is the I/O part of the audio layer: it checks the file exists
// and probes its real duration (the pure filter-graph maths lives in audio.test.ts).

test("AudioTrack.add: throws FILE_NOT_FOUND for a missing clip", async () => {
  const track = new AudioTrack();
  await assert.rejects(
    () => track.add(join(tmpDir(), "ghost.wav"), 0),
    (err) => isRecordableError(err) && err.code === "FILE_NOT_FOUND",
  );
  assert.equal(track.length, 0);
});

test("AudioTrack.add: probes real duration and records the clip", async () => {
  const dir = tmpDir();
  const a = join(dir, "tone.wav");
  await makeTone(a, 0.5);

  const track = new AudioTrack();
  const { startMs, durationMs } = await track.add(a, 1500, { volume: 0.8 });

  assert.equal(startMs, 1500);
  assert.ok(
    Math.abs(durationMs - 500) < 100,
    `expected ~500ms, got ${durationMs}`,
  );
  assert.equal(track.length, 1);
  assert.deepEqual(track.list()[0], {
    path: a,
    startMs: 1500,
    durationMs,
    volume: 0.8,
  });
});

test("AudioTrack: clips are kept in insertion order", async () => {
  const dir = tmpDir();
  const a = join(dir, "a.wav");
  const b = join(dir, "b.wav");
  await makeTone(a, 0.2);
  await makeTone(b, 0.3);

  const track = new AudioTrack();
  await track.add(a, 0);
  await track.add(b, 1000);

  assert.deepEqual(
    track.list().map((c) => c.path),
    [a, b],
  );
  assert.equal(track.length, 2);
});
