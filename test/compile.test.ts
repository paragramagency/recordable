import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileMarkdown } from "../src/voiceover/compile.js";
import { MockTTSProvider } from "../src/voiceover/mock.js";

// 100ms/char keeps the alignment maths legible in assertions.
const provider = new MockTTSProvider({ msPerChar: 100 });

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "rc-compile-"));
}

test("compileMarkdown: a marker fires on its word, with a tail wait", async () => {
  // narration strips to "Click now." (10 chars → 1000ms); the marker sits at
  // char 6, the start of "now" → fires at 600ms.
  const md = [
    "---",
    "voiceover: { provider: mock, voiceId: v1 }",
    "---",
    'Click `click("text:Go")` now.',
  ].join("\n");

  const assetsDir = freshDir();
  const { config, steps, assets } = await compileMarkdown(md, { provider, assetsDir });

  assert.equal(config.actionDelay, 0); // forced — the 300ms default desyncs timing
  assert.equal(assets.length, 1);
  assert.ok(existsSync(assets[0]), "audio asset written to disk");

  assert.equal(steps[0].action, "audio");
  assert.equal(steps[0].wait, false);
  assert.ok(String(steps[0].path).endsWith(".wav"));

  assert.deepEqual(steps.slice(1), [
    { action: "wait", ms: 600 },
    { action: "click", target: "text:Go" },
    { action: "wait", ms: 400 },
  ]);
});

test("compileMarkdown: a fenced block between paragraphs is a no-audio pause", async () => {
  const md = ['Go `click("text:A")`.', "", "```", "zoom(2)", "wait(300)", "```"].join("\n");

  const assetsDir = freshDir();
  const { steps, assets } = await compileMarkdown(md, { provider, assetsDir });

  assert.equal(assets.length, 1); // only the narration paragraph synthesizes
  const tail = steps.length;
  assert.deepEqual(steps.slice(tail - 2), [
    { action: "zoom", level: 2 },
    { action: "wait", ms: 300 },
  ]);
  // The pause steps are plain — no audio() precedes them.
  assert.ok(!steps.slice(-2).some((s) => s.action === "audio"));
});

test("compileMarkdown: identical narration reuses one cached asset", async () => {
  const md = "Hello `wait(100)` there.\n\nHello `wait(100)` there.";
  const assetsDir = freshDir();
  const { assets } = await compileMarkdown(md, { provider, assetsDir });

  assert.equal(assets.length, 2);
  assert.equal(assets[0], assets[1]); // content-addressed → same file
});

test("compileMarkdown: an action overrunning its word warns, doesn't retime", async () => {
  // "A B" = 3 chars (300ms). The marker sits at char 2 ("B" → 200ms), but the
  // inline wait(1000) from the *previous* marker pushes elapsed past it.
  const md = 'A `wait(1000)` `click("x")`B';
  const warnings: string[] = [];
  const assetsDir = freshDir();
  await compileMarkdown(md, { provider, assetsDir, warn: (m) => warnings.push(m) });

  assert.ok(warnings.some((w) => /overrun/i.test(w)), "overrun warned");
});
