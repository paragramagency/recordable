import { type Page, type GoToOptions } from "puppeteer";
import type {
  ClickOptions,
  ResolvedConfig,
  WaitForOptions,
} from "../config.js";
import { sleep, truncate } from "../utils.js";
import { resolveTarget } from "../targets.js";
import { type Logger } from "../logger.js";
import {
  getElementCenter,
  originToCoords,
  scrollIntoView,
  smoothScrollToTarget,
} from "./dom.js";
import { Cursor, type ZoomState } from "./cursor.js";
import { jitter, typingDuration, typingGaps, PRE_CLICK_MS } from "../timing.js";
import {
  playButtonScript,
  PLAY_BINDING,
  PLAY_BUTTON_ID,
} from "./play-button.js";

// ─── Compose layer: the runtime ──────────────────────────────────────────────
//
// *How* each action is performed on a live page — clicks, typing, scrolling,
// zooming, the cursor overlay, the resume gate. It owns the cursor and the zoom
// transform state (both per-page concerns); the builder enqueues calls to these
// methods, and the session drives them. No queue, no recorder, no recording flag
// here — purely page interaction.

export class Runtime {
  private readonly cursor = new Cursor();
  private zoom: ZoomState = { tx: 0, ty: 0, s: 1 };

  // Play-button bridge state (the resume gate).
  private playResolver: (() => void) | null = null;
  private playBindingExposed = false;

  constructor(
    private readonly getCfg: () => ResolvedConfig,
    private readonly log: Logger,
  ) {}

  /** The current zoom transform — the session re-reads it when re-injecting the
   *  cursor overlay across navigations. */
  get zoomState(): ZoomState {
    return this.zoom;
  }

  /** Drop any zoom transform (a fresh document carries none). */
  resetZoomState(): void {
    this.zoom = { tx: 0, ty: 0, s: 1 };
  }

  /** (Re-)inject the cursor overlay at the carried position, if enabled. */
  async injectCursor(page: Page): Promise<void> {
    if (this.getCfg().cursor) await this.cursor.inject(page, this.zoom);
  }

  /** Snapshot the cursor position (on pause) so a later resume() can restore it,
   *  ignoring any off-camera moves between pause and resume. */
  parkCursor(): void {
    this.cursor.park();
  }

