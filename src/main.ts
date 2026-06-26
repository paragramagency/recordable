import puppeteer, {
  type Browser,
  type Page,
  type GoToOptions,
} from "puppeteer";
import {
  DEFAULT_CONFIG,
  type AudioOptions,
  type InsertOptions,
  type RecordableConfig,
  type ResolvedConfig,
  type WaitForOptions,
} from "./config.js";
import {
  createLogger,
  getOutputPath,
  jitter,
  resolveTarget,
  sleep,
  truncate,
  typeDelay,
  type LogFn,
} from "./utils.js";
import {
  getElementCenter,
  originToCoords,
  scrollIntoView,
  smoothScrollToTarget,
} from "./dom.js";
import { Cursor, type ZoomState } from "./cursor.js";
import { SegmentRecorder } from "./recorder.js";
import {
  injectPlayButton,
  PLAY_BINDING,
  PLAY_BUTTON_ID,
} from "./play-button.js";
import { isAbsolute, resolve } from "node:path";
import {
  buildArgs,
  resolveVisitUrls,
  splitScript,
  validateStep,
  type Param,
  type Script,
  type ScriptStep,
} from "./script.js";
import { flattenBlocks, parseMarkdown } from "./markdown/parse.js";

// ─── Class ───────────────────────────────────────────────────────────────────

type Action = (page: Page) => Promise<void>;

export class Recordable {
  private cfg: ResolvedConfig = { ...DEFAULT_CONFIG };
  // The explicit config passed to the constructor — always wins over config that
  // comes from a loaded document (frontmatter / script `config`), which layers
  // underneath it.
  private readonly userConfig: RecordableConfig;
  private readonly log: LogFn = createLogger(() => this.cfg.silent);
  private readonly recorder = new SegmentRecorder(() => this.cfg, this.log);
  private readonly cursor = new Cursor();
  private queue: { run: Action; control: boolean }[] = [];
  // Async load work (voiceover synthesis) deferred from a builder call to run(),
  // so `fromMarkdown` stays a synchronous, chainable step. Stored as thunks and
  // only invoked by run(), so building a script never triggers synthesis.
  private pending: Array<() => Promise<void>> = [];
  private browser: Browser | null = null;
  private zoomState: ZoomState = { tx: 0, ty: 0, s: 1 };
  private outputPath = "";

  // Recording state. `recording` is the *intent* (should we be capturing?);
  // the recorder starts segments lazily so a leading pause() never makes a clip.
  private recording = true;

  // Play-button bridge state.
  private playResolver: (() => void) | null = null;
  private playBindingExposed = false;

  constructor(config: RecordableConfig = {}) {
    this.userConfig = config;
    this._applyContentConfig({}); // sets cfg = defaults < userConfig, resolving paths
  }

  // ─── Loaders ───────────────────────────────────────────────────────────────
  //
  // `fromJSON` / `fromMarkdown` turn declarative content into queued steps on
  // *this* instance, sitting between construction and run():
  //
  //   await new Recordable({ baseDir }).fromMarkdown(md); await rec.run();
  //
  // Config from the content (a script's `config`, a document's frontmatter)
  // layers *under* the constructor config, so what you pass explicitly wins.

  /** Load a JSON script — an array of steps, a `{ config, steps }` object, or a
   *  raw JSON string — enqueuing each step. Returns `this` to chain into `.run()`. */
  fromJSON(script: Script | string): this {
    const parsed: Script = typeof script === "string" ? JSON.parse(script) : script;
    const { config, steps } = splitScript(parsed);
    if (!Array.isArray(steps)) throw new Error("Script must be an array of steps, or { steps: [...] }");
    this._applyContentConfig(config ?? {});
    this._loadSteps(steps);
    return this;
  }

