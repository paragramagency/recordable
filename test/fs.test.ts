import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveFile, getOutputPath, resolveOutputPaths } from "../src/fs.js";

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

// ─── resolveOutputPaths (multi-file naming, ROADMAP §6) ──────────────────────

const noTs = (dir: string) => ({
  outputDir: dir,
  outputName: "demo",
  outputTimestamp: false,
});

test("resolveOutputPaths: a single unlabelled file stays <name>.mp4", () => {
  const dir = join(tmp(), "out");
  assert.deepEqual(resolveOutputPaths(noTs(dir), [{ label: null }]), [
    `${dir}/demo.mp4`,
  ]);
  assert.equal(existsSync(dir), true); // directory created
});

test("resolveOutputPaths: a label always wins, even for one file", () => {
  const dir = tmp();
  assert.deepEqual(resolveOutputPaths(noTs(dir), [{ label: "intro" }]), [
    `${dir}/demo-intro.mp4`,
  ]);
});

test("resolveOutputPaths: unlabelled files fall back to 1-based position", () => {
  const dir = tmp();
  assert.deepEqual(
    resolveOutputPaths(noTs(dir), [
      { label: "intro" },
      { label: null },
      { label: "outro" },
    ]),
    [`${dir}/demo-intro.mp4`, `${dir}/demo-2.mp4`, `${dir}/demo-outro.mp4`],
  );
});

test("resolveOutputPaths: a collision is disambiguated by position", () => {
  const dir = tmp();
  // The label "2" collides with the second file's positional fallback.
  assert.deepEqual(
    resolveOutputPaths(noTs(dir), [{ label: "2" }, { label: null }]),
    [`${dir}/demo-2.mp4`, `${dir}/demo-2-2.mp4`],
  );
});

test("resolveOutputPaths: one run-wide timestamp is shared across files", () => {
  const dir = tmp();
  const paths = resolveOutputPaths(
    { outputDir: dir, outputName: "demo", outputTimestamp: true },
    [{ label: "a" }, { label: "b" }],
  );
  const stamps = paths.map((p) => /-(\d{14})\.mp4$/.exec(p)?.[1]);
  assert.equal(stamps[0], stamps[1]); // same stamp on every file
  assert.match(paths[0], /\/demo-a-\d{14}\.mp4$/);
});
