import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { Runtime } from "../../src/browser/runtime.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { recordingLogger } from "../helpers.js";

// ─── pageZoom + cursor alignment, end to end ─────────────────────────────────
//
// `pageZoom` applies a CSS `zoom` to documentElement (done in session._setupPage,
// reproduced here on the page) so the layout reflows smaller. The regression this
// guards: the animated cursor overlay is a position:fixed child the browser scales
// by the same zoom as the content, while Puppeteer's boundingBox()/mouse coords
// stay in the unzoomed layout space — so the overlay must be fed those raw coords
// (no pageZoom compensation) to keep landing on its target. Over-compensating threw
// the cursor off by the zoom factor.
//
// Only a real Chromium exercises this: it depends on how CSS `zoom` composes with a
// fixed overlay's transform and CDP input. Headless + --no-sandbox for CI; runs via
// `npm run test:e2e`.

const CURSOR_ID = "__recordable_cursor__";

// Markers at spread *logical* positions (left/top before zoom). The far-from-origin
// ones make a zoom-factor misalignment glaring — the bug grew with distance.
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

let browser: Browser;
let page: Page;

before(async () => {
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 700 });
  page.setDefaultTimeout(4000);
});

after(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await page.setContent(FIXTURE, { waitUntil: "load" });
});

// Build a Runtime with the cursor on and autoScroll off (markers are all in view,
// so nothing should scroll). pageZoom lives on the page (set per test), not here.
function mkRuntime() {
  const log = recordingLogger();
  const cfg = { ...DEFAULT_CONFIG, cursor: true, autoScroll: false };
  return new Runtime(() => cfg, log);
}

// Apply pageZoom the way session._setupPage does: a CSS `zoom` on documentElement.
async function setPageZoom(z: number) {
  await page.evaluate((z) => {
    document.documentElement.style.zoom = String(z);
  }, z);
}

// Visual (post-zoom) top-left of an element, as the viewer sees it.
const rectOf = (sel: string) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });

// The overlay tip sits at the overlay box's top-left (minus a 2–4px art margin),
// so comparing top-left corners is a faithful "is the cursor on the target" check.
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

// ─── Overlay tracks the zoomed content ────────────────────────────────────────

test("pageZoom 0.7: cursor lands on every target across the page", async () => {
  const runtime = mkRuntime();
  await setPageZoom(0.7);
  for (const m of MARKERS) {
    // Drive the cursor to the marker's exact logical top-left (no jitter) so the
    // overlay's top-left must coincide with the marker's. A zoom-factor error
    // would put the far markers >100px off — well outside the tolerance.
    await runtime.mouse(page, { x: m.left, y: m.top });
    await assertCursorOnMarker(m.id, 8);
  }
});

test("pageZoom 1: cursor still lands on every target (no-zoom regression)", async () => {
  const runtime = mkRuntime();
  await setPageZoom(1);
  for (const m of MARKERS) {
    await runtime.mouse(page, { x: m.left, y: m.top });
    await assertCursorOnMarker(m.id, 6);
  }
});

// ─── Clicks land under zoom ───────────────────────────────────────────────────

test("pageZoom 0.7: click hits the zoomed target", async () => {
  const runtime = mkRuntime();
  await setPageZoom(0.7);
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

test("pageZoom 0.7 + transform zoom(): cursor still lands on a moved-to target", async () => {
  const runtime = mkRuntime();
  await setPageZoom(0.7);
  await runtime.zoomTo(page, 1.4, { origin: "#m-mid", duration: 80 });
  // After a transform zoom the overlay must still track its target — use the
  // selector path (getElementCenter) and assert the cursor tip lands inside it.
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
