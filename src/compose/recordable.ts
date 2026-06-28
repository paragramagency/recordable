import { type Page, type GoToOptions } from "puppeteer";
import { isAbsolute, resolve } from "node:path";
import {
  DEFAULT_CONFIG,
  type AudioOptions,
  type ClickOptions,
  type InsertOptions,
  type RecordableConfig,
  type ResolvedConfig,
  type WaitForOptions,
} from "../config.js";
import { sleep, truncate } from "../utils.js";
import { createLogger, type Logger } from "../logger.js";
import { parseConfig } from "../validate.js";
import { Recorder } from "../video/recorder.js";
import { AudioTrack } from "../audio/track.js";
import { Runtime } from "../browser/runtime.js";
import { Session, type Composition, type QueueItem } from "./session.js";
import { buildArgs, validateAction, type Action } from "../actions.js";
import { resolveVisitUrls, splitScript, type Script } from "../script.js";
import { extractActions, parseMarkdown } from "../formats/markdown/parse.js";
import { RecordableError } from "../errors.js";

// ─── Compose layer: the builder ──────────────────────────────────────────────
//
// The public fluent API. Chain methods *describe* a recording by enqueuing
// actions; they perform no page work themselves — interaction is delegated to the
// Runtime, and execution to the Session at run(). Also owns config resolution and
// the declarative loaders (JSON / Markdown).

export class Recordable {
  private cfg: ResolvedConfig = { ...DEFAULT_CONFIG };
  // Constructor config — always wins over config from a loaded document
  // (frontmatter / script `config`), which layers underneath.
  private readonly userConfig: RecordableConfig;
  private readonly log: Logger = createLogger(() => this.cfg.silent);
  private readonly recorder = new Recorder(() => this.cfg, this.log);
  private readonly audioTrack = new AudioTrack();
  private readonly runtime = new Runtime(() => this.cfg, this.log);
  private queue: QueueItem[] = [];
  // Deferred load work (voiceover synthesis), run by run() — so `fromMarkdown`
  // stays synchronous and building a script never triggers synthesis.
  private pending: Array<() => Promise<void>> = [];

  // Recording state. `recording` is the *intent* (should we be capturing?); the
  // recorder starts segments lazily so a leading pause() never makes a clip.
  private recording = true;

  constructor(config: RecordableConfig = {}) {
    this.userConfig = parseConfig(config);
    this._applyContentConfig({}); // sets cfg = defaults < userConfig, resolving paths
  }

  // ─── Loaders ───────────────────────────────────────────────────────────────
  //
  // Turn declarative content into queued actions, between construction and run().

  /** Load a JSON script — an array of actions, a `{ config, actions }` object, or a
   *  raw JSON string — enqueuing each action. Returns `this` to chain into `.run()`. */
  fromJSON(script: Script | string): this {
    const parsed: Script =
      typeof script === "string" ? JSON.parse(script) : script;
    const { config, actions } = splitScript(parsed);
    if (!Array.isArray(actions))
      throw new RecordableError(
        "CONFIG_INVALID",
        "Script must be an array of actions, or { actions: [...] }",
      );
    this._applyContentConfig(config ?? {});
    this._loadActions(actions);
    return this;
  }

  /**
   * Load a Markdown document — synchronous and chainable. The `voiceover`
   * frontmatter key picks the path: present → synthesize narration + computed
   * waits (the add-on, dynamically imported so a no-audio run never loads TTS),
   * deferred to `run()`; absent → flatten markers to a plain chain now. Caller
   * reads the file (and loads any `.env`).
   */
  fromMarkdown(md: string): this {
    const parsed = parseMarkdown(md);
    this._applyContentConfig(parsed.config);

    if (!parsed.voiceover) {
      this._loadActions(extractActions(parsed.blocks));
      return this;
    }
    // Defer TTS to run(); remember where these actions belong in the queue.
    const insertAt = this.queue.length;
    this.pending.push(() => this._stageVoiceover(md, insertAt));
    return this;
  }

