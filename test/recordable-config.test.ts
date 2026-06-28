import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recordable } from "../src/compose/recordable.js";
import type { Script } from "../src/script.js";

// ─── Config precedence, end to end ───────────────────────────────────────────
//
// The value of DEFAULT_* env config is the *layering*: defaults < .env <
// document config < explicit constructor/CLI config. These build a real
// Recordable with a sibling `.env` and read the resolved config off
// `getConfig()` — covering `_loadEnvFile` + the merge in `_applyContentConfig`,
// the one part configFromEnv's own unit tests can't reach. The `.env` is written
// to a temp dir at runtime (a committed `.env` fixture would be gitignored).

let ENV_DIR: string;

before(() => {
  ENV_DIR = mkdtempSync(join(tmpdir(), "rc-config-"));
  writeFileSync(
    join(ENV_DIR, ".env"),
    "DEFAULT_FPS=24\nDEFAULT_OUTPUT_NAME=fromenv\nDEFAULT_HEADLESS=true\n",
  );
});

// The .env loads into this process's env; clear the keys (and the temp dir) so
// they can't leak into other assertions.
after(() => {
  delete process.env.DEFAULT_FPS;
  delete process.env.DEFAULT_OUTPUT_NAME;
  delete process.env.DEFAULT_HEADLESS;
  rmSync(ENV_DIR, { recursive: true, force: true });
});

const oneAction: Script = [{ action: "wait", ms: 1 }];

test(".env beside baseDir defaults config over the built-in defaults", () => {
  const r = new Recordable({ baseDir: ENV_DIR }).fromJSON(oneAction);
  assert.equal(r.getConfig().fps, 24); // .env, not the default 30
  assert.equal(r.getConfig().outputName, "fromenv");
  assert.equal(r.getConfig().headless, true);
});

test("document config (JSON `config`) overrides .env, which still fills the rest", () => {
  const r = new Recordable({ baseDir: ENV_DIR }).fromJSON({
    config: { fps: 50 },
    actions: oneAction,
  } as Script);
  assert.equal(r.getConfig().fps, 50); // document wins over .env
  assert.equal(r.getConfig().outputName, "fromenv"); // untouched key still from .env
});

test("explicit constructor config wins over both .env and document config", () => {
  const r = new Recordable({ baseDir: ENV_DIR, fps: 99 }).fromJSON({
    config: { fps: 50 },
    actions: oneAction,
  } as Script);
  assert.equal(r.getConfig().fps, 99);
});

test("getConfig() returns a snapshot — mutating it doesn't change the recording", () => {
  const r = new Recordable({ baseDir: ENV_DIR }).fromJSON(oneAction);
  r.getConfig().fps = 1;
  assert.equal(r.getConfig().fps, 24);
});
