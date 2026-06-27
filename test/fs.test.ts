import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveFile, getOutputPath } from "../src/fs.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "recordable-fs-"));
}

// ─── moveFile ────────────────────────────────────────────────────────────────

test("moveFile: relocates a file and removes the source", () => {
  const dir = tmp();
  const src = join(dir, "src.txt");
  const dest = join(dir, "dest.txt");
  writeFileSync(src, "payload");

  moveFile(src, dest);

  assert.equal(existsSync(src), false);
  assert.equal(readFileSync(dest, "utf8"), "payload");
});

// ─── getOutputPath ───────────────────────────────────────────────────────────

test("getOutputPath: no timestamp → plain <dir>/<name>.mp4, dir created", () => {
  const dir = join(tmp(), "out"); // nested, not yet created
  const out = getOutputPath({
    outputDir: dir,
    outputName: "demo",
    outputTimestamp: false,
  });
  assert.equal(out, `${dir}/demo.mp4`);
  assert.equal(existsSync(dir), true);
});

test("getOutputPath: timestamp prepends a 14-digit stamp before .mp4", () => {
  const dir = tmp();
  const out = getOutputPath({
    outputDir: dir,
    outputName: "demo",
    outputTimestamp: true,
  });
  assert.match(out, new RegExp(`/demo-\\d{14}\\.mp4$`));
});