  /**
   * Load a Markdown document's contents — a synchronous, chainable builder step
   * (`new Recordable(cfg).fromMarkdown(md).run()`). The `voiceover` frontmatter
   * key decides the path: present → synthesize narration audio + computed waits
   * (the add-on, dynamically imported so a no-audio run never loads TTS) written
   * to `config.assetsDir`; absent → flatten markers to a plain chain. Synthesis
   * is async, so it's **deferred to `run()`**; everything else (config, frontmatter
   * parsing) happens now. Relative `visit`/`outputDir`/`assetsDir` resolve against
   * `config.baseDir`. The caller reads the file (and loads any `.env`).
   */
  fromMarkdown(md: string): this {
    const parsed = parseMarkdown(md);
    this._applyContentConfig(parsed.config);

    if (!parsed.voiceover) {
      this._loadSteps(flattenBlocks(parsed.blocks));
      return this;
    }
    // Defer TTS to run(); remember where these steps belong in the queue.
    const insertAt = this.queue.length;
    this.pending.push(() => this._stageVoiceover(md, insertAt));
    return this;
  }

  /** Synthesize a voiceover document and splice its steps into the queue at the
   *  position `fromMarkdown` was called (so chaining order is preserved). */
  private async _stageVoiceover(md: string, insertAt: number): Promise<void> {
    // Pick up secrets (ELEVENLABS_API_KEY) from a .env beside the document.
    if (this.cfg.baseDir) {
      try {
        process.loadEnvFile(resolve(this.cfg.baseDir, ".env")); // no-op if absent
      } catch {}
    }

    const { compileMarkdown } = await import("./voiceover/index.js");
    const compiled = await compileMarkdown(md, { assetsDir: this.cfg.assetsDir, configOverride: this.cfg });
    this.cfg = { ...this.cfg, actionDelay: 0 }; // computed waits assume no inter-action delay

    // Build the compiled steps in isolation (the chain methods push to `queue`),
    // then splice them in. Safe: this runs during run()'s await, single-threaded.
    const saved = this.queue;
    this.queue = [];
    this._loadSteps(compiled.steps);
    const items = this.queue;
    this.queue = saved;
    this.queue.splice(insertAt, 0, ...items);
  }

  /** Merge additional config options at runtime. Enqueue as an action so it takes effect at the right point in the sequence. */
  setConfig(config: RecordableConfig): this {
    return this._enqueue(async () => {
      this.cfg = { ...this.cfg, ...config };
    });
  }

  // ─── Recording ─────────────────────────────────────────────────────────────
  //
  // Recording is ON from the top by default and finalises automatically when
  // run() ends — there is no start()/stop(). Use pause()/resume() to carve
  // off-camera gaps; every captured segment is stitched into one seamless MP4.

  /**
   * Stop capturing. The chain keeps running — anything between `pause()` and the
   * next resume executes off-camera (page loads, logins, data setup, screen
   * changes) and is omitted from the final video.
   *
   * Place it first to skip the cold open: `pause().visit(url).resume()…`.
   */
  pause(): this {
    return this._enqueue(async () => {
      this.recording = false;
      await this.recorder.end();
    }, true);
  }

  /** Resume capturing in a fresh segment, immediately. */
  resume(): this {
    return this._enqueue(async (page) => {
      this.recording = true;
      await this.recorder.begin(page);
    }, true);
  }

  /**
   * Resume capturing, but only once the user *plays* — clicks the in-page ▶ Play
   * button. Use for manual steps such as a login: `pause()` first, do the
   * sign-in by hand (headful), then `resumeOnInput()`.
   *
   * The button is injected into the page itself and re-injected across
   * navigations, so it survives login redirects. Requires a headful window for
   * the user to click in.
   */
  resumeOnInput(message = "Press ▶ Play when you're ready to record"): this {
    return this._enqueue(async (page) => {
      await this._waitForPlay(page, message);
      this.recording = true;
      await this.recorder.begin(page);
      // The page may have navigated during the manual step — re-inject cursor.
      if (this.cfg.cursor) await this.cursor.inject(page);
    }, true);
  }

