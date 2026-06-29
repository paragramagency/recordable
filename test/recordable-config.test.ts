import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recordable } from "../src/compose/recordable.js";
import type { Script } from "../src/script.js";

// ─── Config precedence, end to end ───────────────────────────────────────────
//
// The DEFAULT_* env-config path is gone; the *layering* it once proved now lives
// in `recordable.config.json`: defaults < config-file < document config < explicit
// constructor/CLI config. These build a real Recordable pointed at a temp dir
// holding a `recordable.config.json` and read the resolved config off
// `getConfig()` — exercising the config-file discovery + the merge in
// `_applyContentConfig`. The temp dir sits under the OS tmp (outside cwd), so the
// bounded baseDir→cwd walk scans only it, keeping the test isolated.

let TMP: string;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), "rc-config-"));
  writeFileSync(
    join(TMP, "recordable.config.json"),
    JSON.stringify({ fps: 24, outputName: "fromfile", headless: true }),
  );
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const oneAction: Script = [{ action: "wait", ms: 1 }];

test("recordable.config.json beside baseDir layers config over the built-in defaults", () => {
  const r = new Recordable({ baseDir: TMP }).fromJSON(oneAction);
  assert.equal(r.getConfig().fps, 24); // file, not the default 30
  assert.equal(r.getConfig().outputName, "fromfile");
  assert.equal(r.getConfig().headless, true);
});

test("document config (JSON `config`) overrides the config file, which still fills the rest", () => {
  const r = new Recordable({ baseDir: TMP }).fromJSON({
    config: { fps: 50 },
    actions: oneAction,
  } as Script);
  assert.equal(r.getConfig().fps, 50); // document wins over the config file
  assert.equal(r.getConfig().outputName, "fromfile"); // untouched key still from the file
});

test("explicit constructor config wins over both the config file and document config", () => {
  const r = new Recordable({ baseDir: TMP, fps: 99 }).fromJSON({
    config: { fps: 50 },
    actions: oneAction,
  } as Script);
  assert.equal(r.getConfig().fps, 99);
});

test("getConfig() returns a snapshot — mutating it doesn't change the recording", () => {
  const r = new Recordable({ baseDir: TMP }).fromJSON(oneAction);
  r.getConfig().fps = 1;
  assert.equal(r.getConfig().fps, 24);
});
