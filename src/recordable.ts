import puppeteer, {
  type Browser,
  type Page,
  type GoToOptions,
} from "puppeteer";
import { PuppeteerScreenRecorder } from "puppeteer-screen-recorder";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RecordableConfig {
  /** Browser viewport dimensions. Default: 1920×1080 */
  viewport?: { width: number; height: number };
  /** Recording frame rate. Default: 30 */
  fps?: number;
  /** Output directory. Default: ./output */
  outputDir?: string;
  /** Base filename (without extension or timestamp). Default: recordable */
  outputName?: string;
  /** Prepend an ISO timestamp to the filename. Default: true */
  outputTimestamp?: boolean;
  /** Run without a visible browser window. Default: false */
  headless?: boolean;
  /** Typing speed in characters per second. Higher = faster. Default: 7 */
  typingSpeed?: number;
  /** Constant Rate Factor — lower = better quality, larger file. Default: 18 */
  videoCrf?: number;
  /** FFmpeg video codec. Default: libx264 */
  videoCodec?: string;
  /** FFmpeg encoding preset. Default: ultrafast */
  videoPreset?: string;
  /** Output aspect ratio. Default: 16:9 */
  aspectRatio?: string;
  /** Default zoom transition duration in ms. Default: 600 */
  zoomDuration?: number;
  /** Automatic pause inserted between every action in ms. Default: 300 */
  actionDelay?: number;
  /** Suppress all console output. Default: false */
  silent?: boolean;
  /** Automatically scroll an element into view before clicking or typing. Default: true */
  autoScroll?: boolean;
  /** Minimum viewport margin (px) kept above/below element when auto-scrolling. Default: 120 */
  scrollMargin?: number;
  /** Auto-scroll speed in px/s — faster = snappier short scrolls. Default: 1500 */
  scrollSpeed?: number;
  /** Show an animated cursor overlay that moves to elements before interacting. Default: false */
  cursor?: boolean;
  /** Timeout in ms for page navigation. Default: 30000 */
  visitTimeout?: number;
}

// ─── Class ───────────────────────────────────────────────────────────────────

type Action = (page: Page) => Promise<void>;

/** Options for {@link Recordable.waitFor}. */
export interface WaitForOptions {
  /**
   * What to wait for:
   * - `"visible"` (default) — element is present *and* rendered
   * - `"hidden"`            — element is absent or not rendered
   * - `"present"`           — element is attached to the DOM (may be hidden)
   */
  state?: "visible" | "hidden" | "present";
  /** Timeout in ms. Default: the `visitTimeout` config value. */
  timeout?: number;
}

export class Recordable {
  private cfg: Required<RecordableConfig> = {
    viewport: { width: 1920, height: 1080 },
    fps: 30,
    outputDir: "./output",
    outputName: "recordable",
    outputTimestamp: true,
    headless: false,
    typingSpeed: 7,
    videoCrf: 18,
    videoCodec: "libx264",
    videoPreset: "ultrafast",
    aspectRatio: "16:9",
    zoomDuration: 600,
    actionDelay: 300,
    silent: false,
    autoScroll: true,
    scrollMargin: 120,
    scrollSpeed: 1500,
    cursor: false,
    visitTimeout: 30_000,
  };
  private queue: Action[] = [];
  private browser: Browser | null = null;
  private recorder: PuppeteerScreenRecorder | null = null;
  private mousePos = { x: 0, y: 0 };
  private zoomState = { tx: 0, ty: 0, s: 1 };
  private outputPath = "";

  constructor(config: RecordableConfig = {}) {
    this.cfg = { ...this.cfg, ...config };
  }

  /** Merge additional config options at runtime. Enqueue as an action so it takes effect at the right point in the sequence. */
  setConfig(config: RecordableConfig): this {
    return this._enqueue(async () => {
      this.cfg = { ...this.cfg, ...config };
    });
  }

  // ─── Recording ─────────────────────────────────────────────────────────────

  /** Start recording. Can be placed anywhere in the chain. */
  start(): this {
    return this._enqueue(async (page) => {
      this.recorder = new PuppeteerScreenRecorder(page, {
        fps: this.cfg.fps,
        videoFrame: this.cfg.viewport,
        videoCrf: this.cfg.videoCrf,
        videoCodec: this.cfg.videoCodec,
        videoPreset: this.cfg.videoPreset,
        aspectRatio: this.cfg.aspectRatio,
      });
      await this.recorder.start(this.outputPath);
      this._log("Start");
    });
  }

