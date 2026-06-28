import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import puppeteer, {
  type Browser,
  type Page,
  type ElementHandle,
} from "puppeteer";
import { resolveTarget } from "../../src/browser/targets.js";
import { getHandle } from "../../src/browser/dom.js";
import { Runtime } from "../../src/browser/runtime.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { recordingLogger } from "../helpers.js";

// ─── Target system, end to end ───────────────────────────────────────────────
//
// Exercises the WHOLE target surface against a real Chromium page — the one thing
// the unit tests can't cover, since it depends on Puppeteer actually accepting
// our compiled selectors (`::-p-text`, `>>>`, `:has`, `:nth-child`) and on the
// live DOM. Covers resolution identity, the composable `:text()` pseudo, select
// option pseudos, the ambiguity warning, and that real actions hit the element a
// target names. Needs a browser, so it runs via `npm run test:e2e`.
//
// Headless + --no-sandbox so it runs in CI/containers.

const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>targets e2e</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 16px; }
  .spacer { height: 1200px; }
</style></head>
<body>
  <h1 id="title">Targets e2e</h1>

  <nav><ul>
    <li><a href="/home" data-nav="home">Home</a></li>
    <li><a href="/pricing" data-nav="pricing" class="active">Pricing</a></li>
    <li><a href="/docs" data-nav="docs">Docs</a></li>
  </ul></nav>

  <div class="toolbar">
    <button class="btn" onclick="document.getElementById('status').textContent='saved'">Save</button>
    <a class="btn" href="#" onclick="document.getElementById('status').textContent='linked';return false">Save link</a>
    <span class="hint">Save your work</span>
  </div>
  <p id="status"></p>

  <label>Recipient <input id="recipient" /></label>
  <select id="service">
    <option value="standard">Standard</option>
    <option value="express">Express</option>
    <option value="overnight">Overnight</option>
  </select>

  <table id="grid">
    <tr><td>r1c1</td><td>r1c2</td></tr>
    <tr><td>r2c1</td><td>r2c2</td></tr>
    <tr><td>r3c1</td><td>r3c2</td></tr>
  </table>

  <p class="dup">one</p>
  <p class="dup">two</p>

  <section class="card"><h2>Card heading</h2><p>has a heading</p></section>
  <section class="card"><p>no heading</p></section>

  <button id="reveal" onclick="setTimeout(function(){document.getElementById('later').hidden=false},150)">Reveal</button>
  <p id="later" hidden>Appeared</p>

  <div id="host"></div>

  <div class="spacer"></div>
  <div id="bottom">Bottom target</div>

  <script>
    var root = document.getElementById('host').attachShadow({mode:'open'});
    root.innerHTML = '<button class="shadow-btn">In Shadow</button>';
  </script>
