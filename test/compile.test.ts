import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileMarkdown } from "../src/voiceover/compile.js";
import { MockTTSProvider } from "../src/voiceover/mock.js";
import type { SynthOptions, TTSResult } from "../src/voiceover/types.js";
import { getDuration, runFfmpeg } from "../src/ffmpeg.js";
import { gestureLeadMs, typingDuration } from "../src/timing.js";

// 100ms/char keeps the alignment maths legible in assertions.
const provider = new MockTTSProvider({ msPerChar: 100 });

// Captures every string handed to the TTS provider, so a test can assert what
// did (and didn't) reach synthesis — `synthesize`'s `text` is exactly the
// narration destined for the voice.
class RecordingProvider extends MockTTSProvider {
  readonly synthesized: string[] = [];
  async synthesize(text: string, opts?: SynthOptions): Promise<TTSResult> {
    this.synthesized.push(text);
    return super.synthesize(text, opts);
  }
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "rc-compile-"));
}

test("compileMarkdown: a marker fires on its word, with a tail wait", async () => {
  // narration strips to "Click the button now." (21 chars → 2100ms); the marker
  // sits at char 6, the start of "the" → fires at 600ms. The click also occupies
  // its cursor travel-and-press (gestureLeadMs) before the tail is measured.
  const md = [
    "---",
    "voiceover: { provider: mock, voiceId: v1 }",
    "---",
    'Click `click("text:Go")` the button now.',
  ].join("\n");

  const assetsDir = freshDir();
  const { config, actions, assets } = await compileMarkdown(md, {
    provider,
    assetsDir,
  });

  assert.equal(config.actionDelay, 0); // forced — the 300ms default desyncs timing
  assert.equal(assets.length, 1);
  assert.ok(existsSync(assets[0]), "audio asset written to disk");

  assert.equal(actions[0].action, "audio");
  assert.equal(actions[0].wait, false);
  assert.ok(String(actions[0].path).endsWith(".wav"));

  const lead = gestureLeadMs({ action: "click" }, {});
  assert.deepEqual(actions.slice(1), [
    { action: "wait", ms: 600 },
    { action: "click", target: "text:Go" },
    { action: "wait", ms: 2100 - (600 + lead) },
  ]);
});

test("compileMarkdown: a type's slot covers its cursor lead and keystrokes", async () => {
  // "Now typing here done." (21 chars → 2100ms); the type marker sits at char 4,
  // the start of "typing" → fires at 400ms. Its slot is the cursor lead plus the
  // keystroke time for "ab", so the tail wait is what's left after both.
  const md = 'Now `type("#x", "ab")` typing here done.';
  const { actions } = await compileMarkdown(md, { provider, assetsDir: freshDir() });

  const lead = gestureLeadMs({ action: "type" }, {});
  const keys = typingDuration("ab", 7); // default typingSpeed
  assert.deepEqual(actions.slice(1), [
    { action: "wait", ms: 400 },
    { action: "type", target: "#x", text: "ab" },
    { action: "wait", ms: 2100 - (400 + lead + keys) },
  ]);
});

test("compileMarkdown: a fenced block between paragraphs is a no-audio pause", async () => {
  const md = [
    'Go `click("text:A")`.',
    "",
    "```",
    "zoom(2)",
    "wait(300)",
    "```",
  ].join("\n");

  const assetsDir = freshDir();
  const { actions, assets } = await compileMarkdown(md, { provider, assetsDir });

  assert.equal(assets.length, 1); // only the narration paragraph synthesizes
  const tail = actions.length;
  assert.deepEqual(actions.slice(tail - 2), [
    { action: "zoom", level: 2 },
    { action: "wait", ms: 300 },
  ]);
  // The pause actions are plain — no audio() precedes them.
  assert.ok(!actions.slice(-2).some((s) => s.action === "audio"));
});

test("compileMarkdown: identical narration reuses one cached asset", async () => {
  const md = "Hello `wait(100)` there.\n\nHello `wait(100)` there.";
  const assetsDir = freshDir();
  const { assets } = await compileMarkdown(md, { provider, assetsDir });

  assert.equal(assets.length, 2);
  assert.equal(assets[0], assets[1]); // content-addressed → same file
});

test("compileMarkdown: an overlaid insert eats its length from the next wait", async () => {
  // narration strips to "Click now." (1000ms); "now" starts at char 6 → 600ms.
  // The insert at the start overlays the audio, so the recorded timeline already
  // advanced by the clip's length when the click word arrives — the wait before
  // the click is the *remainder* (600 − clip), not the full 600ms.
  const dir = freshDir();
  const clip = join(dir, "intro.mp4");
  // A ~0.3s black clip (9 frames @ 30fps) — short enough to leave a positive wait.
  await runFfmpeg([
    "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=0.3", "-r", "30",
    "-pix_fmt", "yuv420p", clip,
  ]);
  const clipMs = Math.round((await getDuration(clip)) * 1000);
  assert.ok(clipMs > 0 && clipMs < 600, `clip ${clipMs}ms leaves room`);

  // "Click the button now." (2100ms); click fires on "the" at 600ms.
  const md = `\`insert("${clip}")\` Click \`click("text:Go")\` the button now.`;
  const { actions } = await compileMarkdown(md, { provider, assetsDir: freshDir() });

  const lead = gestureLeadMs({ action: "click" }, {});
  assert.deepEqual(actions.slice(1), [
    { action: "insert", path: clip },
    { action: "wait", ms: 600 - clipMs }, // the insert ate its length from this wait
    { action: "click", target: "text:Go" },
    { action: "wait", ms: 2100 - (600 + lead) },
  ]);
});

test("compileMarkdown: a `//` comment never reaches the TTS provider", async () => {
  // The note sits between two prose lines of one paragraph and on its own line
  // between paragraphs. Neither form should be synthesized, and the surviving
  // narration must be exactly the prose — no comment text, no stray blank clip.
  const rec = new RecordingProvider({ msPerChar: 100 });
  const md = [
    "---",
    "voiceover: { provider: mock, voiceId: v1 }",
    "---",
    "Welcome to the app.",
    "// TODO: re-record this line before launch",
    "It marks instantly.",
    "",
    "// a whole-paragraph note — secret-token-do-not-speak",
    "",
    "Then you export.",
  ].join("\n");

  const { assets } = await compileMarkdown(md, {
    provider: rec,
    assetsDir: freshDir(),
  });

  // Two prose paragraphs synthesize; the lone comment line is not a third.
  assert.deepEqual(rec.synthesized, [
    "Welcome to the app. It marks instantly.",
    "Then you export.",
  ]);
  assert.equal(assets.length, 2);
  // Belt-and-braces: no comment fragment leaked into any synthesized text.
  assert.ok(
    !rec.synthesized.some((t) => /\/\/|TODO|secret-token/.test(t)),
    "no comment text reached the voice",
  );
});

test("compileMarkdown: an action overrunning its word warns, doesn't retime", async () => {
  // "A B" = 3 chars (300ms). The marker sits at char 2 ("B" → 200ms), but the
  // inline wait(1000) from the *previous* marker pushes elapsed past it.
  const md = 'A `wait(1000)` `click("x")`B';
  const warnings: string[] = [];
  const assetsDir = freshDir();
  await compileMarkdown(md, {
    provider,
    assetsDir,
    warn: (m) => warnings.push(m),
  });

  // The warning names the offending action and how far it (and the rest) lag.
  assert.ok(
    warnings.some((w) => /click\("x"\)/.test(w) && /lags?\b/i.test(w)),
    "overrunning action flagged with its identity and the lag",
  );
});