  /** Synthesize a voiceover document and splice its actions into the queue at the
   *  position `fromMarkdown` was called (so chaining order is preserved). */
  private async _stageVoiceover(md: string, insertAt: number): Promise<void> {
    // Pick up secrets (ELEVENLABS_API_KEY) from a .env beside the document.
    if (this.cfg.baseDir) {
      try {
        process.loadEnvFile(resolve(this.cfg.baseDir, ".env"));
      } catch {
        // No .env beside the document — fine, secrets may already be in the env.
      }
    }

    const { compileMarkdown } = await import("../voiceover/index.js");
    const compiled = await compileMarkdown(md, {
      assetsDir: this.cfg.assetsDir,
      configOverride: this.cfg,
      log: this.log,
    });
    this.cfg = { ...this.cfg, actionDelay: 0 }; // computed waits assume no inter-action delay

    // Build the compiled actions in isolation (the chain methods push to `queue`),
    // then splice them in. Safe: this runs during run()'s await, single-threaded.
    const saved = this.queue;
    this.queue = [];
    this._loadActions(compiled.actions);
    const items = this.queue;
    this.queue = saved;
    this.queue.splice(insertAt, 0, ...items);
  }

  /** Merge config mid-sequence — enqueued so it takes effect at this point. */
  setConfig(config: RecordableConfig): this {
    return this._enqueue(async () => {
      this.cfg = { ...this.cfg, ...parseConfig(config) };
    });
  }

  // ─── Recording control ───────────────────────────────────────────────────────
  //
  // Recording is ON from the top by default and finalises automatically when
  // run() ends — there is no start()/stop(). Use pause()/resume() to carve
  // off-camera gaps; every captured segment is stitched into one seamless MP4.

  /**
   * Stop capturing. The chain keeps running — anything between `pause()` and the
   * next resume executes off-camera (page loads, logins, data setup) and is
   * omitted from the final video. Place it first to skip the cold open.
   */
  pause(): this {
    return this._enqueue(async () => {
      this.recording = false;
      this.runtime.parkCursor(); // remember where the cursor is for resume()
      await this.recorder.end();
    }, true);
  }

  /** Resume capturing in a fresh segment, immediately. Restores the cursor to its
   *  pause() position (a manual step may have navigated away and wiped the overlay,
   *  or off-camera steps moved it). */
  resume(): this {
    return this._enqueue(async (page) => {
      this.recording = true;
      await this.recorder.begin(page);
      await this.runtime.restoreCursor(page);
    }, true);
  }

  /**
   * Block the chain until the user *plays* — clicks the in-page ▶ Play button (or
   * presses Enter in the terminal). Recording state is left untouched, so this is
   * just a gate: pair it with `resume()` to gate a resume, or use it standalone to
   * hold the script for a manual step that stays off-camera. The common
   * pause → sign-in-by-hand → resume flow is `resumeOnPlay()`.
   */
  waitForPlay(message = "Press ▶ Play to continue"): this {
    return this._enqueue(async (page) => {
      await this.runtime.waitForPlay(page, message);
    }, true);
  }

  /**
   * Resume capturing, but only once the user *plays*. Convenience wrapper for
   * `waitForPlay().resume()` — the usual manual flow: `pause()` first, do the
   * manual step by hand (headful), then `resumeOnPlay()`.
   */
  resumeOnPlay(message = "Press ▶ Play when you're ready to record"): this {
    this.waitForPlay(message);
    return this.resume();
  }

  /**
   * Splice an external video clip into the timeline at this point — first call =
   * intro, last = outro, anywhere between = mid-roll. The clip is normalized to
   * the recording's resolution / fps / codec so the join stays seamless.
   *
   * Pass `fadeIn` / `fadeOut` (ms) to cross-fade with the neighbouring footage
   * (or from/to black at the timeline ends). Omit them for a hard cut.
   * Auto-segments: no pause/resume needed.
   */
  insert(path: string, options: InsertOptions = {}): this {
    return this._enqueue(async () => {
      const file = this._resolveFile(path);
      this.log("Insert", file);
      await this.recorder.insert(file, options);
    }, true);
  }

