import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { Runtime } from "../../src/browser/runtime.js";
import { createZoomExtension } from "../../src/browser/page-zoom.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { recordingLogger } from "../helpers.js";

// ─── pageZoom = genuine browser page zoom, end to end ────────────────────────
//
// `pageZoom` is real Ctrl +/− zoom, applied by the bundled extension
// (createZoomExtension → chrome.tabs.setZoom). This launches a browser exactly as
// the session does — setViewport emulation override + the extension's launch args —
// and asserts the two things only a live Chromium can prove:
//   1. zoom reflows the layout (innerWidth becomes ≈ width / pageZoom — more fits),
//   2. the animated cursor overlay AND real clicks still land on every target,
//      because page zoom keeps one coordinate space (no compensation needed).
//
// HEADFUL is required — extensions/page-zoom don't apply in old headless — so this
// pops a window; it's part of the opt-in `npm run test:e2e` suite, not CI.

const CURSOR_ID = "__recordable_cursor__";
const VIEWPORT = { width: 1000, height: 700 };
const ZOOM = 0.7;

// Markers at spread *logical* positions. The far ones make a zoom-factor
// misalignment glaring — a wrong coordinate space grows the error with distance.
const MARKERS = [
  { id: "m-tl", left: 40, top: 40 },
  { id: "m-tr", left: 760, top: 110 },
  { id: "m-mid", left: 320, top: 460 },
  { id: "m-br", left: 900, top: 640 },
];
const MARK_W = 90;
const MARK_H = 44;

const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>page-zoom e2e</title>
<style>
  html, body { margin: 0; }
  body { font-family: sans-serif; height: 1100px; position: relative; }
  .mark {
    position: absolute; width: ${MARK_W}px; height: ${MARK_H}px;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid #444; background: #eef;
  }
</style></head>
<body>
  ${MARKERS.map(
    (m) =>
      `<button class="mark" id="${m.id}" style="left:${m.left}px;top:${m.top}px"
        onclick="this.dataset.hit='1'">${m.id}</button>`,
  ).join("\n  ")}
</body></html>`;

const zoomExt = createZoomExtension(ZOOM);
let browser: Browser;
let page: Page;

before(async () => {
  browser = await puppeteer.launch({
    headless: false, // page zoom needs a visible/extension-capable browser
    args: [
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "--no-sandbox",
      ...zoomExt.args,
    ],
  });
  page = await browser.newPage();
  // Mirror session._setupPage: emulation override pins the recording dimensions;
  // the extension applies the zoom on top.
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
  page.setDefaultTimeout(5000);
});

after(async () => {
  await browser?.close();
  zoomExt.cleanup();
});

// The extension re-zooms on navigation; wait until the reflow has actually landed
// (innerWidth grown toward width / ZOOM) so assertions don't race the zoom.
async function loadZoomed() {
  await page.setContent(FIXTURE, { waitUntil: "load" });
  await page.waitForFunction(
    (target) => window.innerWidth > target,
    {},
    VIEWPORT.width * 1.2,
  );
}

beforeEach(loadZoomed);

function mkRuntime() {
  const log = recordingLogger();
  const cfg = { ...DEFAULT_CONFIG, cursor: true, autoScroll: false };
  return new Runtime(() => cfg, log);
}

const rectOf = (sel: string) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

async function assertCursorOnMarker(markerId: string, tol: number) {
  const cur = await rectOf(`#${CURSOR_ID}`);
  const mark = await rectOf(`#${markerId}`);
  const dx = cur.left - mark.left;
  const dy = cur.top - mark.top;
  assert.ok(
    Math.abs(dx) <= tol && Math.abs(dy) <= tol,
    `cursor should sit on ${markerId} (off by ${dx.toFixed(1)}, ${dy.toFixed(1)}px; tol ${tol})`,
  );
}

// ─── Zoom actually reflows the layout (more content fits) ──────────────────────

test(`pageZoom ${ZOOM}: layout reflows wider (innerWidth ≈ width / zoom)`, async () => {
  const iw = await page.evaluate(() => window.innerWidth);
  const expected = VIEWPORT.width / ZOOM;
  assert.ok(
    Math.abs(iw - expected) < expected * 0.05,
    `innerWidth ${iw} should be ≈ ${expected.toFixed(0)} (width / zoom)`,
  );
});

// ─── Overlay tracks the zoomed content ────────────────────────────────────────

test(`pageZoom ${ZOOM}: cursor lands on every target across the page`, async () => {
  const runtime = mkRuntime();
  for (const m of MARKERS) {
    // Drive the cursor to each marker by selector; the overlay's top-left must
    // coincide with the marker's. A wrong coordinate space puts the far markers
    // well outside the tolerance.
    await runtime.mouse(page, `#${m.id}`);
    await assertCursorOnMarker(m.id, 8);
  }
});

// ─── Clicks land under zoom ───────────────────────────────────────────────────

test(`pageZoom ${ZOOM}: click hits the zoomed target`, async () => {
  const runtime = mkRuntime();
  for (const m of MARKERS) {
    await runtime.click(page, `#${m.id}`);
    const hit = await page.$eval(
      `#${m.id}`,
      (el) => (el as HTMLElement).dataset.hit === "1",
    );
    assert.ok(hit, `${m.id} should register a click under pageZoom`);
  }
});

// ─── Composes with the animated transform zoom() ──────────────────────────────

test(`pageZoom ${ZOOM} + transform zoom(): cursor still lands on a moved-to target`, async () => {
  const runtime = mkRuntime();
  await runtime.zoomTo(page, 1.4, { origin: "#m-mid", duration: 80 });
  await runtime.mouse(page, "#m-mid");
  const cur = await rectOf(`#${CURSOR_ID}`);
  const mark = await rectOf("#m-mid");
  const inside =
    cur.left >= mark.left - 6 &&
    cur.left <= mark.right + 6 &&
    cur.top >= mark.top - 6 &&
    cur.top <= mark.bottom + 6;
  assert.ok(
    inside,
    `cursor (${cur.left.toFixed(0)}, ${cur.top.toFixed(0)}) should fall on #m-mid ` +
      `[${mark.left.toFixed(0)}–${mark.right.toFixed(0)}, ${mark.top.toFixed(0)}–${mark.bottom.toFixed(0)}]`,
  );
});
