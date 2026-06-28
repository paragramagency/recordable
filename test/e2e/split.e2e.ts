import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Recordable } from "../../src/index.js";
import { getDuration } from "../../src/ffmpeg.js";
import { tmpDir, probe } from "../helpers.js";

// ─── End-to-end multi-file recording (ROADMAP §6) ────────────────────────────
//
// Drives the whole pipeline with recording-control boundaries — start/split/end —
// and asserts each labelled output file is a real, playable MP4 and that run()
// resolves to a RecordableResult describing them. Needs a browser + ffmpeg, so it
// runs via `npm run test:e2e`, not the fast unit suite.
//
// Headless + --no-sandbox so it runs in CI/containers. No voiceover (no TTS/network).

const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>split e2e</title></head>
<body style="font-family: sans-serif; padding: 40px">
  <h1 id="title">Recordable split e2e</h1>
  <input id="name" placeholder="your name" />
  <button id="go" onclick="document.getElementById('done').hidden = false">Go</button>
  <p id="done" hidden>Done!</p>
</body></html>`;

test(
  "start / split / end produce separate, playable MP4s",
  { timeout: 120_000 },
  async () => {
    const dir = tmpDir();
    const html = join(dir, "page.html");
    writeFileSync(html, FIXTURE_HTML);
    const url = pathToFileURL(html).href;

    const result = await new Recordable({
      headless: true,
      launchArgs: ["--no-sandbox"],
      outputDir: dir,
      outputName: "reel",
      outputTimestamp: false,
      silent: true,
    })
      .start("intro") // open the first file
      .visit(url)
      .waitFor("#name")
      .type("#name", "Ada")
      .split("main") // close "intro", open "main" — camera keeps rolling
      .click("#go")
      .waitFor("#done")
      .wait(300)
      .end() // close "main"
      .click("#go") // trailing off-camera cleanup (no file open)
      .run();

    // The result describes both labelled files, in order.
    assert.equal(result.status, "completed");
    assert.deepEqual(
      result.files.map((f) => f.label),
      ["intro", "main"],
    );
    assert.deepEqual(
      result.files.map((f) => f.index),
      [1, 2],
    );
    assert.equal(result.outputDir, dir);

    // Each file is named by its label, exists, plays, and has real bytes/duration.
    for (const f of result.files) {
      assert.equal(f.path, join(dir, `reel-${f.label}.mp4`));
      assert.equal(existsSync(f.path), true, `expected ${f.path}`);
      assert.ok(f.bytes > 0, `expected non-empty ${f.label}, got ${f.bytes}B`);
      assert.match(
        await probe(f.path),
        /Video:/,
        `${f.label} needs a video stream`,
      );
      const d = await getDuration(f.path);
      assert.ok(d > 0.2, `expected a non-trivial ${f.label}, got ${d}s`);
      assert.ok(f.durationMs > 0, `expected durationMs for ${f.label}`);
    }

    // A plain unlabelled single-file run keeps the bare <name>.mp4 name (no suffix).
    assert.equal(existsSync(join(dir, "reel.mp4")), false);
  },
);
