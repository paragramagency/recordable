import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { Runtime } from "../../src/browser/runtime.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { recordingLogger } from "../helpers.js";

// ─── Container scrolling, end to end ─────────────────────────────────────────
//
// `scroll(target, { container })` must move a named overflow container's
// scrollTop — never the window — resolving "top"/"bottom"/absolute/selector
// targets against that container. This is the one thing unit tests can't cover:
// it depends on a real scroller's layout (scrollTop/scrollHeight/clientHeight)
// in a live Chromium. The window-only path stays covered by targets.e2e.ts.
//
// The page itself is also made scrollable (a tall spacer) so every test can
// assert the WINDOW stayed put while the container moved. Headless + --no-sandbox
// so it runs in CI/containers. Runs via `npm run test:e2e`.

const ROW_H = 120;
const ROWS = 12;
const PANE_H = 240;

// A 240px-tall scroll container holding 12 × 120px rows (1440px of content), plus
// a tall page spacer so window scroll is observable and independent.
const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>container-scroll e2e</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 16px; }
  #pane { height: ${PANE_H}px; overflow-y: auto; border: 1px solid #ccc; }
  #pane .row { height: ${ROW_H}px; box-sizing: border-box; padding: 8px; }
  .page-spacer { height: 2000px; }
</style></head>
<body>
  <h1 id="title">Container scroll e2e</h1>
  <div id="pane">
    ${Array.from(
      { length: ROWS },
      (_, i) => `<div class="row" id="row-${i + 1}">Row ${i + 1}</div>`,
    ).join("\n    ")}
    <button class="row" id="deep-btn"
      onclick="document.getElementById('clicked').textContent='yes'">Deep button</button>
  </div>
  <p id="clicked"></p>
  <div class="page-spacer"></div>
  <div id="page-bottom">Page bottom</div>
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

// No cursor; autoScroll off by default so the explicit container scroll under test
// is the only thing touching scroll position. Pass { autoScroll: true } for the
// auto-scroll-into-view cases.
function mkRuntime(over: { autoScroll?: boolean } = {}) {
  const log = recordingLogger();
  const cfg = { ...DEFAULT_CONFIG, cursor: false, autoScroll: false, ...over };
  return { runtime: new Runtime(() => cfg, log), log };
}

const FAST = { duration: 100 } as const;

const paneTop = () => page.$eval("#pane", (el) => el.scrollTop);
const paneMax = () =>
  page.$eval("#pane", (el) => el.scrollHeight - el.clientHeight);
const winY = () => page.evaluate(() => window.scrollY);

// Is `childSel` fully within `containerSel`'s visible box (± tolerance px)?
const childVisibleInContainer = (
  childSel: string,
  containerSel: string,
  tol = 2,
) =>
  page.evaluate(
    ({ childSel, containerSel, tol }) => {
      const c = document.querySelector(childSel)!.getBoundingClientRect();
      const b = document.querySelector(containerSel)!.getBoundingClientRect();
      return c.top >= b.top - tol && c.bottom <= b.bottom + tol;
    },
    { childSel, containerSel, tol },
  );

// ─── "bottom" / "top": container extremes, window untouched ───────────────────

test('scroll "bottom" scrolls the container to its end, not the window', async () => {
  const { runtime } = mkRuntime();
  assert.equal(await paneTop(), 0);
  await runtime.scroll(page, "bottom", { container: "#pane", ...FAST });
  assert.equal(
    await paneTop(),
    await paneMax(),
    "pane should sit at its max scrollTop",
  );
  assert.equal(await winY(), 0, "window must not have scrolled");
});

test('scroll "top" returns the container to the start', async () => {
  const { runtime } = mkRuntime();
  await page.$eval("#pane", (el) => (el.scrollTop = 999));
  await runtime.scroll(page, "top", { container: "#pane", ...FAST });
  assert.equal(await paneTop(), 0);
  assert.equal(await winY(), 0);
});

// ─── Numeric target: absolute scrollTop on the container ──────────────────────

test("numeric target sets the container's absolute scrollTop", async () => {
  const { runtime } = mkRuntime();
  await runtime.scroll(page, 360, { container: "#pane", ...FAST });
  assert.equal(await paneTop(), 360);
  assert.equal(await winY(), 0);
});

test("numeric target past the end clamps to the container's max", async () => {
  const { runtime } = mkRuntime();
  await runtime.scroll(page, 99999, { container: "#pane", ...FAST });
  assert.equal(await paneTop(), await paneMax());
});

// ─── Selector target: centre a child within the container ─────────────────────

test("selector target centres an off-screen child inside the container", async () => {
  const { runtime } = mkRuntime();
  // Row 9 starts at 8×120=960px — well past the 240px pane, so not visible yet.
  assert.equal(
    await childVisibleInContainer("#row-9", "#pane"),
    false,
    "row-9 should start off-screen within the pane",
  );
  await runtime.scroll(page, "#row-9", { container: "#pane", ...FAST });
  assert.equal(
    await childVisibleInContainer("#row-9", "#pane"),
    true,
    "row-9 should be visible within the pane after scrolling",
  );
  // Centred: row centre ≈ pane viewport centre.
  const offset = await page.evaluate(() => {
    const c = document.querySelector("#row-9")!.getBoundingClientRect();
    const b = document.querySelector("#pane")!.getBoundingClientRect();
    return Math.abs(c.top + c.height / 2 - (b.top + b.height / 2));
  });
  assert.ok(
    offset < 5,
    `row-9 should be centred in the pane (off by ${offset}px)`,
  );
  assert.equal(await winY(), 0, "window must not have scrolled");
});

// ─── Without a container, scroll still drives the window ───────────────────────

test("no container scrolls the window, leaving the pane untouched", async () => {
  const { runtime } = mkRuntime();
  await runtime.scroll(page, "#page-bottom", FAST);
  assert.ok(
    (await winY()) > 100,
    "window should have scrolled toward the bottom",
  );
  assert.equal(await paneTop(), 0, "the container must not have moved");
});

// ─── Auto-scroll-into-view walks into the nearest scrollable container ─────────

test("click auto-scrolls the container to reveal an off-screen target", async () => {
  const { runtime } = mkRuntime({ autoScroll: true });
  assert.equal(await paneTop(), 0);
  assert.equal(
    await childVisibleInContainer("#deep-btn", "#pane"),
    false,
    "deep button should start below the pane fold",
  );
  await runtime.click(page, "#deep-btn");
  assert.equal(
    await page.$eval("#clicked", (el) => el.textContent),
    "yes",
    "the click should have landed on the deep button",
  );
  assert.ok(
    (await paneTop()) > 0,
    "the pane should have scrolled to reveal it",
  );
  assert.equal(
    await childVisibleInContainer("#deep-btn", "#pane"),
    true,
    "deep button should be visible in the pane after the click",
  );
});
