import { test } from "node:test";
import assert from "node:assert/strict";
import { audioFilterGraph, audioOverruns } from "../src/audio/track.js";
import { timelineMs } from "../src/video/recorder.js";
import { callToAction } from "../src/actions.js";

// ─── Timeline clock ──────────────────────────────────────────────────────────

test("timelineMs: in-flight segment adds frames/fps; paused adds nothing", () => {
  // 2000ms completed + 30 frames @ 30fps = +1000ms while capturing.
  assert.equal(timelineMs(2000, 30, 30, true), 3000);
  // Not capturing → only completed time counts (frames ignored).
  assert.equal(timelineMs(2000, 30, 30, false), 2000);
  // Guard against fps 0.
  assert.equal(timelineMs(500, 10, 0, true), 500);
});

// ─── Filter graph ────────────────────────────────────────────────────────────

test("audioFilterGraph: single clip delays, no amix, maps a0", () => {
  const { filters, mapLabel } = audioFilterGraph([
    { path: "v.mp3", startMs: 1500.4, durationMs: 4000 },
  ]);
  assert.deepEqual(filters, ["[1:a]adelay=1500:all=1[a0]"]);
  assert.equal(mapLabel, "a0");
});

test("audioFilterGraph: volume only emitted when not 1", () => {
  const withVol = audioFilterGraph([
    { path: "a", startMs: 0, durationMs: 1, volume: 0.5 },
  ]);
  assert.equal(withVol.filters[0], "[1:a]adelay=0:all=1,volume=0.5[a0]");
  const unity = audioFilterGraph([
    { path: "a", startMs: 0, durationMs: 1, volume: 1 },
  ]);
  assert.equal(unity.filters[0], "[1:a]adelay=0:all=1[a0]");
});

test("audioFilterGraph: multiple clips amix with correct input indices", () => {
  const { filters, mapLabel } = audioFilterGraph([
    { path: "a", startMs: 0, durationMs: 1 },
    { path: "b", startMs: 2000, durationMs: 1 },
  ]);
  assert.deepEqual(filters, [
    "[1:a]adelay=0:all=1[a0]",
    "[2:a]adelay=2000:all=1[a1]",
    "[a0][a1]amix=inputs=2:normalize=0[aout]",
  ]);
  assert.equal(mapLabel, "aout");
});

// ─── Overrun detection ───────────────────────────────────────────────────────

test("audioOverruns: flags clips past the video end beyond tolerance", () => {
  const clips = [
    { path: "fits.mp3", startMs: 0, durationMs: 5000 },
    { path: "over.mp3", startMs: 4000, durationMs: 3000 }, // ends at 7000
  ];
  assert.deepEqual(audioOverruns(clips, 6000), [
    { path: "over.mp3", overMs: 1000 },
  ]);
  // Within 50ms slack → not flagged.
  assert.deepEqual(
    audioOverruns([{ path: "x", startMs: 0, durationMs: 6030 }], 6000),
    [],
  );
});

// ─── Manifest mapping ────────────────────────────────────────────────────────

test("callToAction: audio path + gathered options", () => {
  assert.deepEqual(callToAction("audio", ["vo.mp3"]), {
    action: "audio",
    path: "vo.mp3",
  });
  assert.deepEqual(
    callToAction("audio", ["vo.mp3", { wait: false, volume: 0.8 }]),
    {
      action: "audio",
      path: "vo.mp3",
      wait: false,
      volume: 0.8,
    },
  );
});