  /** Stop recording and flush the file. */
  stop(): this {
    return this._enqueue(async () => {
      if (this.recorder) {
        await this.recorder.stop();
        this.recorder = null;
        this._log("Stop");
      }
    });
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  /** Navigate to a URL and wait for the page to settle. */
  visit(url: string, options?: GoToOptions): this {
    return this._enqueue(async (page) => {
      this._log("Visit", url);
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.cfg.visitTimeout,
        ...options,
      });
      if (this.cfg.cursor) await this._injectCursor(page);
    });
  }

  // ─── Manual interaction ──────────────────────────────────────────────────────

  /**
   * Block the sequence until you press **Enter** in the terminal, so you can
   * interact with the browser by hand — typically to complete a login or other
   * step that can't (or shouldn't) be scripted.
   *
   * In headful mode (`headless: false`) the Chrome window Puppeteer opens is a
   * normal, interactive window: click and type in it yourself, then press Enter
   * to resume. Place this *before* `start()` to keep the manual step out of the
   * recording, e.g.  `visit(loginUrl).pause().start()…`.
   *
   * No-op in headless mode (there is no window to interact with) — it logs a
   * warning and continues so unattended runs don't hang.
   */
  pause(
    message = "Paused — interact with the browser, then press Enter to continue…",
  ): this {
    return this._enqueue(async (page) => {
      if (this.cfg.headless) {
        this._log("Pause", "headless mode — skipping (nothing to interact with)");
        return;
      }
      this._log("Pause", message);
      await this._waitForEnter(message);
      // The page may have navigated during the manual step (e.g. a login
      // redirect), which destroys any injected cursor — re-inject it.
      if (this.cfg.cursor) await this._injectCursor(page);
    });
  }

  /**
   * Wait for an element to reach a given state before continuing. Useful as an
   * automatic trigger after a manual step — e.g. resume once a post-login
   * element appears — or simply to wait for async content to render.
   *
   * `target` accepts a CSS selector or a `text:` prefix (matched by visible text).
   * See {@link WaitForOptions} for `state`/`timeout`.
   */
  waitFor(target: string, options: WaitForOptions = {}): this {
    return this._enqueue(async (page) => {
      const { state = "visible", timeout = this.cfg.visitTimeout } = options;
      this._log("WaitFor", `${target} (${state})`);
      const sel = this._resolveTarget(target);
      await page.waitForSelector(sel, {
        timeout,
        visible: state === "visible",
        hidden: state === "hidden",
      });
      if (this.cfg.cursor) await this._injectCursor(page);
    });
  }

  // ─── Interactions ──────────────────────────────────────────────────────────

  /**
   * Click an element. Accepts:
   * - CSS selector → `#id`, `.class`, `input[name="…"]`, or any valid selector
   * - `text:` prefix → `"text:Next"` matches by visible text
   */
  click(target: string): this {
    return this._enqueue(async (page) => {
      this._log("Click", target);
      await this._click(page, target);
    });
  }

  /**
   * Move the mouse (and cursor overlay) onto an element without clicking, so any
   * `:hover` state — tooltips, dropdowns, menus — is revealed.
   */
  hover(target: string): this {
    return this._enqueue(async (page) => {
      this._log("Hover", target);
      if (this.cfg.autoScroll)
        await this._scrollIntoView(
          page,
          target,
          this.cfg.scrollMargin,
          this.cfg.scrollSpeed,
        );
      const { x, y } = await this._getElementCenter(page, target);
      if (this.cfg.cursor) await this._moveCursor(page, x, y);
      else await page.mouse.move(x, y);
    });
  }

  /**
   * Type into an element with human-like timing. Accepts:
   * - CSS selector → `#id`, `input[name="field[0]"]`, `.class`, or any valid selector
   * - `text:` prefix → `"text:Label"` matches by visible text
   */
  type(target: string, text: string): this {
    return this._enqueue(async (page) => {
      this._log("Type", `${target}  "${this._truncate(text)}"`);
      await this._click(page, target);
      await this._sleep(this._jitter(150));
      for (const char of text) {
        await page.keyboard.type(char);
        await this._sleep(this._typeDelay(char));
      }
    });
  }

  /**
   * Clear the contents of an input or textarea (select-all + delete). Handy
   * before re-typing into a pre-filled field.
   */
  clear(target: string): this {
    return this._enqueue(async (page) => {
      this._log("Clear", target);
      await this._click(page, target);
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(mod);
      await page.keyboard.press("KeyA");
      await page.keyboard.up(mod);
      await page.keyboard.press("Backspace");
    });
  }

  /**
   * Select one or more options in a native `<select>` element.
   * Values are matched against the option `value` attribute.
   * For custom dropdowns, use a combination of `click()` and `key("Escape")`.
   */
  select(target: string, ...values: string[]): this {
    return this._enqueue(async (page) => {
      this._log("Select", `${target}  [${values.join(", ")}]`);
      if (this.cfg.autoScroll)
        await this._scrollIntoView(
          page,
          target,
          this.cfg.scrollMargin,
          this.cfg.scrollSpeed,
        );
      await page.select(target, ...values);
    });
  }

  /** Press a keyboard key (e.g. "Escape", "Enter", "Tab"). */
  key(key: string): this {
    return this._enqueue(async (page) => {
      this._log("Key", key);
      await page.keyboard.press(key as any);
    });
  }

  /**
   * Move the mouse (and cursor overlay) to a target or coordinates.
   * - CSS selector / plain text → moves to the centre of the element
   * - `{ x, y }` → moves to absolute viewport coordinates
   */
  mouse(target: string | { x: number; y: number }): this {
    return this._enqueue(async (page) => {
      let x: number;
      let y: number;
      if (typeof target === "string") {
        ({ x, y } = await this._getElementCenter(page, target));
        this._log("Mouse", target);
      } else {
        ({ x: x, y: y } = target);
        this._log("Mouse", `(${x}, ${y})`);
      }
      if (this.cfg.cursor) await this._moveCursor(page, x, y);
      else await page.mouse.move(x, y);
    });
  }

  // ─── Scrolling ─────────────────────────────────────────────────────────────

  /**
   * Smooth-scroll to an element or position. Accepts:
   * - `"top"` / `"bottom"` → scroll to the very top or bottom of the page
   * - CSS selector or plain text → element is centred in the viewport
   * - number → absolute Y pixel position
   */
  scroll(target: string | number, duration = 1200): this {
    return this._enqueue(async (page) => {
      this._log("Scroll", String(target));
      if (typeof target === "number") {
        await this._smoothScroll(page, target, duration);
      } else if (target === "top") {
        await this._smoothScroll(page, 0, duration);
      } else if (target === "bottom") {
        const bottom = await page.evaluate(() => document.body.scrollHeight);
        await this._smoothScroll(page, bottom, duration);
      } else {
        const handle = await this._get(page, target);
        const y = await page.evaluate(
          (el, vh) => {
            const rect = el.getBoundingClientRect();
            return window.scrollY + rect.top + rect.height / 2 - vh / 2;
          },
          handle,
          page.viewport()?.height ?? 900,
        );
        await this._smoothScroll(page, y, duration);
      }
    });
  }

  // ─── Zoom ──────────────────────────────────────────────────────────────────

  /**
   * Smoothly scale the viewport to the given level from a transform origin.
   * Calling zoom() again while already zoomed transitions both the scale and
   * the origin simultaneously — no jump, no reset needed in between.
   *
   * `origin` accepts:
   * - CSS position keyword(s): `"center"`, `"top left"`, `"bottom right"`, etc.
   * - Percentages:             `"50% 50%"`, `"0% 100%"`, etc.
   * - CSS selector:            `"#hero"`, `".card"`, `"input[name=…]"`
   * - `text:` prefix:          `"text:Section heading"` (matched by visible text)
   *
   * `duration` overrides the `zoomDuration` config value for this call only.
   */
  zoom(level: number, origin = "center", duration?: number): this {
    return this._enqueue(async (page) => {
      this._log("Zoom", `${level}x  ${origin}`);
      const dur = duration ?? this.cfg.zoomDuration;
      const { x, y } = await this._originToCoords(page, origin);

      // Express zoom as translate()+scale() on a 0,0 origin so that a single
      // CSS `transform` transition smoothly animates both level and origin.
      const tx = x * (1 - level);
      const ty = y * (1 - level);
      this.zoomState = { tx, ty, s: level };

      await page.evaluate(
        ({ tx, ty, level, dur }) =>
          new Promise<void>((resolve) => {
            const root = document.documentElement;
            root.style.transformOrigin = "0 0";
            root.style.transition = `transform ${dur}ms ease-in-out`;
            root.style.transform = `translate(${tx}px, ${ty}px) scale(${level})`;
            setTimeout(resolve, dur + 50);
          }),
        { tx, ty, level, dur },
      );
    });
  }

  /** Smoothly reset zoom back to 1. Clears transform styles once the transition ends. */
  resetZoom(duration?: number): this {
    return this._enqueue(async (page) => {
      this._log("Zoom", "reset");
      this.zoomState = { tx: 0, ty: 0, s: 1 };
      const dur = duration ?? this.cfg.zoomDuration;
      await page.evaluate(
        (dur) =>
          new Promise<void>((resolve) => {
            const root = document.documentElement;
            root.style.transition = `transform ${dur}ms ease-in-out`;
            root.style.transform = "none";
            setTimeout(() => {
              root.style.transition = "";
              root.style.transformOrigin = "";
              resolve();
            }, dur + 50);
          }),
        dur,
      );
    });
  }

  // ─── Timing ────────────────────────────────────────────────────────────────

  /** Pause the sequence for `ms` milliseconds. */
  wait(ms: number): this {
    return this._enqueue(async () => {
      this._log("Wait", `${ms}ms`);
      await this._sleep(ms);
    });
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  /** Execute the queued action sequence. Errors are caught and logged. */
  async run(): Promise<void> {
    this.outputPath = this._getOutputPath();
    this.browser = await puppeteer.launch({
      headless: this.cfg.headless,
      args: [
        `--window-size=${this.cfg.viewport.width},${this.cfg.viewport.height}`,
      ],
    });

    const page = await this.browser.newPage();
    await page.setViewport({ ...this.cfg.viewport, deviceScaleFactor: 1 });

    // Flush recording and close browser on SIGINT / SIGTERM
    const onSignal = () => {
      this._log("Signal", "stopping recording…");
      this._cleanup().finally(() => process.exit(0));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    try {
      for (const action of this.queue) {
        await action(page);
        if (this.cfg.actionDelay > 0) await this._sleep(this.cfg.actionDelay);
      }
    } catch (err) {
      this._log("Error", String(err));
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await this._cleanup();
      this._log("Output", this.outputPath);
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  // ── Manual interaction ──

  /** Resolve once the user presses Enter on stdin. */
  private _waitForEnter(message: string): Promise<void> {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      process.stdout.write(`\n  ⏸  ${message}\n`);
      const onData = () => {
        stdin.off("data", onData);
        stdin.pause();
        resolve();
      };
      stdin.resume();
      stdin.once("data", onData);
    });
  }

  // ── Cursor ──

  private async _injectCursor(page: Page): Promise<void> {
    await page.evaluate(() => {
      // Skip if already injected or running inside an iframe
      if (document.getElementById("__sr_cursor__") || window !== window.parent)
        return;

      const style = document.createElement("style");
      style.textContent = `
        * { cursor: none !important; }
        #__sr_cursor__ {
          position: fixed;
          top: 0; left: 0;
          margin: -2px 0 0 -4px;
          z-index: 2147483647;
          pointer-events: none;
          will-change: transform;
          transition: transform 0.15s;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));
        }
        #__sr_cursor__.pressing {
          transform: var(--sr-pos) scale(0.88) !important;
          transition: transform 0.08s !important;
        }
      `;
      document.head.appendChild(style);

      const cursor = document.createElement("div");
      cursor.id = "__sr_cursor__";
      cursor.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <path d="M4 2 L4 19 L8.5 14.5 L12 22 L14 21 L10.5 13.5 L17 13.5 Z"
              fill="white" stroke="#1e1b4b" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>`;
      document.body.appendChild(cursor);
    });
    this.mousePos = { x: 0, y: 0 };
  }

  private async _moveCursor(
    page: Page,
    toX: number,
    toY: number,
  ): Promise<void> {
    const dx = toX - this.mousePos.x;
    const dy = toY - this.mousePos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dur = Math.min(700, Math.max(150, dist * 0.5));

    // When documentElement has a CSS transform, position:fixed children are
    // positioned relative to that ancestor (not the viewport), so they scroll
    // with the page. Convert viewport coords → document coords first, then
    // apply the inverse zoom transform.
    const { tx, ty, s } = this.zoomState;
    const hasTransform = s !== 1 || tx !== 0 || ty !== 0;
    const scroll = hasTransform
      ? await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      : { x: 0, y: 0 };
    const cx = (toX + scroll.x - tx) / s;
    const cy = (toY + scroll.y - ty) / s;

    await page.evaluate(
      ({ cx, cy, dur }) =>
        new Promise<void>((resolve) => {
          const cursor = document.getElementById("__sr_cursor__");
          if (!cursor) {
            resolve();
            return;
          }
          cursor.style.transition = `transform ${dur}ms cubic-bezier(0.4,0,0.2,1)`;
          cursor.style.setProperty("--sr-pos", `translate(${cx}px, ${cy}px)`);
          cursor.style.transform = `translate(${cx}px, ${cy}px)`;
          setTimeout(resolve, dur);
        }),
      { cx, cy, dur },
    );

    await page.mouse.move(toX, toY);
    this.mousePos = { x: toX, y: toY };
  }

  private async _clickEffect(page: Page): Promise<void> {
    await page.evaluate(() => {
      const cursor = document.getElementById("__sr_cursor__");
      if (!cursor) return;
      cursor.classList.add("pressing");
      void cursor.offsetWidth;
    });
    await this._sleep(120);
    await page.evaluate(() => {
      document.getElementById("__sr_cursor__")?.classList.remove("pressing");
    });
    await this._sleep(60);
  }

  // ── Helpers ──

  /** Shared logic for all click-like actions: autoScroll → cursor move → click effect → coordinate click.
   *  Uses page.mouse.click() rather than ElementHandle.click() to avoid Puppeteer's built-in
   *  scrollIntoView, which would override our centred scroll position. */
  private async _click(page: Page, target: string): Promise<void> {
    if (this.cfg.autoScroll) {
      await this._scrollIntoView(
        page,
        target,
        this.cfg.scrollMargin,
        this.cfg.scrollSpeed,
      );
    }
    const { x, y } = await this._getElementCenter(page, target);
    if (this.cfg.cursor) {
      await this._moveCursor(page, x, y);
      await this._sleep(this._jitter(100));
      await this._clickEffect(page);
    }
    await page.mouse.click(x, y);
  }

  private _typeDelay(char: string): number {
    const base = this.cfg.typingSpeed > 0 ? 1000 / this.cfg.typingSpeed : 0;
    const pause =
      char === " " || char === "." || char === "," ? this._jitter(30, 1) : 0;
    return Math.max(0, this._jitter(base, 0.35) + pause);
  }

  private _log(name: string, value?: string): void {
    if (this.cfg.silent) return;
    const label = name.padEnd(8);
    console.log(value !== undefined ? `${label}${value}` : label.trimEnd());
  }

  private async _cleanup(): Promise<void> {
    if (this.recorder) await this.recorder.stop().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.recorder = null;
    this.browser = null;
  }

  private _enqueue(action: Action): this {
    this.queue.push(action);
    return this;
  }

  /** Resolve target and wait for the element to exist in the DOM, then return its handle. */
  private async _get(page: Page, target: string) {
    try {
      return await page.locator(this._resolveTarget(target)).waitHandle();
    } catch {
      throw new Error(`Could not find target: "${target}"`);
    }
  }

  /** Resolve a target string to a Puppeteer selector.
   *  Prefix with `text:` for plain-text matching; everything else is treated as a CSS selector. */
  private _resolveTarget(target: string): string {
    return target.startsWith("text:")
      ? `::-p-text(${target.slice(5)})`
      : target;
  }

  /** Returns `base` ± `variance` (defaults to ±50% of base). */
  private _jitter(base: number, variance = 0.5): number {
    return base + (Math.random() - 0.5) * base * variance * 2;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private _getOutputPath(): string {
    const { outputDir, outputName, outputTimestamp } = this.cfg;
    const timestamp = outputTimestamp
      ? "-" + new Date().toISOString().replace(/\D/g, "").slice(0, 14)
      : "";
    const out = `${outputDir}/${outputName}${timestamp}.mp4`;
    mkdirSync(dirname(out), { recursive: true });
    return out;
  }

  private _truncate(text: string, max = 40): string {
    return text.length > max ? text.slice(0, max) + "…" : text;
  }

  /** Get the centre coords of a target element. */
  private async _getElementCenter(
    page: Page,
    target: string,
  ): Promise<{ x: number; y: number }> {
    const handle = await this._get(page, target);
    const box = await handle.boundingBox();
    if (!box) throw new Error(`No bounding box for "${target}"`);
    // Jitter up to 20% of each dimension away from centre, staying within bounds
    const jitter = (range: number) => (Math.random() - 0.5) * range * 0.4;
    return {
      x: box.x + box.width / 2 + jitter(box.width),
      y: box.y + box.height / 2 + jitter(box.height),
    };
  }

  /**
   * Resolve an origin string to viewport pixel coordinates.
   * Accepts CSS position keywords/percentages or an element selector.
   */
  private async _originToCoords(
    page: Page,
    origin: string,
  ): Promise<{ x: number; y: number }> {
    if (this._isPositionValue(origin)) {
      return page.evaluate((origin) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const tokens = origin.trim().toLowerCase().split(/\s+/);
        const kw: Record<string, number> = {
          left: 0,
          top: 0,
          center: 50,
          right: 100,
          bottom: 100,
        };
        if (tokens.length === 1) {
          const [t] = tokens;
          const p = t in kw ? kw[t] : parseFloat(t);
          if (t === "top" || t === "bottom")
            return { x: vw / 2, y: (vh * p) / 100 };
          if (t === "left" || t === "right")
            return { x: (vw * p) / 100, y: vh / 2 };
          return { x: (vw * p) / 100, y: (vh * p) / 100 };
        }
        const yAxis = ["top", "bottom"];
        const [a, b] = yAxis.includes(tokens[0])
          ? [tokens[1], tokens[0]]
          : tokens;
        const px = a in kw ? kw[a] : parseFloat(a);
        const py = b in kw ? kw[b] : parseFloat(b);
        return { x: (vw * px) / 100, y: (vh * py) / 100 };
      }, origin);
    }
    return this._getElementCenter(page, origin);
  }

  /** Returns true if the string is a CSS position keyword or percentage. */
  private _isPositionValue(value: string): boolean {
    const token = "(top|bottom|left|right|center|\\d+%)";
    return new RegExp(`^${token}(\\s+${token})?$`, "i").test(value.trim());
  }

  /**
   * Scroll the element matching `target` into view if it lies outside the
   * visible viewport (accounting for `margin` px on each side). No-op when
   * the element is already fully visible.
   */
  private async _scrollIntoView(
    page: Page,
    target: string,
    margin: number,
    speed: number,
  ): Promise<void> {
    const handle = await this._get(page, target);
    const scrollY = await page.evaluate(
      (el, margin) => {
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const comfort = margin * 2;
        if (rect.top >= comfort && rect.bottom <= vh - comfort) return null;

        // Tall element: top-align with margin
        if (rect.height > vh - margin * 2)
          return window.scrollY + rect.top - margin;

        // Element extends below the bottom comfort zone: scroll just enough to
        // show it fully, rather than trying to centre it (which often overshoots
        // the page's max scroll and leaves the element at the viewport edge).
        if (rect.bottom > vh - margin)
          return window.scrollY + rect.bottom - (vh - margin);

        // Element extends above the top comfort zone: scroll to show top
        if (rect.top < margin) return window.scrollY + rect.top - margin;

        // In view but within the comfort band: centre it
        return window.scrollY + rect.top + rect.height / 2 - vh / 2;
      },
      handle,
      margin,
    );
    if (scrollY !== null) {
      const currentY = await page.evaluate(() => window.scrollY);
      const dist = Math.abs(scrollY - currentY);
      const duration = Math.max(200, (dist / speed) * 1000);
      await this._smoothScroll(page, scrollY, duration);
    }
  }

  private async _smoothScroll(
    page: Page,
    targetY: number,
    duration: number,
  ): Promise<void> {
    await page.evaluate(
      ({ targetY, duration }) => {
        return new Promise<void>((resolve) => {
          const startY = window.scrollY;
          const dist = targetY - startY;
          const steps = Math.ceil(duration / 16);
          let i = 0;
          const id = setInterval(() => {
            i++;
            const p = Math.min(i / steps, 1);
            const e =
              p < 0.5 ? 4 * p * p * p : (p - 1) * (2 * p - 2) * (2 * p - 2) + 1;
            window.scrollTo(0, startY + dist * e);
            if (p >= 1) {
              clearInterval(id);
              resolve();
            }
          }, 16);
        });
      },
      { targetY, duration },
    );
  }
}
