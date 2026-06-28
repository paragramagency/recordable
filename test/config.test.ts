import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigSchema, DEFAULT_CONFIG } from "../src/config.js";

// ─── Defaults ────────────────────────────────────────────────────────────────
//
// ConfigSchema is the single source of truth; DEFAULT_CONFIG is its `.parse({})`.
// Pin the resolved defaults so a stray edit to a `.default(...)` is caught.

test("DEFAULT_CONFIG: every documented default is resolved", () => {
  assert.deepEqual(DEFAULT_CONFIG, {
    viewport: { width: 1920, height: 1080 },
    pageZoom: 1,
    fps: 30,
    outputDir: "output",
    outputName: "recordable",
    outputTimestamp: true,
    assetsDir: "assets",
    headless: false,
    language: "",
    launchArgs: [],
    typingSpeed: 7,
    videoCrf: 18,
    videoCodec: "libx264",
    videoPreset: "ultrafast",
    zoomDuration: 600,
    actionDelay: 300,
    silent: false,
    autoScroll: true,
    scrollMargin: 120,
    scrollSpeed: 1500,
    scrollDuration: 1200,
    cursor: true,
    visitTimeout: 30_000,
    trimNavigation: true,
    baseDir: "",
  });
});

test("ConfigSchema.parse({}) equals DEFAULT_CONFIG", () => {
  assert.deepEqual(ConfigSchema.parse({}), DEFAULT_CONFIG);
});

// ─── Layering / strictness ───────────────────────────────────────────────────

test("ConfigSchema: a provided value overrides just that default", () => {
  const cfg = ConfigSchema.parse({ fps: 60, headless: true });
  assert.equal(cfg.fps, 60);
  assert.equal(cfg.headless, true);
  // untouched fields keep their defaults
  assert.equal(cfg.typingSpeed, 7);
  assert.equal(cfg.pageZoom, 1);
  assert.deepEqual(cfg.viewport, { width: 1920, height: 1080 });
});

test("ConfigSchema: pageZoom overrides its default", () => {
  assert.equal(ConfigSchema.parse({ pageZoom: 0.8 }).pageZoom, 0.8);
});

test("ConfigSchema: strictObject rejects an unknown (typo'd) key", () => {
  assert.throws(() => ConfigSchema.parse({ fpsx: 30 }));
});

test("ConfigSchema: rejects a wrong-typed value", () => {
  assert.throws(() => ConfigSchema.parse({ fps: "fast" }));
});

test("ConfigSchema: nested viewport is itself strict", () => {
  assert.throws(() =>
    ConfigSchema.parse({ viewport: { width: 800, height: 600, depth: 1 } }),
  );
});

test("DEFAULT_CONFIG: mutable collections are not shared across parses", () => {
  const a = ConfigSchema.parse({});
  const b = ConfigSchema.parse({});
  assert.notEqual(a.launchArgs, b.launchArgs);
  assert.notEqual(a.viewport, b.viewport);
});
