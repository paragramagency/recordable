import { type Page, type GoToOptions } from "puppeteer";
import { isAbsolute, resolve } from "node:path";
import {
  DEFAULT_CONFIG,
  type AudioOptions,
  type ClickOptions,
  type InsertOptions,
  type RecordableConfig,
  type RecordableInput,
  type ResolvedConfig,
  type VoiceoverConfig,
  type WaitForOptions,
} from "../config.js";
import { sleep, truncate } from "../utils.js";
import { createLogger, type Logger } from "../logger.js";
import { parseConfig, parseVariables } from "../validate.js";
import { discoverConfig, type DiscoveredConfig } from "../config-file.js";
import {
  substitute,
  VariableStore,
  type VariableResolver,
} from "../variables.js";
import { Recorder } from "../video/recorder.js";
import { AudioTrack } from "../audio/track.js";
import { Runtime } from "../browser/runtime.js";
import {
  Session,
  type Composition,
  type QueueItem,
  type TrimNav,
} from "./session.js";
import { validateBoundaries, type QueueKind } from "./boundaries.js";
import { buildArgs, validateAction, type Action } from "../actions.js";
import { resolveVisitUrls, splitScript, type Script } from "../script.js";
import { extractActions, parseMarkdown } from "../formats/markdown/parse.js";
import { RecordableError } from "../errors.js";
import { type RecordableResult } from "../result.js";

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
  // Discovery overrides from the constructor (CLI `--config` / `--env-file`).
  private readonly configFile?: string;
  private readonly envFile?: string;
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

  // ─── Variables ──────────────────────────────────────────────────────────────
  // The layered variable map (env < config file < document < programmatic). Only
  // the programmatic layer mutates as the chain advances. `activeResolver` lets a
  // deferred (voiceover) load substitute against a snapshot taken when its
  // `fromMarkdown` was called, instead of the live store.
  private readonly vars = new VariableStore();
  private activeResolver?: VariableResolver;
  // The file-discovery result (config + variables + voiceover), computed once.
  private discovered?: DiscoveredConfig;
  // Voiceover defaults from `recordable.config.json` (frontmatter overrides them).
  private voiceoverDefaults: VoiceoverConfig = {};
  // Whether the one-time "Config sources —" line has been emitted.
  private sourcesLogged = false;

  constructor(input: RecordableInput = {}) {
    const { variables, configFile, envFile, ...config } = input;
    this.userConfig = parseConfig(config);
    this.configFile = configFile;
    this.envFile = envFile;
    if (variables)
      this.vars.addProgrammatic(parseVariables(variables), "constructor");
    this._applyContentConfig({}); // sets cfg = defaults < files < userConfig
  }

  // ─── Loaders ───────────────────────────────────────────────────────────────
  //
  // Turn declarative content into queued actions, between construction and run().

  /** Load a JSON script — an array of actions, a `{ config, actions }` object, or a
   *  raw JSON string — enqueuing each action. Returns `this` to chain into `.run()`. */
  fromJSON(script: Script | string): this {
    const parsed: Script =
      typeof script === "string" ? JSON.parse(script) : script;
    const { config, variables, actions } = splitScript(parsed);
    if (!Array.isArray(actions))
      throw new RecordableError(
        "CONFIG_INVALID",
        "Script must be an array of actions, or { actions: [...] }",
      );
    this._applyContentConfig(config ?? {});
    if (variables)
      this.vars.addDocument(parseVariables(variables), "JSON variables");
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
    const parsed = parseMarkdown(md, this.cfg.baseDir);
    this._applyContentConfig(parsed.config);
    if (parsed.variables)
      this.vars.addDocument(parsed.variables, "frontmatter variables");

    if (!parsed.voiceover) {
      this._loadActions(extractActions(parsed.blocks));
      return this;
    }
    // Defer TTS to run(); remember where these actions belong in the queue. Snap
    // the variable view *now* so a later `.variable()` can't retroactively touch
    // this document's narration or actions (chain order is preserved).
    const insertAt = this.queue.length;
    const snapshot = this.vars.snapshot();
    this.pending.push(() => this._stageVoiceover(md, insertAt, snapshot));
    return this;
  }

  /** Synthesize a voiceover document and splice its actions into the queue at the
   *  position `fromMarkdown` was called (so chaining order is preserved). Both
   *  narration and action args resolve against `snapshot` — the variable view as
   *  it stood when `fromMarkdown` ran. */
  private async _stageVoiceover(
    md: string,
    insertAt: number,
    snapshot: VariableResolver,
  ): Promise<void> {
    const { compileMarkdown } = await import("../voiceover/index.js");
    const compiled = await compileMarkdown(md, {
      assetsDir: this.cfg.assetsDir,
      baseDir: this.cfg.baseDir,
      configOverride: this.cfg,
      voiceoverDefaults: this.voiceoverDefaults,
      interpolate: (s) => substitute(s, snapshot),
      log: this.log,
    });
    this.cfg = { ...this.cfg, actionDelay: 0 }; // computed waits assume no inter-action delay

    // Build the compiled actions in isolation (the chain methods push to `queue`),
    // then splice them in. Safe: this runs during run()'s await, single-threaded.
    // Action args substitute against the same snapshot, via `activeResolver`.
    const saved = this.queue;
    const prevResolver = this.activeResolver;
    this.queue = [];
    this.activeResolver = snapshot;
    try {
      this._loadActions(compiled.actions);
    } finally {
      this.activeResolver = prevResolver;
    }
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

  /** The fully-resolved config for this recording — defaults < `.env`
   *  (`DEFAULT_*`) < document config (frontmatter / JSON `config`) < explicit
   *  constructor / CLI config, with `outputDir`/`assetsDir` resolved against
   *  `baseDir`. Returns a fresh snapshot: mutating it has no effect. */
  getConfig(): ResolvedConfig {
    return structuredClone(this.cfg);
  }

  // ─── Variables ───────────────────────────────────────────────────────────────
  //
  // Reusable `{{ name }}` values, resolved by immediate substitution as each
  // action is enqueued. These feed the top-priority programmatic layer and take
  // effect *from this point on*: a mid-chain `.variable()` touches only later
  // actions, never steps already enqueued (or a voiceover document already
  // staged). Names are case- and separator-insensitive.

  /** Merge a map of variables into the programmatic layer (highest precedence). */
  variables(vars: Record<string, string>): this {
    this.vars.addProgrammatic(parseVariables(vars), ".variables()");
    return this;
  }

  /** Set a single variable in the programmatic layer (highest precedence). */
  variable(name: string, value: string): this {
    this.vars.setProgrammatic(name, String(value), ".variable()");
    return this;
  }

  // ─── Recording control ───────────────────────────────────────────────────────
  //
  // Two axes (ROADMAP §6). pause()/resume() carve off-camera gaps *within* one
  // output file — the gap is stitched out, the clip stays continuous.
  // start()/end()/split() move the *file* boundaries, producing separate files.
  // Boundaries default to the script edges: with neither, recording runs ON from
  // the top and finalises into one MP4 at run() end — add only the bookend you need.

  /**
   * Open an output file (the opening boundary). Content *before* the first
   * `start()` runs off-camera; absent, recording opens at the top. Pass an
   * optional `name` to label the file (`start("intro")` → `…-intro.mp4`).
   * Pair with `end()`, or leave it to close implicitly at the bottom.
   */
  start(name?: string): this {
    const n = this._substOpt(name);
    return this._enqueue(
      async () => {
        this.recorder.openFile(n ?? null);
      },
      true,
      "start",
    );
  }

  /**
   * Close the current output file (the closing boundary). Content *after* `end()`
   * runs off-camera (cleanup is common, so no warning); absent, recording closes
   * at the bottom. Open another file with `start()` for a second output.
   */
  end(): this {
    return this._enqueue(
      async () => {
        await this.recorder.closeFile();
      },
      true,
      "end",
    );
  }

  /**
   * Split the output here: close the current file and open the next in one move,
   * camera still rolling (`split() ≡ end() + start()` fused, no gap). Pass an
   * optional `name` to label the new file. For two files with an off-camera gap
   * between them, use `end()` … `start()` instead.
   */
  split(name?: string): this {
    const n = this._substOpt(name);
    return this._enqueue(
      async (page) => {
        await this.recorder.closeFile();
        this.recorder.openFile(n ?? null);
        // Keep rolling: begin the next file's first segment now (no off-camera gap).
        if (this.recording) await this.recorder.begin(page);
      },
      true,
      "split",
    );
  }

  /**
   * Stop capturing. The chain keeps running — anything between `pause()` and the
   * next resume executes off-camera (page loads, logins, data setup) and is
   * omitted from the final video. Place it first to skip the cold open.
   */
  pause(): this {
    return this._enqueue(
      async () => {
        this.recording = false;
        this.runtime.parkCursor(); // remember where the cursor is for resume()
        await this.recorder.end();
      },
      true,
      "pause",
    );
  }

  /** Resume capturing in a fresh segment, immediately. Restores the cursor to its
   *  pause() position (a manual step may have navigated away and wiped the overlay,
   *  or off-camera steps moved it). */
  resume(): this {
    return this._enqueue(
      async (page) => {
        this.recording = true;
        await this.recorder.begin(page);
        await this.runtime.restoreCursor(page);
      },
      true,
      "resume",
    );
  }

  /**
   * Block the chain until the user *plays* — clicks the in-page ▶ Play button (or
   * presses Enter in the terminal). Recording state is left untouched, so this is
   * just a gate: pair it with `resume()` to gate a resume, or use it standalone to
   * hold the script for a manual step that stays off-camera. The common
   * pause → sign-in-by-hand → resume flow is `resumeOnPlay()`.
   */
  waitForPlay(message = "Press ▶ Play to continue"): this {
    const msg = this._subst(message);
    return this._enqueue(async (page) => {
      await this.runtime.waitForPlay(page, msg);
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
    const p = this._subst(path);
    return this._enqueue(
      async () => {
        const file = this._resolveFile(p);
        this.log("Insert", file);
        await this.recorder.insert(file, options);
      },
      true,
      "insert",
    );
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
    const p = this._subst(path);
    return this._enqueue(
      async () => {
        const { wait = true, volume } = options;
        const file = this._resolveFile(p);
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
      },
      false,
      "audio",
    );
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  /** Navigate to a URL and wait for the page to settle. */
  visit(url: string, options?: GoToOptions): this {
    const u = this._subst(url);
    return this._enqueue((page) => this.runtime.visit(page, u, options));
  }

  /**
   * Wait for an element to reach a given state before continuing. Useful for async
   * content, or as an automatic gate after a manual step. `target` accepts a CSS
   * selector or a `text:` prefix; see {@link WaitForOptions} for `state`/`timeout`.
   */
  waitFor(target: string, options: WaitForOptions = {}): this {
    const t = this._subst(target);
    return this._enqueue((page) => this.runtime.waitFor(page, t, options));
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
    const t = this._subst(target);
    return this._enqueue((page) => this.runtime.click(page, t, options));
  }

  /**
   * Move the mouse (and cursor overlay) onto an element without clicking, so any
   * `:hover` state — tooltips, dropdowns, menus — is revealed.
   */
  hover(target: string): this {
    const t = this._subst(target);
    return this._enqueue((page) => this.runtime.hover(page, t));
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
    const t = this._subst(target);
    const txt = this._subst(text);
    return this._enqueue((page) => this.runtime.type(page, t, txt, options));
  }

  /** Clear an input or textarea (select-all + delete). Handy before re-typing. */
  clear(target: string): this {
    const t = this._subst(target);
    return this._enqueue((page) => this.runtime.clear(page, t));
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
    const t = this._subst(target);
    const v = this._subst(value);
    return this._enqueue((page) => this.runtime.select(page, t, v));
  }

  /** Press a keyboard key (e.g. "Escape", "Enter", "Tab"). */
  key(key: string): this {
    const k = this._subst(key);
    return this._enqueue((page) => this.runtime.key(page, k));
  }

  /**
   * Move the mouse (and cursor overlay) to a target or coordinates — a CSS
   * selector / plain text (element centre) or `{ x, y }` (viewport coords).
   */
  mouse(target: string | { x: number; y: number }): this {
    const t = typeof target === "string" ? this._subst(target) : target;
    return this._enqueue((page) => this.runtime.mouse(page, t));
  }

  // ─── Scrolling ─────────────────────────────────────────────────────────────

  /**
   * Smooth-scroll to an element or position. Vertically by default:
   * `"top"`/`"bottom"`, a CSS selector or plain text (centred), or a number
   * (absolute offset). `"left"`/`"right"` scroll horizontally; for a number or
   * selector pass `axis: "x"` to scroll horizontally instead of vertically.
   * `duration` (ms) overrides the default animation length. Pass `container` (a
   * selector) to scroll *within* that scroll container — `target` is then resolved
   * against it (extremes, absolute offset, or a child centred in the container)
   * instead of the window.
   */
  scroll(
    target: string | number,
    options: { container?: string; duration?: number; axis?: "x" | "y" } = {},
  ): this {
    const t = typeof target === "string" ? this._subst(target) : target;
    const opts = { ...options, container: this._substOpt(options.container) };
    return this._enqueue((page) => this.runtime.scroll(page, t, opts));
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
    const opts = { ...options, origin: this._substOpt(options.origin) };
    return this._enqueue((page) => this.runtime.zoomTo(page, level, opts));
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

  /** Execute the queued action sequence, then finalise the recording. Resolves to
   *  a {@link RecordableResult} describing the written file(s). */
  async run(): Promise<RecordableResult> {
    // Finish any deferred load work (voiceover synthesis) before recording.
    for (const job of this.pending) await job();
    this.pending = [];

    // Validate the recording-control state machine up front (ROADMAP §6), so an
    // illegal start/end/split/pause sequence fails before the browser launches.
    validateBoundaries(
      this.queue
        .map((i) => i.kind)
        .filter((k): k is QueueKind => k !== undefined),
    );

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

    return new Session(comp).run();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /** Resolve a local asset path (insert/audio clip) against `baseDir` so a
   *  Markdown/JSON script and its clips travel together; absolute paths pass
   *  through. `baseDir` empty → resolve against cwd (the programmatic default). */
  private _resolveFile(path: string): string {
    return isAbsolute(path) ? path : resolve(this.cfg.baseDir, path);
  }

  private _enqueue(
    run: (page: Page) => Promise<Page | TrimNav | void>,
    control = false,
    kind?: QueueKind,
  ): this {
    this.queue.push({ run, control, kind });
    return this;
  }

  /** Recompute `cfg` as defaults < config-file < content config < constructor
   *  config, then resolve a relative `outputDir`/`assetsDir` against `baseDir`. */
  private _applyContentConfig(content: RecordableConfig): void {
    const discovered = this._ensureDiscovered(content.baseDir);
    this.cfg = {
      ...DEFAULT_CONFIG,
      ...discovered.config, // recordable.config.json cascade (baseDir → cwd)
      ...parseConfig(content), // document config (frontmatter / JSON `config`)
      ...this.userConfig, // explicit constructor / CLI config
    };
    const base = this.cfg.baseDir;
    if (base) {
      if (!isAbsolute(this.cfg.outputDir))
        this.cfg.outputDir = resolve(base, this.cfg.outputDir);
      if (!isAbsolute(this.cfg.assetsDir))
        this.cfg.assetsDir = resolve(base, this.cfg.assetsDir);
    }
    // Report where files resolved from, once, after `cfg` (and `silent`) is set.
    if (!this.sourcesLogged) {
      this.sourcesLogged = true;
      if (discovered.sources.length)
        this.log("Config", `sources — ${discovered.sources.join("; ")}`);
    }
  }

  /** Run file discovery once (config + variables + `.env`), seeding the env and
   *  config-file variable layers and the voiceover defaults. `baseDir` is the
   *  walk's deepest dir (constructor wins, else the content's); `cwd` is the
   *  ceiling. Cached — the first call fixes `baseDir`, matching the old
   *  load-`.env`-once behaviour. */
  private _ensureDiscovered(contentBaseDir?: string): DiscoveredConfig {
    if (this.discovered) return this.discovered;
    const baseDir = this.userConfig.baseDir ?? contentBaseDir ?? "";
    const discovered = discoverConfig({
      baseDir,
      configPath: this.configFile,
      envFile: this.envFile,
    });
    this.discovered = discovered;
    this.vars.setEnv(discovered.envVariables);
    this.vars.setConfigFile(discovered.variables);
    this.voiceoverDefaults = discovered.voiceover;
    return discovered;
  }

  /** Interpolate `{{ name }}` in an action string arg against the current
   *  resolver (the live store, or a deferred load's snapshot). A missing variable
   *  throws here — eagerly, at enqueue. */
  private _subst(value: string): string {
    return substitute(value, this.activeResolver ?? this.vars);
  }

  /** Optional-string variant for trailing options (e.g. `origin`, `container`). */
  private _substOpt<T extends string | undefined>(value: T): T {
    return (value === undefined ? value : this._subst(value)) as T;
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
