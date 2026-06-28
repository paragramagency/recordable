import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Recordable } from "../../src/index.js";
import { getDuration } from "../../src/ffmpeg.js";
import { tmpDir } from "../helpers.js";

// ─── End-to-end navigation trim (ROADMAP §2) ─────────────────────────────────
//
// `trimNavigation` (default true) seals the segment around a same-tab navigation
// and runs the page load off-camera, so the dead load time isn't recorded. We
// serve a deliberately slow second page and record the same script twice — trim
// on vs off — and assert the trimmed clip is meaningfully shorter, i.e. the load
// stall left no frames. Needs a browser + ffmpeg, so it runs via
// `npm run test:e2e`. Headless + --no-sandbox for CI/containers; no voiceover.

const LOAD_DELAY_MS = 1000;

const HOME = `<!doctype html><html><head><meta charset="utf-8"><title>home</title></head>
<body style="font-family: sans-serif; padding: 40px">
  <h1>Home</h1>
  <a id="go" href="/slow" style="font-size: 32px">Go to the slow page</a>
</body></html>`;

const SLOW = `<!doctype html><html><head><meta charset="utf-8"><title>slow</title></head>
<body style="font-family: sans-serif; padding: 40px"><h1 id="done">Loaded</h1></body></html>`;

/** Serve `/` instantly and `/slow` after a fixed delay, so navigating to it has a
 *  known stretch of load dead time. */
function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const send = () => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(req.url === "/slow" ? SLOW : HOME);
    };
    if (req.url === "/slow") setTimeout(send, LOAD_DELAY_MS);
    else send();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test(
  "trimNavigation cuts the page-load dead time out of the clip",
  { timeout: 180_000 },
  async () => {
    const { url, close } = await startServer();
    try {
      const record = async (trimNavigation: boolean): Promise<number> => {
        const dir = tmpDir();
        const result = await new Recordable({
          headless: true,
          launchArgs: ["--no-sandbox"],
          outputDir: dir,
          outputName: "reel",
          outputTimestamp: false,
          silent: true,
          actionDelay: 0, // isolate the navigation's contribution to the duration
          trimNavigation,
        })
          .visit(url)
          .waitFor("#go")
          // The slow page stalls LOAD_DELAY_MS before `load`; with trim off that
          // time is captured on-camera, with trim on it's sealed off-camera.
          .click("#go", { waitForNav: true })
          .waitFor("#done")
          .run();
        assert.equal(result.status, "completed");
        return getDuration(result.files[0].path);
      };

      const trimmed = await record(true);
      const untrimmed = await record(false);

      // The only material difference between the two runs is the ~1s load stall.
      // Trimmed should be shorter by most of it; allow generous slack for jitter.
      assert.ok(
        untrimmed - trimmed > LOAD_DELAY_MS / 1000 / 2,
        `expected the trimmed clip to drop ~${LOAD_DELAY_MS}ms of load time; ` +
          `trimmed=${trimmed.toFixed(2)}s untrimmed=${untrimmed.toFixed(2)}s`,
      );
    } finally {
      await close();
    }
  },
);