</body></html>`;

let browser: Browser;
let page: Page;

before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 700 });
  // A short default keeps the not-found case from blocking on the 30s locator wait.
  page.setDefaultTimeout(3000);
});

after(async () => {
  await browser?.close();
});

// Fresh DOM per test so behavioural mutations (typing, clicks) don't leak.
beforeEach(async () => {
  await page.setContent(FIXTURE, { waitUntil: "load" });
});

// Non-cursor, no-autoscroll config so actions don't depend on the overlay or
// scroll machinery — the target resolution is what's under test.
function mkRuntime() {
  const log = recordingLogger();
  const cfg = { ...DEFAULT_CONFIG, cursor: false, autoScroll: false };
  return { runtime: new Runtime(() => cfg, log), log };
}

const text = (h: ElementHandle<Element>) =>
  h.evaluate((el) => el.textContent?.trim() ?? "");
const tag = (h: ElementHandle<Element>) => h.evaluate((el) => el.tagName);
const count = async (target: string) =>
  (await page.$$(resolveTarget(target))).length;

// ─── Resolution identity: each form finds the intended element ────────────────

test("id selector", async () => {
  assert.equal(await text(await getHandle(page, "#title")), "Targets e2e");
});

test("attribute selector", async () => {
  assert.equal(
    await text(await getHandle(page, "[data-nav=pricing]")),
    "Pricing",
  );
});

test("class + attribute combined", async () => {
  assert.equal(
    await text(await getHandle(page, "a.active[data-nav=pricing]")),
    "Pricing",
  );
});

test("descendant nesting", async () => {
  assert.equal(
    await text(await getHandle(page, "nav ul li a[data-nav=docs]")),
    "Docs",
  );
});

test("positional :nth-child — 1st td in 3rd tr", async () => {
  const h = await getHandle(page, "#grid tr:nth-child(3) td:first-child");
  assert.equal(await text(h), "r3c1");
});

test(":has() relational pseudo", async () => {
  const h = await getHandle(page, "section.card:has(> h2)");
  assert.match(await text(h), /Card heading/);
});

test(">>> pierces shadow DOM", async () => {
  const h = await getHandle(page, "#host >>> .shadow-btn");
  assert.equal(await tag(h), "BUTTON");
  assert.equal(await text(h), "In Shadow");
});

test("not-found target rejects with a clear error", async () => {
  await assert.rejects(
    getHandle(page, "#does-not-exist"),
    /Could not find target: "#does-not-exist"/,
  );
});

// ─── Inner text: :text() pseudo + legacy prefix ───────────────────────────────

test(":text() scoped to a tag resolves to that element", async () => {
  const h = await getHandle(page, "button:text(Save)");
  assert.equal(await tag(h), "BUTTON");
  assert.equal(await text(h), "Save");
});

test(":text() composes with nesting", async () => {
  assert.equal(
    await text(await getHandle(page, "nav a:text(Pricing)")),
    "Pricing",
  );
});

test("legacy text: prefix resolves by visible text", async () => {
  assert.equal(await tag(await getHandle(page, "text:Card heading")), "H2");
});

test("bare :text() over-matches; scoping narrows it — the motivation", async () => {
  // "Save" appears in a <button>, an <a>, and a <span>.
  assert.ok(
    (await count(":text(Save)")) >= 2,
    "bare :text(Save) should match several",
  );
  assert.equal(
    await count("button:text(Save)"),
    1,
    "scoped should match exactly one",
  );
});

// ─── Ambiguity warning ────────────────────────────────────────────────────────

test("ambiguous target warns once and proceeds", async () => {
  const { runtime, log } = mkRuntime();
  await runtime.waitFor(page, ".dup");
  assert.ok(
    log.lines.some((l) => /"\.dup" matched 2 elements/.test(l)),
    `expected an ambiguity warning, got: ${JSON.stringify(log.lines)}`,
  );
});

test("unambiguous target does not warn", async () => {
  const { runtime, log } = mkRuntime();
  await runtime.waitFor(page, "#title");
  assert.ok(!log.lines.some((l) => /matched \d+ elements/.test(l)));
});

// ─── Behaviour: actions hit the element the target names ──────────────────────

test("type fills the targeted input", async () => {
  const { runtime } = mkRuntime();
  await runtime.type(page, "#recipient", "Ada Lovelace");
  assert.equal(
    await page.$eval("#recipient", (el) => (el as HTMLInputElement).value),
    "Ada Lovelace",
  );
});

test("clear empties the targeted input", async () => {
  // Single char on purpose: clear()'s select-all is Cmd+A on macOS, which a
  // headless browser doesn't honour (the recorder normally runs headed). One
  // char is removed by the trailing Backspace regardless, so this stays about
  // clear() reaching the right field rather than the OS select-all binding.
  const { runtime } = mkRuntime();
  await runtime.type(page, "#recipient", "x");
  await runtime.clear(page, "#recipient");
  assert.equal(
    await page.$eval("#recipient", (el) => (el as HTMLInputElement).value),
    "",
  );
});

test("click via :text() fires the button's handler, not the lookalike link", async () => {
  const { runtime } = mkRuntime();
  await runtime.click(page, "button:text(Save)");
  // The <button> sets 'saved'; the <a>Save link</a> would set 'linked'.
  assert.equal(await page.$eval("#status", (el) => el.textContent), "saved");
});

test("select by literal value", async () => {
  const { runtime } = mkRuntime();
  await runtime.select(page, "#service", "express");
  assert.equal(
    await page.$eval("#service", (el) => (el as HTMLSelectElement).value),
    "express",
  );
});

test("select by :option-label(...) visible text", async () => {
  const { runtime } = mkRuntime();
  await runtime.select(page, "#service", ":option-label(Overnight)");
  assert.equal(
    await page.$eval("#service", (el) => (el as HTMLSelectElement).value),
    "overnight",
  );
});

test("select by :option-index(N) is 1-based", async () => {
  const { runtime } = mkRuntime();
  await runtime.select(page, "#service", ":option-index(2)");
  assert.equal(
    await page.$eval("#service", (el) => (el as HTMLSelectElement).value),
    "express",
  );
});

// ─── select reaches a <select> inside an iframe (dialog), not a same-id decoy ──
//
// Dialogs render in an <iframe>; the top frame can hold a hidden placeholder with
// the same id. select() must act on the *visible* control in the iframe (via the
// frame-aware getHandle), never the main-frame decoy — page.select/$eval would.

const IFRAME_FIXTURE = `<!doctype html><meta charset="utf-8"><body>
  <select id="svc" style="display:none"><option value="decoy">Decoy</option></select>
  <iframe id="dlg" style="width:400px;height:200px" srcdoc='
    <!doctype html><meta charset=utf-8><body>
    <select id="svc">
      <option value="standard">Standard</option>
      <option value="express">Express</option>
      <option value="overnight">Overnight</option>
    </select></body>'></iframe>
</body>`;

const dialogValue = async () => {
  const frame = await (await page.$("#dlg"))!.contentFrame();
  return frame!.$eval("#svc", (el) => (el as HTMLSelectElement).value);
};
const decoyValue = () =>
  page.$eval("#svc", (el) => (el as HTMLSelectElement).value);

for (const [name, value, want] of [
  ["literal value", "express", "express"],
  [":option-index(N)", ":option-index(3)", "overnight"],
  [":option-label(...)", ":option-label(Express)", "express"],
] as const) {
  test(`select by ${name} targets the iframe's <select>, not the decoy`, async () => {
    await page.setContent(IFRAME_FIXTURE, { waitUntil: "networkidle0" });
    const { runtime } = mkRuntime();
    await runtime.select(page, "#svc", value);
    assert.equal(await dialogValue(), want, "iframe <select> should change");
    assert.equal(
      await decoyValue(),
      "decoy",
      "main-frame decoy must be untouched",
    );
  });
}

test("waitFor resolves once a deferred element appears", async () => {
  const { runtime } = mkRuntime();
  await runtime.click(page, "#reveal");
  await runtime.waitFor(page, "#later"); // unhides ~150ms after the click
  assert.equal(
    await page.$eval("#later", (el) => (el as HTMLElement).hidden),
    false,
  );
});

test("scroll brings an off-screen target into view", async () => {
  const { runtime } = mkRuntime();
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await runtime.scroll(page, "#bottom", { duration: 100 });
  assert.ok(
    (await page.evaluate(() => window.scrollY)) > 100,
    "expected the page to have scrolled toward the bottom target",
  );
});
