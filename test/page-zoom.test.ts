import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createZoomExtension } from "../src/browser/page-zoom.js";

// ─── pageZoom extension generation (no browser) ──────────────────────────────
//
// createZoomExtension writes a throwaway MV3 extension that bakes the zoom factor
// in and re-applies chrome.tabs.setZoom. These cover the file/IO contract — a
// valid manifest, the factor actually baked into bg.js, correct launch args, and
// cleanup — so the live behaviour (page-zoom.e2e.ts, headful) is the only thing
// left needing a real browser.

// The two launch args both point at the same generated extension directory.
function extDir(args: string[]) {
  const load = args.find((a) => a.startsWith("--load-extension="));
  const except = args.find((a) => a.startsWith("--disable-extensions-except="));
  assert.ok(load, "should pass --load-extension");
  assert.ok(except, "should pass --disable-extensions-except");
  const dir = load!.slice("--load-extension=".length);
  assert.equal(
    except!.slice("--disable-extensions-except=".length),
    dir,
    "both args must reference the same directory",
  );
  return dir;
}

test("createZoomExtension: writes a valid MV3 manifest", () => {
  const ext = createZoomExtension(0.7);
  try {
    const dir = extDir(ext.args);
    const manifest = JSON.parse(
      readFileSync(join(dir, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ["tabs"]);
    assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
    assert.equal(manifest.background.service_worker, "bg.js");
  } finally {
    ext.cleanup();
  }
});

test("createZoomExtension: bakes the zoom factor into the service worker", () => {
  const ext = createZoomExtension(0.65);
  try {
    const bg = readFileSync(join(extDir(ext.args), "bg.js"), "utf8");
    assert.match(bg, /ZOOM\s*=\s*0\.65\b/, "factor should be baked in");
    assert.match(bg, /chrome\.tabs\.setZoom/, "should call setZoom");
    // Re-applies across create + navigations + existing tabs.
    assert.match(bg, /onCreated/);
    assert.match(bg, /onUpdated/);
    assert.match(bg, /onInstalled/);
  } finally {
    ext.cleanup();
  }
});

test("createZoomExtension: distinct factors bake distinct values", () => {
  const a = createZoomExtension(0.5);
  const b = createZoomExtension(2);
  try {
    const ba = readFileSync(join(extDir(a.args), "bg.js"), "utf8");
    const bb = readFileSync(join(extDir(b.args), "bg.js"), "utf8");
    assert.match(ba, /ZOOM\s*=\s*0\.5\b/);
    assert.match(bb, /ZOOM\s*=\s*2\b/);
    assert.notEqual(extDir(a.args), extDir(b.args), "each gets its own dir");
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test("createZoomExtension: cleanup removes the generated directory", () => {
  const ext = createZoomExtension(0.8);
  const dir = extDir(ext.args);
  assert.ok(existsSync(dir), "directory exists before cleanup");
  ext.cleanup();
  assert.ok(!existsSync(dir), "directory is gone after cleanup");
  // Idempotent — a second cleanup (e.g. after an early failure) must not throw.
  assert.doesNotThrow(() => ext.cleanup());
});