  /**
   * Lay an existing audio file (mp3/wav) onto the timeline at this point —
   * narration, music bed, sound effect. Mixed onto the silent capture at
   * finalise, positioned by where this call lands in *recorded* time (off-camera
   * pauses excluded). By default the chain blocks until the clip finishes
   * (`{ wait: false }` to play it over following actions); `{ volume }` gains it.
   * Don't `pause()` mid-clip — paused time is dropped, desyncing the audio.
   */
  audio(path: string, options: AudioOptions = {}): this {
    return this._enqueue(async () => {
      const { wait = true, volume } = options;
      const file = this._resolveFile(path);
      // Pin the clip to where we are in recorded time (the video timeline), then
      // hand it to the audio layer to probe + collect for the final mix.
      const startMs = this.recorder.currentTimelineMs();
      const { durationMs } = await this.audioTrack.add(file, startMs, {
        volume,
      });
      this.log(
        "Audio",
        `${truncate(file)} @ ${Math.round(startMs)}ms (${Math.round(durationMs)}ms)`,
      );
      if (wait) await sleep(durationMs);
    });
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  /** Navigate to a URL and wait for the page to settle. */
  visit(url: string, options?: GoToOptions): this {
    return this._enqueue((page) => this.runtime.visit(page, url, options));
  }

  /**
   * Wait for an element to reach a given state before continuing. Useful for async
   * content, or as an automatic gate after a manual step. `target` accepts a CSS
   * selector or a `text:` prefix; see {@link WaitForOptions} for `state`/`timeout`.
   */
  waitFor(target: string, options: WaitForOptions = {}): this {
    return this._enqueue((page) => this.runtime.waitFor(page, target, options));
  }

  // ─── Interactions ──────────────────────────────────────────────────────────

  /**
   * Click an element. Accepts a CSS selector (`#id`, `.class`, `input[name="…"]`)
   * or a `text:` prefix (`"text:Next"`, matched by visible text). Pass
   * `{ waitForNav: true }` when the click triggers a full-page navigation; for SPA
   * route changes or async content, follow with `waitFor(...)`. Pass
   * `{ followNewTab: true }` to continue recording in a tab the click opens (the old
   * tab stays open, the load is trimmed). See {@link ClickOptions}.
   */
  click(target: string, options: ClickOptions = {}): this {
    return this._enqueue((page) => this.runtime.click(page, target, options));
  }

  /**
   * Move the mouse (and cursor overlay) onto an element without clicking, so any
   * `:hover` state — tooltips, dropdowns, menus — is revealed.
   */
  hover(target: string): this {
    return this._enqueue((page) => this.runtime.hover(page, target));
  }

  /**
   * Type into an element with human-like timing. Accepts a CSS selector or a
   * `text:` prefix. Timing is **jittered yet deterministic in total**: keystroke
   * delays vary but always sum to `typingDuration(text, speed)`, so the voiceover
   * compiler can predict this action's length. Pass `{ duration }` (ms) to
   * override that total.
   */
  type(
    target: string,
    text: string,
    options: { duration?: number } = {},
  ): this {
    return this._enqueue((page) =>
      this.runtime.type(page, target, text, options),
    );
  }

  /** Clear an input or textarea (select-all + delete). Handy before re-typing. */
  clear(target: string): this {
    return this._enqueue((page) => this.runtime.clear(page, target));
  }

  /**
   * Choose an option in a native `<select>`. `value` is the option's `value`
   * attribute by default, or a pseudo: `:option-index(N)` for the Nth option
   * (1-based, like `:nth-child`) or `:option-label(Text)` for its visible label.
   * The cursor animates to the control like `click()`. Note: the open option list
   * is OS-drawn, *outside* the page, so it can't be captured — build a custom
   * dropdown from `click()`s for an on-camera menu.
   */
  select(target: string, value: string): this {
    return this._enqueue((page) => this.runtime.select(page, target, value));
  }

  /** Press a keyboard key (e.g. "Escape", "Enter", "Tab"). */
  key(key: string): this {
    return this._enqueue((page) => this.runtime.key(page, key));
  }

  /**
   * Move the mouse (and cursor overlay) to a target or coordinates — a CSS
   * selector / plain text (element centre) or `{ x, y }` (viewport coords).
   */
  mouse(target: string | { x: number; y: number }): this {
    return this._enqueue((page) => this.runtime.mouse(page, target));
  }

  // ─── Scrolling ─────────────────────────────────────────────────────────────

  /**
   * Smooth-scroll to an element or position: `"top"`/`"bottom"`, a CSS selector or
   * plain text (centred), or a number (absolute Y). `duration` (ms) overrides the
   * default animation length. Pass `container` (a selector) to scroll *within* that
   * scroll container — `target` is then resolved against it (extremes, absolute
   * scrollTop, or a child centred in the container) instead of the window.
   */
  scroll(
    target: string | number,
    options: { container?: string; duration?: number } = {},
  ): this {
    return this._enqueue((page) => this.runtime.scroll(page, target, options));
  }

  // ─── Zoom ──────────────────────────────────────────────────────────────────

  /**
   * Smoothly scale the viewport to `level` from a transform origin. Calling zoom()
   * again while zoomed transitions both scale and origin at once — no reset needed.
   * `origin` accepts position keywords, percentages, a CSS selector, or `text:`.
   * `duration` overrides `zoomDuration` for this call.
   */
  zoom(
    level: number,
    options: { origin?: string; duration?: number } = {},
  ): this {
    return this._enqueue((page) => this.runtime.zoomTo(page, level, options));
  }

  /** Smoothly reset zoom back to 1. */
  resetZoom(options: { duration?: number } = {}): this {
    return this._enqueue((page) => this.runtime.resetZoom(page, options));
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

    // Expose just what the session needs; cfg/recording are read live via arrow
    // getters (this instance mutates them as control actions run).
    const comp = {
      queue: this.queue,
      log: this.log,
      recorder: this.recorder,
      audioTrack: this.audioTrack,
      runtime: this.runtime,
    } as Composition;
    Object.defineProperty(comp, "cfg", {
      get: () => this.cfg,
      enumerable: true,
    });
    Object.defineProperty(comp, "recording", {
      get: () => this.recording,
      enumerable: true,
    });

    await new Session(comp).run();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /** Resolve a local asset path (insert/audio clip) against `baseDir` so a
   *  Markdown/JSON script and its clips travel together; absolute paths pass
   *  through. `baseDir` empty → resolve against cwd (the programmatic default). */
  private _resolveFile(path: string): string {
    return isAbsolute(path) ? path : resolve(this.cfg.baseDir, path);
  }

  private _enqueue(
    run: (page: Page) => Promise<Page | void>,
    control = false,
  ): this {
    this.queue.push({ run, control });
    return this;
  }

  /** Recompute `cfg` as defaults < content config < constructor config, then
   *  resolve a relative `outputDir`/`assetsDir` against `baseDir`. */
  private _applyContentConfig(content: RecordableConfig): void {
    this.cfg = {
      ...DEFAULT_CONFIG,
      ...parseConfig(content),
      ...this.userConfig,
    };
    const base = this.cfg.baseDir;
    if (base) {
      if (!isAbsolute(this.cfg.outputDir))
        this.cfg.outputDir = resolve(base, this.cfg.outputDir);
      if (!isAbsolute(this.cfg.assetsDir))
        this.cfg.assetsDir = resolve(base, this.cfg.assetsDir);
    }
  }

  /** Validate each action against the manifest and enqueue it by calling its method
   *  (relative `visit` URLs resolve against `baseDir` first). */
  private _loadActions(actions: Action[]): void {
    resolveVisitUrls(actions, this.cfg.baseDir);
    actions.forEach((step, i) => {
      const where = `step ${i} (${step?.action ?? "?"})`;
      if (!step || typeof step !== "object")
        throw new RecordableError("CONFIG_INVALID", `${where}: not an object`);
      try {
        validateAction(step);
      } catch (err) {
        throw new RecordableError(
          "CONFIG_INVALID",
          `${where}: ${(err as Error).message}`,
          { cause: err },
        );
      }
      (this as unknown as Record<string, (...a: unknown[]) => unknown>)[
        step.action
      ](...buildArgs(step, step.action));
    });
  }
}