  /**
   * Splice an external video clip into the timeline at this point — first call =
   * intro, last = outro, anywhere between = mid-roll. The clip is normalized to
   * the recording's resolution / fps / codec so the join stays seamless.
   *
   * Pass `fadeIn` / `fadeOut` (ms) to cross-fade: the clip dissolves to/from the
   * neighbouring recorded footage, or fades from/to black at the timeline ends
   * (e.g. an intro's `fadeIn`, an outro's `fadeOut`). Omit them for a hard cut.
   *
   * Auto-segments: no pause/resume needed. The current segment is sealed and, if
   * recording was active, the next action transparently starts a fresh one.
   */
  insert(path: string, options: InsertOptions = {}): this {
    return this._enqueue(async () => {
      this.log("Insert", path);
      await this.recorder.insert(path, options);
    }, true);
  }

  /**
   * Lay an audio clip onto the recording timeline at this point — narration, a
   * music bed, a sound effect. Plays an *existing* file (your own mp3/wav); it
   * is muxed onto the silent capture at finalise, positioned by where this call
   * lands in *recorded* time (off-camera pauses excluded).
   *
   * By default the chain blocks until the clip finishes (`{ wait: false }` to
   * let it play over following actions, e.g. voiceover). `{ volume }` gains it.
   * Don't `pause()` mid-clip — paused time is dropped, desyncing the audio.
   */
  audio(path: string, options: AudioOptions = {}): this {
    return this._enqueue(async () => {
      const { wait = true, volume } = options;
      const { startMs, durationMs } = await this.recorder.addAudio(path, { volume });
      this.log("Audio", `${truncate(path)} @ ${Math.round(startMs)}ms (${Math.round(durationMs)}ms)`);
      if (wait) await sleep(durationMs);
    });
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  /** Navigate to a URL and wait for the page to settle. */
  visit(url: string, options?: GoToOptions): this {
    return this._enqueue(async (page) => {
      this.log("Visit", url);
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.cfg.visitTimeout,
        ...options,
      });
      if (this.cfg.cursor) await this.cursor.inject(page);
    });
  }

  /**
   * Wait for an element to reach a given state before continuing. Useful for
   * async content, or as an automatic gate after a manual step.
   *
   * `target` accepts a CSS selector or a `text:` prefix (matched by visible text).
   * See {@link WaitForOptions} for `state`/`timeout`.
   */
  waitFor(target: string, options: WaitForOptions = {}): this {
    return this._enqueue(async (page) => {
      const { state = "visible", timeout = this.cfg.visitTimeout } = options;
      this.log("WaitFor", `${target} (${state})`);
      await page.waitForSelector(resolveTarget(target), {
        timeout,
        visible: state === "visible",
        hidden: state === "hidden",
      });
      if (this.cfg.cursor) await this.cursor.inject(page);
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
      this.log("Click", target);
      await this._click(page, target);
    });
  }

  /**
   * Move the mouse (and cursor overlay) onto an element without clicking, so any
   * `:hover` state — tooltips, dropdowns, menus — is revealed.
   */
  hover(target: string): this {
    return this._enqueue(async (page) => {
      this.log("Hover", target);
      if (this.cfg.autoScroll) await this._scrollIntoView(page, target);
      const { x, y } = await getElementCenter(page, target);
      await this._moveTo(page, x, y);
    });
  }

  /**
   * Type into an element with human-like timing. Accepts:
   * - CSS selector → `#id`, `input[name="field[0]"]`, `.class`, or any valid selector
   * - `text:` prefix → `"text:Label"` matches by visible text
   *
   * Pass `{ duration }` (ms) to type **deterministically**: the keystrokes are
   * spread evenly across exactly that long, with no jitter. The compiler uses
   * this to make `type` fill a known narration window predictably.
   */
  type(target: string, text: string, options: { duration?: number } = {}): this {
    return this._enqueue(async (page) => {
      this.log("Type", `${target}  "${truncate(text)}"`);
      await this._click(page, target);
      const { duration } = options;
      if (duration != null) {
        // Deterministic: even spacing, no pre-type jitter, exact total duration.
        const per = text.length ? duration / text.length : 0;
        for (const char of text) {
          await page.keyboard.type(char);
          await sleep(per);
        }
        return;
      }
      await sleep(jitter(150));
      for (const char of text) {
        await page.keyboard.type(char);
        await sleep(typeDelay(char, this.cfg.typingSpeed));
      }
    });
  }

  /**
   * Clear the contents of an input or textarea (select-all + delete). Handy
   * before re-typing into a pre-filled field.
   */
  clear(target: string): this {
    return this._enqueue(async (page) => {
      this.log("Clear", target);
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
      this.log("Select", `${target}  [${values.join(", ")}]`);
      if (this.cfg.autoScroll) await this._scrollIntoView(page, target);
      await page.select(target, ...values);
    });
  }

  /** Press a keyboard key (e.g. "Escape", "Enter", "Tab"). */
  key(key: string): this {
    return this._enqueue(async (page) => {
      this.log("Key", key);
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
      const { x, y } =
        typeof target === "string"
          ? await getElementCenter(page, target)
          : target;
      this.log("Mouse", typeof target === "string" ? target : `(${x}, ${y})`);
      await this._moveTo(page, x, y);
    });
  }

  // ─── Scrolling ─────────────────────────────────────────────────────────────

  /**
   * Smooth-scroll to an element or position. Accepts:
   * - `"top"` / `"bottom"` → scroll to the very top or bottom of the page
   * - CSS selector or plain text → element is centred in the viewport
   * - number → absolute Y pixel position
   *
   * `duration` (ms) overrides the default scroll animation length.
   */
  scroll(target: string | number, options: { duration?: number } = {}): this {
    return this._enqueue(async (page) => {
      this.log("Scroll", String(target));
      await smoothScrollToTarget(page, target, options.duration ?? 1200);
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
  zoom(level: number, options: { origin?: string; duration?: number } = {}): this {
    return this._enqueue(async (page) => {
      const { origin = "center", duration } = options;
      this.log("Zoom", `${level}x  ${origin}`);
      const dur = duration ?? this.cfg.zoomDuration;
      const { x, y } = await originToCoords(page, origin);

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
  resetZoom(options: { duration?: number } = {}): this {
    return this._enqueue(async (page) => {
      this.log("Zoom", "reset");
      this.zoomState = { tx: 0, ty: 0, s: 1 };
      const dur = options.duration ?? this.cfg.zoomDuration;
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
      this.log("Wait", `${ms}ms`);
      await sleep(ms);
    });
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  /** Execute the queued action sequence, then finalise the recording. */
  async run(): Promise<void> {
    // Finish any deferred load work (voiceover synthesis) before recording.
    for (const job of this.pending) await job();
    this.pending = [];
    this.outputPath = getOutputPath(this.cfg);
    this.recorder.init();
    this.browser = await puppeteer.launch({
      headless: this.cfg.headless,
      args: [
        `--window-size=${this.cfg.viewport.width},${this.cfg.viewport.height}`,
      ],
    });

    const page = await this.browser.newPage();
    await page.setViewport({ ...this.cfg.viewport, deviceScaleFactor: 1 });

    // Finalise the recording and close the browser on SIGINT / SIGTERM.
    const onSignal = () => {
      this.log("Signal", "finalising recording…");
      this._cleanup().finally(() => process.exit(0));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    try {
      for (const item of this.queue) {
        // Lazily begin a segment before the first capture-worthy action while
        // recording is intended — keeps a leading pause() from making an empty clip.
        if (!item.control && this.recording && !this.recorder.capturing) {
          await this.recorder.begin(page);
        }
        await item.run(page);
        if (this.cfg.actionDelay > 0) await sleep(this.cfg.actionDelay);
      }
    } catch (err) {
      this.log("Error", String(err));
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await this._cleanup();
      this.log("Output", this.outputPath);
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private async _cleanup(): Promise<void> {
    await this.recorder.finalise(this.outputPath);
    await this.recorder.dispose();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  /** Click at a target's centre: autoScroll → cursor move + press → coordinate click.
   *  Uses page.mouse.click() rather than ElementHandle.click() to avoid Puppeteer's built-in
   *  scrollIntoView, which would override our centred scroll position. */
  private async _click(page: Page, target: string): Promise<void> {
    if (this.cfg.autoScroll) await this._scrollIntoView(page, target);
    const { x, y } = await getElementCenter(page, target);
    if (this.cfg.cursor) {
      await this.cursor.moveTo(page, x, y, this.zoomState);
      await sleep(jitter(100));
      await this.cursor.clickEffect(page);
    }
    await page.mouse.click(x, y);
  }

  /** Move to viewport coords, animating the overlay when the cursor is enabled. */
  private async _moveTo(page: Page, x: number, y: number): Promise<void> {
    if (this.cfg.cursor) await this.cursor.moveTo(page, x, y, this.zoomState);
    else await page.mouse.move(x, y);
  }

  /** Scroll a target into view using the configured margin/speed. */
  private _scrollIntoView(page: Page, target: string): Promise<void> {
    return scrollIntoView(
      page,
      target,
      this.cfg.scrollMargin,
      this.cfg.scrollSpeed,
    );
  }

  private _enqueue(action: Action, control = false): this {
    this.queue.push({ run: action, control });
    return this;
  }

  /** Recompute `cfg` as defaults < content config < constructor config, then
   *  resolve a relative `outputDir`/`assetsDir` against `baseDir`. */
  private _applyContentConfig(content: RecordableConfig): void {
    this.cfg = { ...DEFAULT_CONFIG, ...content, ...this.userConfig };
    const base = this.cfg.baseDir;
    if (base) {
      if (!isAbsolute(this.cfg.outputDir)) this.cfg.outputDir = resolve(base, this.cfg.outputDir);
      if (!isAbsolute(this.cfg.assetsDir)) this.cfg.assetsDir = resolve(base, this.cfg.assetsDir);
    }
  }

  /** Validate each step against the manifest and enqueue it by calling its method
   *  (relative `visit` URLs resolve against `baseDir` first). */
  private _loadSteps(steps: ScriptStep[]): void {
    resolveVisitUrls(steps, this.cfg.baseDir);
    steps.forEach((step, i) => {
      const where = `step ${i} (${step?.action ?? "?"})`;
      if (!step || typeof step !== "object") throw new Error(`${where}: not an object`);
      let params: readonly Param[];
      try {
        params = validateStep(step);
      } catch (err) {
        throw new Error(`${where}: ${(err as Error).message}`);
      }
      (this as unknown as Record<string, (...a: unknown[]) => unknown>)[step.action](
        ...buildArgs(step, params),
      );
    });
  }

  // ── Play-button gate ──

  /** Block until the user clicks the in-page ▶ Play button or presses Enter. */
  private async _waitForPlay(page: Page, message: string): Promise<void> {
    let settle!: () => void;
    const played = new Promise<void>((resolve) => (settle = resolve));

    // Bridge page → Node: the button's click handler calls window[PLAY_BINDING],
    // which fires this exposed function. Exposed functions survive navigations,
    // so expose once and reuse across calls.
    this.playResolver = settle;
    if (!this.playBindingExposed) {
      await page.exposeFunction(PLAY_BINDING, () => this.playResolver?.());
      this.playBindingExposed = true;
    }

    // Inject the button now, and on every future document so it survives the
    // navigations of a login flow.
    const { identifier } = await page.evaluateOnNewDocument(
      injectPlayButton,
      message,
      PLAY_BUTTON_ID,
      PLAY_BINDING,
    );
    await page
      .evaluate(injectPlayButton, message, PLAY_BUTTON_ID, PLAY_BINDING)
      .catch(() => {});

    this.log("Resume", "waiting for ▶ Play…");
    await played;

    // Clean up: stop re-injecting, remove the button.
    this.playResolver = null;
    await page.removeScriptToEvaluateOnNewDocument(identifier).catch(() => {});
    await page
      .evaluate((id) => document.getElementById(id)?.remove(), PLAY_BUTTON_ID)
      .catch(() => {});
  }
}
