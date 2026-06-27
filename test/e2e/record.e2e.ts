import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Recordable } from "../../src/index.js";
import { getDuration } from "../../src/ffmpeg.js";
import { tmpDir, probe } from "../helpers.js";

// ─── End-to-end recording ────────────────────────────────────────────────────
//
// The structural regression anchor: drives the WHOLE pipeline — compose → session
// → puppeteer browser → CDP screencast → ffmpeg stitch — against a local fixture
// page, and asserts a real, playable MP4 comes out. Needs a browser + ffmpeg, so
// it lives outside the fast unit suite (run via `npm run test:e2e`).
//
// Headless + --no-sandbox so it runs in CI/containers. No voiceover (no TTS/network).

const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>e2e</title></head>
<body style="font-family: sans-serif; padding: 40px">
  <h1 id="title">Recordable e2e</h1>
  <input id="name" placeholder="your name" />
  <button id="go" onclick="document.getElementById('done').hidden = false">Go</button>
  <p id="done" hidden>Done!</p>
</body></html>`;

test(
  "records a fixture page to a playable MP4",
  { timeout: 120_000 },
  async () => {
    const dir = tmpDir();
    const html = join(dir, "page.html");
    writeFileSync(html, FIXTURE_HTML);
    const url = pathToFileURL(html).href;

    const script = [
      { action: "visit", url },
      { action: "waitFor", target: "#name" },
      { action: "type", target: "#name", text: "Ada" },
      { action: "click", target: "#go" },
      { action: "waitFor", target: "#done" },
      { action: "zoom", level: 1.5, origin: "#title" },
      { action: "wait", ms: 300 },
      { action: "resetZoom" },
    ];

    await new Recordable({
      headless: true,
      launchArgs: ["--no-sandbox"],
      outputDir: dir,
      outputName: "e2e",
      outputTimestamp: false,
      silent: true,
    })
      .fromJSON(script)
      .run();

    const out = join(dir, "e2e.mp4");
    assert.equal(existsSync(out), true, "expected an output MP4");
    assert.match(
      await probe(out),
      /Video:/,
      "output should have a video stream",
    );
    const d = await getDuration(out);
    assert.ok(d > 0.5, `expected a non-trivial duration, got ${d}s`);
  },
);
