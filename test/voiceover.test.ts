import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, FileCache } from "../src/voiceover/cache.js";
import { alignmentDurationMs, normalizeAlignment } from "../src/voiceover/alignment.js";
import { MockTTSProvider, silentWav } from "../src/voiceover/mock.js";
import type { TTSResult } from "../src/voiceover/types.js";

// ─── Cache key ───────────────────────────────────────────────────────────────

const base = { provider: "elevenlabs", voiceId: "v1", modelId: "m1", format: "mp3_44100_128" };

test("cacheKey: identical inputs hash identically; text change differs", () => {
  assert.equal(cacheKey({ ...base, text: "hello" }), cacheKey({ ...base, text: "hello" }));
  assert.notEqual(cacheKey({ ...base, text: "hello" }), cacheKey({ ...base, text: "world" }));
});

test("cacheKey: voiceId / modelId / format each affect the key", () => {
  const k = cacheKey({ ...base, text: "x" });
  assert.notEqual(k, cacheKey({ ...base, voiceId: "v2", text: "x" }));
  assert.notEqual(k, cacheKey({ ...base, modelId: "m2", text: "x" }));
  assert.notEqual(k, cacheKey({ ...base, format: "mp3_22050_32", text: "x" }));
});

test("cacheKey: voiceSettings order does not change the key", () => {
  const a = cacheKey({ ...base, text: "x", voiceSettings: { stability: 0.5, similarityBoost: 0.8 } });
  const b = cacheKey({ ...base, text: "x", voiceSettings: { similarityBoost: 0.8, stability: 0.5 } });
  assert.equal(a, b);
});

// ─── File cache round-trip ───────────────────────────────────────────────────

test("FileCache: miss, then put, then byte-identical hit", () => {
  const cache = new FileCache(mkdtempSync(join(tmpdir(), "rc-cache-")));
  const key = cacheKey({ ...base, text: "cached" });
  assert.equal(cache.get(key), null);

  const result: TTSResult = {
    audio: Buffer.from([1, 2, 3, 4]),
    format: "mp3_44100_128",
    durationMs: 4200,
    alignment: { chars: ["h", "i"], startMs: [0, 100], endMs: [100, 200] },
  };
  cache.put(key, result);

  const hit = cache.get(key);
  assert.ok(hit);
  assert.deepEqual(hit.audio, result.audio);
  assert.equal(hit.format, result.format);
  assert.equal(hit.durationMs, 4200);
  assert.deepEqual(hit.alignment, result.alignment);
});

// ─── Alignment normalisation ─────────────────────────────────────────────────

test("normalizeAlignment: seconds → ms, snake_case keys", () => {
  const a = normalizeAlignment({
    characters: ["H", "i"],
    character_start_times_seconds: [0, 0.25],
    character_end_times_seconds: [0.25, 0.5],
  });
  assert.deepEqual(a, { chars: ["H", "i"], startMs: [0, 250], endMs: [250, 500] });
  assert.equal(alignmentDurationMs(a), 500);
});

test("normalizeAlignment: tolerates camelCase keys and empty input", () => {
  const a = normalizeAlignment({
    characters: ["a"],
    characterStartTimesSeconds: [1.234],
    characterEndTimesSeconds: [1.5],
  });
  assert.deepEqual(a, { chars: ["a"], startMs: [1234], endMs: [1500] });
  assert.deepEqual(normalizeAlignment({}), { chars: [], startMs: [], endMs: [] });
  assert.equal(alignmentDurationMs({ chars: [], startMs: [], endMs: [] }), 0);
});

// ─── Mock provider ───────────────────────────────────────────────────────────

test("MockTTSProvider: evenly-spaced alignment matching the text", async () => {
  const r = await new MockTTSProvider({ msPerChar: 50 }).synthesize("Hi!");
  assert.deepEqual(r.alignment, {
    chars: ["H", "i", "!"],
    startMs: [0, 50, 100],
    endMs: [50, 100, 150],
  });
  assert.equal(r.durationMs, 150);
  assert.equal(r.format, "wav");
});

test("silentWav: well-formed RIFF/WAVE header with the right data size", () => {
  const wav = silentWav(1000, 8000); // 8000 samples × 2 bytes = 16000
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), 16000);
  assert.equal(wav.length, 44 + 16000);
  assert.equal(wav.readUInt16LE(22), 1); // mono
  assert.equal(wav.readUInt16LE(34), 16); // 16-bit
});
