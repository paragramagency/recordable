import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { Runtime } from "../../src/browser/runtime.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { recordingLogger } from "../helpers.js";

// ─── Horizontal container scrolling, end to end ──────────────────────────────
//
// `scroll(target, { container, axis: "x" })` must move a named overflow
// container's scrollLeft — never the window — resolving "left"/"right" (axis
// inferred) and absolute/selector targets (axis: "x") against that container.
// Mirrors container-scroll.e2e.ts on the x axis. Headless + --no-sandbox so it
// runs in CI/containers. Runs via `npm run test:e2e`.

const COL_W = 300;
const COLS = 12;
const PANE_W = 600;

// A 600px-wide scroll container holding 12 × 300px columns (3600px of content),
// plus a wide page spacer so window scroll is observable and independent.
const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>horizontal-scroll e2e</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 16px; }
  #pane { width: ${PANE_W}px; overflow-x: auto; white-space: nowrap; border: 1px solid #ccc; }
  #pane .col { display: inline-block; width: ${COL_W}px; height: 80px; box-sizing: border-box; padding: 8px; }
  .page-spacer { display: inline-block; width: 4000px; height: 1px; }
</style></head>
<body>
  <h1 id="title">Horizontal scroll e2e</h1>
  <div id="pane">
    ${Array.from(
      { length: COLS },
      (_, i) => `<div class="col" id="col-${i + 1}">Col ${i + 1}</div>`,
    ).join("\n    ")}
  </div>
  <div style="white-space: nowrap;">
    <span class="page-spacer"></span><span id="page-right">Page right</span>
  </div>
</body></html>`;

let browser: Browser;
let page: Page;

before(async () => {
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 700 });
  page.setDefaultTimeout(3000);
});

after(async () => {
  await browser?.close();
});

beforeEach(async () => {
  await page.setContent(FIXTURE, { waitUntil: "load" });
});

function mkRuntime() {
  const log = recordingLogger();
  const cfg = { ...DEFAULT_CONFIG, cursor: false, autoScroll: false };
  return { runtime: new Runtime(() => cfg, log), log };
}

const FAST = { duration: 100 } as const;

const paneLeft = () => page.$eval("#pane", (el) => el.scrollLeft);
const paneMax = () =>
  page.$eval("#pane", (el) => el.scrollWidth - el.clientWidth);
const winX = () => page.evaluate(() => window.scrollX);

// Is `childSel` fully within `containerSel`'s visible box horizontally (± tol px)?
const childVisibleInContainer = (
  childSel: string,
  containerSel: string,
  tol = 2,
) =>
  page.evaluate(
    ({ childSel, containerSel, tol }) => {
      const c = document.querySelector(childSel)!.getBoundingClientRect();
      const b = document.querySelector(containerSel)!.getBoundingClientRect();
      return c.left >= b.left - tol && c.right <= b.right + tol;
    },
    { childSel, containerSel, tol },
  );

// ─── "right" / "left": container extremes (axis inferred), window untouched ────

test('scroll "right" scrolls the container to its end, not the window', async () => {
  const { runtime } = mkRuntime();
  assert.equal(await paneLeft(), 0);
  await runtime.scroll(page, "right", { container: "#pane", ...FAST });
  assert.equal(
    await paneLeft(),
    await paneMax(),
    "pane should sit at its max scrollLeft",
  );
  assert.equal(await winX(), 0, "window must not have scrolled");
});

test('scroll "left" returns the container to the start', async () => {
  const { runtime } = mkRuntime();
  await page.$eval("#pane", (el) => (el.scrollLeft = 999));
  await runtime.scroll(page, "left", { container: "#pane", ...FAST });
  assert.equal(await paneLeft(), 0);
  assert.equal(await winX(), 0);
});

// ─── Numeric target with axis: "x": absolute scrollLeft on the container ───────

test('numeric target with axis "x" sets the container\'s absolute scrollLeft', async () => {
  const { runtime } = mkRuntime();
  await runtime.scroll(page, 900, { container: "#pane", axis: "x", ...FAST });
  assert.equal(await paneLeft(), 900);
  assert.equal(await winX(), 0);
});

test("numeric target past the end clamps to the container's max", async () => {
  const { runtime } = mkRuntime();
  await runtime.scroll(page, 99999, { container: "#pane", axis: "x", ...FAST });
  assert.equal(await paneLeft(), await paneMax());
});

// ─── Selector target with axis: "x": centre a child within the container ───────

test('selector target with axis "x" centres an off-screen child horizontally', async () => {
  const { runtime } = mkRuntime();
  // Col 9 starts at 8×300=2400px — well past the 600px pane, so not visible yet.
  assert.equal(
    await childVisibleInContainer("#col-9", "#pane"),
    false,
    "col-9 should start off-screen within the pane",
  );
  await runtime.scroll(page, "#col-9", {
    container: "#pane",
    axis: "x",
    ...FAST,
  });
  assert.equal(
    await childVisibleInContainer("#col-9", "#pane"),
    true,
    "col-9 should be visible within the pane after scrolling",
  );
  const offset = await page.evaluate(() => {
    const c = document.querySelector("#col-9")!.getBoundingClientRect();
    const b = document.querySelector("#pane")!.getBoundingClientRect();
    return Math.abs(c.left + c.width / 2 - (b.left + b.width / 2));
  });
  assert.ok(
    offset < 5,
    `col-9 should be centred in the pane (off by ${offset}px)`,
  );
  assert.equal(await winX(), 0, "window must not have scrolled");
});

// ─── Without a container, scroll still drives the window on the x axis ─────────

test('no container with axis "x" scrolls the window, leaving the pane untouched', async () => {
  const { runtime } = mkRuntime();
  await runtime.scroll(page, "#page-right", { axis: "x", ...FAST });
  assert.ok(
    (await winX()) > 100,
    "window should have scrolled toward the right",
  );
  assert.equal(await paneLeft(), 0, "the container must not have moved");
});
