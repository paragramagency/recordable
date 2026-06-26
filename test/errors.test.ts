import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseConfig, parseVoiceover } from "../src/validate.js";
import { isRecordableError } from "../src/errors.js";
import { runFfmpeg } from "../src/ffmpeg.js";

const here = dirname(fileURLToPath(import.meta.url));

// ─── Config validation (Zod boundary) ────────────────────────────────────────

test("parseConfig: passes a valid partial config through unchanged", () => {
  assert.deepEqual(parseConfig({ fps: 60, headless: true }), {
    fps: 60,
    headless: true,
  });
});

test("parseConfig: rejects a wrong-typed field with a clear CONFIG_INVALID error", () => {
  try {
    parseConfig({ fps: "fast" });
    assert.fail("expected parseConfig to throw");
  } catch (err) {
    assert.ok(isRecordableError(err));
    assert.equal(err.code, "CONFIG_INVALID");
    assert.match(err.message, /fps/);
  }
});

test("parseConfig: rejects an unknown key (typo)", () => {
  assert.throws(
    () => parseConfig({ outputDirr: "x" }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

test("parseVoiceover: rejects an unknown key (typo)", () => {
  assert.throws(
    () => parseVoiceover({ voicId: "abc" }),
    (err) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

// ─── ffmpeg failures surface stderr ──────────────────────────────────────────

test("runFfmpeg: a failing invocation rejects with FFMPEG_FAILED and stderr detail", async () => {
  await assert.rejects(
    runFfmpeg(["-i", "/no/such/input-xyz.mp4", "-f", "null", "-"]),
    (err) =>
      isRecordableError(err) &&
      err.code === "FFMPEG_FAILED" &&
      /No such file|Invalid|Error|not/i.test(err.message),
  );
});

// ─── CLI prints clean errors and exits non-zero ──────────────────────────────

const tsx = resolve(here, "../node_modules/.bin/tsx");
const cli = resolve(here, "../src/cli.ts");
const runCli = (args: string[]) =>
  spawnSync(tsx, [cli, ...args], { encoding: "utf8" });

test("CLI: a missing script file exits non-zero with a clean message (no stack)", () => {
  const r = runCli(["does-not-exist.json"]);
  assert.notEqual(r.status, 0);
  const out = r.stderr + r.stdout;
  assert.match(out, /file not found/i);
  assert.doesNotMatch(out, /\n\s+at /); // no stack frames leaked
});

test("CLI: an unknown flag exits non-zero", () => {
  const r = runCli(["--bogus-flag"]);
  assert.notEqual(r.status, 0);
});