  /** Re-inject the cursor at the parked position (on resume), so the resumed
   *  segment opens with the cursor exactly where the paused one left it. */
  async restoreCursor(page: Page): Promise<void> {
    if (this.getCfg().cursor) await this.cursor.unpark(page, this.zoom);
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  async visit(page: Page, url: string, options?: GoToOptions): Promise<void> {
    this.log("Visit", url);
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: this.getCfg().visitTimeout,
      ...options,
    });
    // A fresh document carries no zoom transform — drop any stale state so the
    // overlay (and later moves) position against the new page's viewport.
    this.resetZoomState();
    await this.injectCursor(page);
  }

  async waitFor(
    page: Page,
    target: string,
    options: WaitForOptions = {},
  ): Promise<void> {
    const { state = "visible", timeout = this.getCfg().visitTimeout } = options;
    this.log("WaitFor", `${target} (${state})`);
    await page.waitForSelector(resolveTarget(target), {
      timeout,
      visible: state === "visible",
      hidden: state === "hidden",
    });
    await this.injectCursor(page);
  }

  // ─── Interactions ──────────────────────────────────────────────────────────

  /** Click a target. Returns the new tab's `Page` when `followNewTab` is set and the
   *  click opened one — the session then switches recording to it. Otherwise void. */
  async click(
    page: Page,
    target: string,
    options: ClickOptions = {},
  ): Promise<Page | void> {
    this.log("Click", target);
    if (options.followNewTab) return this._clickNewTab(page, target, options);
    await this._click(page, target, options);
  }

  /**
   * Click a link that opens a new tab and resolve to the new `Page` (or warn and
   * return void if none appears). The popup listener is armed *before* the click so a
   * fast open can't be missed. The new tab is *not* waited on here — the session seals
   * the current segment first, then waits for the load off-camera so it's trimmed.
   */
  private async _clickNewTab(
    page: Page,
    target: string,
    options: ClickOptions,
  ): Promise<Page | void> {
    const timeout = options.timeout ?? this.getCfg().visitTimeout;
    const popup = this._waitForPopup(page, timeout);
    // The nav happens in the new tab, so don't wait for a same-tab navigation here.
    await this._click(page, target, { ...options, waitForNav: false });
    const newPage = await popup;
    if (!newPage) {
      this.log.warn(
        `click: no new tab opened for "${target}" — staying on the current tab`,
      );
      return;
    }
    return newPage;
  }

  /** Resolve to the next popup `page.once("popup")` opens, or null after `timeout`.
   *  A late timer after the popup resolves is a harmless no-op; unref it so it can't
   *  hold the process open. */
  private _waitForPopup(page: Page, timeout: number): Promise<Page | null> {
    return new Promise((resolve) => {
      const onPopup = (p: Page | null) => resolve(p ?? null);
      page.once("popup", onPopup);
      const timer = setTimeout(() => {
        page.off("popup", onPopup);
        resolve(null);
      }, timeout);
      timer.unref?.();
    });
  }

  async hover(page: Page, target: string): Promise<void> {
    this.log("Hover", target);
    if (this.getCfg().autoScroll) await this._scrollIntoView(page, target);
    const { x, y } = await getElementCenter(page, target);
    await this._moveTo(page, x, y);
  }

  async type(
    page: Page,
    target: string,
    text: string,
    options: { duration?: number } = {},
  ): Promise<void> {
    this.log("Type", `${target}  "${truncate(text)}"`);
    await this._click(page, target);
    const total =
      options.duration ?? typingDuration(text, this.getCfg().typingSpeed);
    const gaps = typingGaps(text, this.getCfg().typingSpeed, total);
    if (gaps.length === 0) return;
    await sleep(gaps[0]); // lead beat before the first keystroke
    let i = 1;
    for (const char of text) {
      await page.keyboard.type(char);
      await sleep(gaps[i++] ?? 0);
    }
  }

  async clear(page: Page, target: string): Promise<void> {
    this.log("Clear", target);
    await this._click(page, target);
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(mod);
    await page.keyboard.press("KeyA");
    await page.keyboard.up(mod);
    await page.keyboard.press("Backspace");
  }

  async select(page: Page, target: string, value: string): Promise<void> {
    this.log("Select", `${target}  ${value}`);
    if (this.getCfg().autoScroll) await this._scrollIntoView(page, target);
    const { x, y } = await getElementCenter(page, target);
    if (this.getCfg().cursor) {
      await this.cursor.moveTo(page, x, y, this.zoom);
      await sleep(jitter(PRE_CLICK_MS));
      await this.cursor.clickEffect(page);
    }
    await page.select(target, value);
  }

  async key(page: Page, key: string): Promise<void> {
    this.log("Key", key);
    await page.keyboard.press(key as Parameters<typeof page.keyboard.press>[0]);
  }

  async mouse(
    page: Page,
    target: string | { x: number; y: number },
  ): Promise<void> {
    const { x, y } =
      typeof target === "string"
        ? await getElementCenter(page, target)
        : target;
    this.log("Mouse", typeof target === "string" ? target : `(${x}, ${y})`);
    await this._moveTo(page, x, y);
  }

  // ─── Scrolling ─────────────────────────────────────────────────────────────

  async scroll(
    page: Page,
    target: string | number,
    options: { duration?: number } = {},
  ): Promise<void> {
    this.log("Scroll", String(target));
    await smoothScrollToTarget(
      page,
      target,
      options.duration ?? this.getCfg().scrollDuration,
    );
  }

  // ─── Zoom ──────────────────────────────────────────────────────────────────

  async zoomTo(
    page: Page,
    level: number,
    options: { origin?: string; duration?: number } = {},
  ): Promise<void> {
    const { origin = "center", duration } = options;
    this.log("Zoom", `${level}x  ${origin}`);
    const dur = duration ?? this.getCfg().zoomDuration;
    const { x, y } = await originToCoords(page, origin);

    // Express zoom as translate()+scale() on a 0,0 origin so that a single CSS
    // `transform` transition smoothly animates both level and origin.
    const tx = x * (1 - level);
    const ty = y * (1 - level);
    this.zoom = { tx, ty, s: level };

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
  }

  async resetZoom(
    page: Page,
    options: { duration?: number } = {},
  ): Promise<void> {
    this.log("Zoom", "reset");
    this.resetZoomState();
    const dur = options.duration ?? this.getCfg().zoomDuration;
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
  }

  // ─── Private interaction helpers ─────────────────────────────────────────────

  /** Click a target's centre. Uses page.mouse.click() not ElementHandle.click()
   *  to avoid Puppeteer's built-in scrollIntoView overriding our centred scroll. */
  private async _click(
    page: Page,
    target: string,
    options: ClickOptions = {},
  ): Promise<void> {
    if (this.getCfg().autoScroll) await this._scrollIntoView(page, target);
    const { x, y } = await getElementCenter(page, target);
    if (this.getCfg().cursor) {
      await this.cursor.moveTo(page, x, y, this.zoom);
      await sleep(jitter(PRE_CLICK_MS));
      await this.cursor.clickEffect(page);
    }
    await this._clickPoint(page, x, y, options);
  }

  /**
   * Click at viewport coords. By default the click returns immediately — clicks
   * don't wait for navigation. Pass `waitForNav: true` when the click triggers a
   * full-page navigation: the wait is armed *before* the click so a fast commit
   * can't be missed, and the navigation must land, so the click then behaves like
   * `visit()`. The network settle afterwards is best-effort, so a perpetually-busy
   * page can't fail an otherwise-successful navigation. SPA route changes are not
   * full-page navigations — gate those with a following `waitFor("<selector>")`.
   */
  private async _clickPoint(
    page: Page,
    x: number,
    y: number,
    options: ClickOptions = {},
  ): Promise<void> {
    if (!options.waitForNav) {
      await page.mouse.click(x, y);
      return;
    }

    const timeout = options.timeout ?? this.getCfg().visitTimeout;
    // waitUntil "load" always resolves on a real navigation (unlike networkidle,
    // which can stall on a busy page); arm it before the click so a fast commit
    // can't be missed, then settle the network best-effort.
    const navigated = page.waitForNavigation({ waitUntil: "load", timeout });
    await page.mouse.click(x, y);
    await navigated;
    await page.waitForNetworkIdle({ idleTime: 500, timeout }).catch(() => {});
  }

  /** Move to viewport coords, animating the overlay when the cursor is enabled. */
  private async _moveTo(page: Page, x: number, y: number): Promise<void> {
    if (this.getCfg().cursor) await this.cursor.moveTo(page, x, y, this.zoom);
    else await page.mouse.move(x, y);
  }

  /** Scroll a target into view using the configured margin/speed. */
  private _scrollIntoView(page: Page, target: string): Promise<void> {
    const cfg = this.getCfg();
    return scrollIntoView(page, target, cfg.scrollMargin, cfg.scrollSpeed);
  }

  // ─── Resume gate (▶ Play button) ─────────────────────────────────────────────

  /**
   * Block until the user resumes — by clicking the in-page ▶ Play button, or by
   * pressing Enter in the *terminal*. The in-page button is click-only so the live
   * page keeps its own keyboard (Enter to submit a form, etc.); the terminal
   * fallback means a resume is still reachable if the button fails to render.
   */
  async waitForPlay(page: Page, message: string): Promise<void> {
    let settle!: () => void;
    const played = new Promise<void>((resolve) => (settle = resolve));

    // Bridge page → Node: the button's click handler calls window[PLAY_BINDING],
    // which fires this exposed function. Exposed functions survive navigations, so
    // expose once and reuse across calls.
    this.playResolver = settle;
    if (!this.playBindingExposed) {
      await page.exposeFunction(PLAY_BINDING, () => this.playResolver?.());
      this.playBindingExposed = true;
    }

    // Terminal fallback: resume on Enter from stdin (TTY only). Works even if the
    // in-page button never renders.
    const stdin = process.stdin;
    const onStdin = (chunk: Buffer) => {
      if (chunk.includes(0x0a) || chunk.includes(0x0d)) settle();
    };
    const stdinFallback = Boolean(stdin.isTTY);
    if (stdinFallback) {
      stdin.resume();
      stdin.on("data", onStdin);
    }

    // Inject the button now, and on every future document so it survives the
    // navigations of a login flow. A failure here is non-fatal — the terminal
    // fallback still resumes — but surface it so a broken button is visible.
    const script = playButtonScript(message, PLAY_BUTTON_ID, PLAY_BINDING);
    const { identifier } = await page.evaluateOnNewDocument(script);
    await page
      .evaluate(script)
      .catch((e) =>
        this.log.warn(`could not inject ▶ Play button: ${String(e)}`),
      );

    this.log(
      "Resume",
      stdinFallback
        ? "waiting for ▶ Play (or press Enter here)…"
        : "waiting for ▶ Play…",
    );
    await played;

    // Clean up: stop the stdin listener, stop re-injecting, remove the button.
    this.playResolver = null;
    if (stdinFallback) {
      stdin.off("data", onStdin);
      stdin.pause();
    }
    await page.removeScriptToEvaluateOnNewDocument(identifier).catch(() => {});
    await page
      .evaluate((id) => document.getElementById(id)?.remove(), PLAY_BUTTON_ID)
      .catch(() => {});
  }
}
