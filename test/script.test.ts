import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { splitScript, resolveVisitUrls } from "../src/script.js";
import type { Action } from "../src/actions.js";

// ─── splitScript ─────────────────────────────────────────────────────────────

test("splitScript: bare array → actions only, no config", () => {
  const actions: Action[] = [{ action: "pause" }, { action: "resume" }];
  assert.deepEqual(splitScript(actions), { actions });
});

test("splitScript: { config, actions } object → both extracted", () => {
  const actions: Action[] = [{ action: "pause" }];
  const config = { cursor: true };
  assert.deepEqual(splitScript({ config, actions }), { config, actions });
});

test("splitScript: object without config → config undefined", () => {
  const actions: Action[] = [{ action: "pause" }];
  assert.deepEqual(splitScript({ actions }), { config: undefined, actions });
});

// ─── resolveVisitUrls ────────────────────────────────────────────────────────

test("resolveVisitUrls: empty baseDir is a no-op", () => {
  const actions: Action[] = [{ action: "visit", url: "./index.html" }];
  resolveVisitUrls(actions, "");
  assert.equal(actions[0].url, "./index.html");
});

test("resolveVisitUrls: relative ./ and ../ become file:// URLs against baseDir", () => {
  const baseDir = "/base/dir";
  const actions: Action[] = [
    { action: "visit", url: "./index.html" },
    { action: "visit", url: "../up.html" },
  ];
  resolveVisitUrls(actions, baseDir);
  assert.equal(
    actions[0].url,
    pathToFileURL(resolve(baseDir, "./index.html")).href,
  );
  assert.equal(
    actions[1].url,
    pathToFileURL(resolve(baseDir, "../up.html")).href,
  );
});

test("resolveVisitUrls: absolute/remote URLs are left untouched", () => {
  const actions: Action[] = [
    { action: "visit", url: "https://example.com" },
    { action: "visit", url: "/abs/path.html" },
    { action: "visit", url: "file:///already.html" },
  ];
  resolveVisitUrls(actions, "/base");
  assert.equal(actions[0].url, "https://example.com");
  assert.equal(actions[1].url, "/abs/path.html");
  assert.equal(actions[2].url, "file:///already.html");
});

test("resolveVisitUrls: only visit actions with string urls are rewritten", () => {
  const actions: Action[] = [
    { action: "click", target: "./not-a-url" },
    { action: "visit" },
  ];
  resolveVisitUrls(actions, "/base");
  assert.equal(actions[0].target, "./not-a-url");
  assert.equal(actions[1].url, undefined);
});
