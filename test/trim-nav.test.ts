import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { Runtime } from "../src/browser/runtime.js";
import { isTrimNav } from "../src/compose/session.js";
import { ConfigSchema, type ResolvedConfig } from "../src/config.js";
import { recordingLogger } from "./helpers.js";

// ─── Navigation trim (ROADMAP §2) ────────────────────────────────────────────
//
// `trimNavigation` (default true) defers a same-tab navigation's page load so the
// session can seal the segment first and run the load off-camera. The runtime
// signals this by returning a TrimNav directive instead of awaiting the load
// inline — verified here with a fake Page (cursor off, so no overlay work), no
// browser. The seal-then-run ordering and the actual frame trimming are covered
// by the e2e suite.

/** A fake Page that records goto calls; cursor is disabled so nothing else on the
 *  Page is touched by `visit`. */
function fakePage(calls: string[]): Page {
  return {
    goto: async (url: string) => {
      calls.push(`goto:${url}`);
      return null;
    },
  } as unknown as Page;
}

const cfg = (over: Partial<ResolvedConfig> = {}): (() => ResolvedConfig) => {
  const resolved = { ...ConfigSchema.parse({ cursor: false }), ...over };
  return () => resolved;
};

test("visit: trimNavigation on defers the load into an offCamera directive", async () => {
  const calls: string[] = [];
  const runtime = new Runtime(cfg({ trimNavigation: true }), recordingLogger());
  const page = fakePage(calls);

  const result = await runtime.visit(page, "https://example.com");
  assert.ok(isTrimNav(result), "visit returns a TrimNav directive");
  assert.deepEqual(calls, [], "the load has not run yet — it's deferred");

  await (result as { offCamera: () => Promise<void> }).offCamera();
  assert.deepEqual(
    calls,
    ["goto:https://example.com"],
    "offCamera runs the load",
  );
});

test("visit: trimNavigation off navigates inline, returning no directive", async () => {
  const calls: string[] = [];
  const runtime = new Runtime(
    cfg({ trimNavigation: false }),
    recordingLogger(),
  );

  const result = await runtime.visit(fakePage(calls), "https://example.com");
  assert.equal(
    result,
    undefined,
    "no directive — the session does nothing extra",
  );
  assert.deepEqual(calls, ["goto:https://example.com"], "the load ran inline");
});

test("isTrimNav: distinguishes a directive from a Page / void", () => {
  assert.equal(isTrimNav({ offCamera: async () => {} }), true);
  assert.equal(isTrimNav(undefined), false);
  // A Page-like object (no offCamera) is not a directive.
  assert.equal(isTrimNav({ goto: () => {} } as unknown as Page), false);
});
