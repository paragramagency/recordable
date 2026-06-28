import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv, envVarName } from "../src/env.js";

// ─── DEFAULT_* config defaults ───────────────────────────────────────────────
//
// Every ConfigSchema key maps to a DEFAULT_<UPPER_SNAKE> env var, coerced to the
// field's type. configFromEnv reads a passed-in env object so these stay pure.

test("envVarName: camelCase → DEFAULT_UPPER_SNAKE", () => {
  assert.equal(envVarName("fps"), "DEFAULT_FPS");
  assert.equal(envVarName("outputDir"), "DEFAULT_OUTPUT_DIR");
  assert.equal(envVarName("videoCrf"), "DEFAULT_VIDEO_CRF");
  assert.equal(envVarName("launchArgs"), "DEFAULT_LAUNCH_ARGS");
});

test("configFromEnv: coerces each field to its type", () => {
  assert.deepEqual(
    configFromEnv({
      DEFAULT_FPS: "60",
      DEFAULT_HEADLESS: "true",
      DEFAULT_OUTPUT_DIR: "./out",
      DEFAULT_VIEWPORT: "1920x1080",
      DEFAULT_LAUNCH_ARGS: "--no-sandbox, --foo",
    }),
    {
      fps: 60,
      headless: true,
      outputDir: "./out",
      viewport: { width: 1920, height: 1080 },
      launchArgs: ["--no-sandbox", "--foo"],
    },
  );
});

test("configFromEnv: unset and empty vars are skipped", () => {
  assert.deepEqual(configFromEnv({}), {});
  assert.deepEqual(
    configFromEnv({ DEFAULT_FPS: "", DEFAULT_OUTPUT_DIR: "" }),
    {},
  );
});

test("configFromEnv: baseDir is never sourced from the environment", () => {
  assert.deepEqual(configFromEnv({ DEFAULT_BASE_DIR: "/somewhere" }), {});
});

test("configFromEnv: booleans accept 1/true/yes/on, else false", () => {
  assert.equal(configFromEnv({ DEFAULT_HEADLESS: "1" }).headless, true);
  assert.equal(configFromEnv({ DEFAULT_HEADLESS: "yes" }).headless, true);
  assert.equal(configFromEnv({ DEFAULT_HEADLESS: "off" }).headless, false);
  assert.equal(configFromEnv({ DEFAULT_HEADLESS: "nope" }).headless, false);
});

test("configFromEnv: a non-numeric number throws", () => {
  assert.throws(() => configFromEnv({ DEFAULT_FPS: "fast" }), /DEFAULT_FPS/);
});

test("configFromEnv: a malformed viewport throws", () => {
  assert.throws(
    () => configFromEnv({ DEFAULT_VIEWPORT: "huge" }),
    /WIDTHxHEIGHT/,
  );
});
