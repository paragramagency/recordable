import puppeteer, { type Browser, type Page } from "puppeteer";
import { join } from "node:path";
import { statSync } from "node:fs";
import { sleep } from "../utils.js";
import { resolveOutputPaths } from "../fs.js";
import { type Logger } from "../logger.js";
import type { ResolvedConfig } from "../config.js";
import { RecordableError } from "../errors.js";
import { type Recorder, type OutputFile } from "../video/recorder.js";
import { stitch } from "../video/stitch.js";
import { type AudioTrack, partitionAudioByFiles } from "../audio/track.js";
import { addAudio } from "./mix.js";
import { type Runtime } from "../browser/runtime.js";
import { type QueueKind } from "./boundaries.js";
import { type RecordableResult, type RecordableFile } from "../result.js";
import {
  createZoomExtension,
  type ZoomExtension,
} from "../browser/page-zoom.js";

// ─── Compose layer: the session ──────────────────────────────────────────────
//
// Drives one run end-to-end: launch the browser, walk the queue (beginning a
// capture segment lazily before the first on-camera action), then seal the
// recording — stitch each output file's video, mix its audio onto it. Owns the
// browser + output lifecycle; reads the composed script and live config from the
// builder. Multi-file output (start/end/split) is finalised per file in
// `_finalize`; a plain top-to-bottom script is just the single-file case.

/** A same-tab navigation that trims its load off-camera: the action does its
 *  on-camera part, then hands back `offCamera` (the page-load wait). The session
 *  seals the current segment first, then runs it, so the dead time isn't captured
 *  — the same seal-then-load shape as `_switchTab`, minus the tab swap. */
export interface TrimNav {
  offCamera: () => Promise<void>;
}

/** Whether an action result is a {@link TrimNav} directive (vs. a `Page`/void). */
export function isTrimNav(result: Page | TrimNav | void): result is TrimNav {
  return result != null && typeof (result as TrimNav).offCamera === "function";
}

/** One queued action. `control` actions (pause/resume/insert/boundaries) run
 *  without forcing a capture segment to begin; `kind` tags the recording-control
 *  actions so the boundary state machine and finalisation can reason about them. */
export interface QueueItem {
  /** Returns a `Page` to switch the active tab to (a `followNewTab` click), a
   *  {@link TrimNav} directive to trim a same-tab navigation, or void — capture
   *  stays on the current tab. */
  run: (page: Page) => Promise<Page | TrimNav | void>;
  control: boolean;
  kind?: QueueKind;
}

/** What the session needs from the builder to execute a composed recording.
 *  `cfg` and `recording` are read live (the builder mutates them mid-run). */
export interface Composition {
  readonly queue: QueueItem[];
  readonly log: Logger;
  readonly recorder: Recorder;
  readonly audioTrack: AudioTrack;
  readonly runtime: Runtime;
  readonly cfg: ResolvedConfig;
  readonly recording: boolean;
}

export class Session {
  private browser: Browser | null = null;
  private zoomExt: ZoomExtension | null = null;
  private finalised = false;
  private startedAt = 0;
  private readonly warnings: string[] = [];
  private result: RecordableResult | null = null;

  constructor(private readonly comp: Composition) {}

  /** Execute the queued action sequence, then finalise the recording. Resolves to
   *  a {@link RecordableResult} on success; throws (browser/ffmpeg failure, or a
   *  script that can't run to completion) otherwise — so the result is the success
   *  path only and its `files` are always real. */
  async run(): Promise<RecordableResult> {
    const { log, recorder, runtime } = this.comp;
    log("Start", "recording…");
    this.startedAt = Date.now();
    recorder.init();

    const cfg = this.comp.cfg;
    // Browser page zoom (Ctrl +/−) ships as a bundled extension — the only
    // mechanism that reflows the painted window without splitting click coords
    // (see browser/page-zoom.ts). Needs a visible/extension-capable browser.
    if (cfg.pageZoom !== 1) this.zoomExt = createZoomExtension(cfg.pageZoom);
    try {
      this.browser = await puppeteer.launch({
        headless: cfg.headless,
        args: [
          `--window-size=${cfg.viewport.width},${cfg.viewport.height}`,
          ...(this.zoomExt?.args ?? []),
          // --lang sets the Chromium UI language; --accept-lang is what actually
          // drives navigator.language / navigator.languages (--lang alone leaves
          // them at the system locale, notably headless).
          ...(cfg.language
            ? [`--lang=${cfg.language}`, `--accept-lang=${cfg.language}`]
            : []),
          ...cfg.launchArgs,
        ],
      });
    } catch (err) {
      throw new RecordableError(
        "BROWSER_LAUNCH",
        `Could not launch Chromium: ${(err as Error).message}. ` +
          `In CI/containers add launchArgs: ["--no-sandbox"].`,
        { cause: err },
      );
    }

    let page = await this.browser.newPage();
    await this._setupPage(page, runtime, cfg);

    // Boundaries default to the script edges (ROADMAP §6): with no explicit
    // start() the first file is open from the top; otherwise the file opens
    // closed and the first start() opens it (content before runs off-camera).
    if (!this.comp.queue.some((i) => i.kind === "start"))
      recorder.openFile(null);

    // Finalise the recording and close the browser on SIGINT / SIGTERM.
    const onSignal = () => {
      log("Signal", "finalising recording…");
      this._cleanup().finally(() => process.exit(0));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    let caught: unknown = null;
    try {
      for (const item of this.comp.queue) {
        // Lazily begin a segment before the first capture-worthy action while
        // recording is intended *and* a file is open — keeps a leading pause()
        // (or an off-camera gap between end() and start()) from making a clip.
        if (
          !item.control &&
          this.comp.recording &&
          recorder.fileOpen &&
          !recorder.capturing
        ) {
          await recorder.begin(page);
        }
        const next = await item.run(page);
        if (isTrimNav(next)) {
          // A same-tab navigation: seal the segment (no-op if not capturing),
          // run the load off-camera, then let the next action lazily resume —
          // so the page-load dead time leaves no frames.
          await recorder.end(true);
          await next.offCamera();
        } else if (next && next !== page) {
          // A `followNewTab` click returns the tab it opened: seal the current
          // segment and switch capture to the new tab (the new active page).
          page = await this._switchTab(next, runtime, cfg, recorder);
        }
        if (this.comp.cfg.actionDelay > 0)
          await sleep(this.comp.cfg.actionDelay);
      }
    } catch (err) {
      caught = err;
      log.error(String(err));
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await this._cleanup();
      for (const f of this.result?.files ?? []) log("Output", f.path);
      // Bookends the "Start" line; green only when the run actually succeeded.
      if (!caught) log.success("Done", "recording complete");
    }

    // A run that couldn't complete throws — never a half-real result.
    if (caught) throw caught;
    return this.result as RecordableResult;
  }

  /** Prepare a page for capture: set the viewport, the `Accept-Language` header (when
   *  a `language` is configured), and (when the cursor is on) wire the per-page
   *  re-inject. A navigation wipes the in-page cursor overlay and any
   *  zoom transform, so re-inject (at the carried position) and reset zoom on every
   *  main-frame nav — click-triggered navigations stay covered without an explicit
   *  re-inject. Used for the first page and for each new tab `followNewTab` opens. */
  private async _setupPage(
    page: Page,
    runtime: Runtime,
    cfg: ResolvedConfig,
  ): Promise<void> {
    await page.setViewport({ ...cfg.viewport, deviceScaleFactor: 1 });
    // pageZoom (Ctrl +/−) is applied by the bundled extension, which re-zooms
    // every tab on create/navigate — nothing to arm per-page here.
    // Content-negotiation header, paired with the `--lang` launch flag. Persists
    // across navigations for the life of the page (and applies to each new tab too).
    if (cfg.language) {
      await page.setExtraHTTPHeaders({ "Accept-Language": cfg.language });
    }
    if (!cfg.cursor) return;
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      runtime.resetZoomState();
      // Only mask the real pointer while actually recording — a paused / off-camera
      // (no file open) step is driven by hand, so the `cursor: none` overlay stays off.
      if (!this.comp.recording || !this.comp.recorder.fileOpen) return;
      void runtime.injectCursor(page).catch(() => {});
    });
  }

  /** Switch capture to a new tab a `followNewTab` click opened. Seals the current
   *  segment (so the new tab's load is trimmed), prepares the new page, waits for it
   *  to settle off-camera, then re-injects the cursor. Recording resumes on its own:
   *  the run loop lazily begins a fresh segment before the next action. */
  private async _switchTab(
    newPage: Page,
    runtime: Runtime,
    cfg: ResolvedConfig,
    recorder: Recorder,
  ): Promise<Page> {
    await recorder.end(true); // seal segment on the old tab — no "pause" log
    await this._setupPage(newPage, runtime, cfg);
    await newPage.bringToFront().catch(() => {});
    // Let the new tab finish loading off-camera so the dead time isn't recorded.
    // Wait on document readiness (resolves at once if it already loaded — unlike
    // waitForNavigation, which would stall for the next nav that never comes) then
    // settle the network best-effort, both bounded so a busy tab can't hang the run.
    const timeout = cfg.visitTimeout;
    await newPage
      .waitForFunction(() => document.readyState === "complete", { timeout })
      .catch(() => {});
    await newPage
      .waitForNetworkIdle({ idleTime: 500, timeout })
      .catch(() => {});
    if (cfg.cursor) await runtime.injectCursor(newPage).catch(() => {});
    this.comp.log("Tab", "following new tab");
    return newPage;
  }

  private async _cleanup(): Promise<void> {
    await this._finalize();
    await this.comp.recorder.dispose();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.zoomExt?.cleanup();
    this.zoomExt = null;
  }

  /** Seal the recording: close any open file (implicit end at the bottom), then for
   *  each output file stitch its segments (video layer) and mix its slice of the
   *  audio track onto it (audio layer). Empty files are reported and skipped.
   *  Builds the {@link RecordableResult}. Idempotent — a signal handler and the
   *  normal path both call it. */
  private async _finalize(): Promise<void> {
    if (this.finalised) return;
    this.finalised = true;
    const { recorder, audioTrack, cfg, log } = this.comp;

    // Implicit end: close the file still open at the script's end (seals the
    // in-flight segment). A no-op when the script ended with an explicit end().
    if (recorder.fileOpen) await recorder.closeFile();

    const elapsedMs = Date.now() - this.startedAt;
    const files = recorder.outputFiles;

    // Drop files that captured no frames (e.g. start→end with nothing between),
    // warning each — they're never written.
    const kept: OutputFile[] = [];
    files.forEach((f, i) => {
      if (f.segments.length > 0) {
        kept.push(f);
        return;
      }
      const name = f.label ? `"${f.label}"` : `#${i + 1}`;
      const msg = `empty recording ${name} captured no frames — skipped`;
      this.warnings.push(msg);
      log("Record", msg);
    });

    if (kept.length === 0) {
      log("Record", "nothing was recorded — no output written");
      recorder.removeTmp();
      this.result = {
        status: "empty",
        files: [],
        outputDir: cfg.outputDir,
        durationMs: 0,
        elapsedMs,
        warnings: this.warnings,
      };
      return;
    }

    const paths = resolveOutputPaths(cfg, kept);
    const clipsByFile = partitionAudioByFiles(audioTrack.list(), kept);

    const resultFiles: RecordableFile[] = [];
    for (let i = 0; i < kept.length; i++) {
      const f = kept[i];
      const out = paths[i];
      const clips = clipsByFile[i];
      const needAudio = clips.length > 0;
      // With audio, render the silent video to a temp file then mix onto it;
      // otherwise stitch straight to the output.
      const videoOut = needAudio
        ? join(recorder.tmpDir, `video-${i}.mp4`)
        : out;
      await stitch(f.segments, cfg, log, videoOut, recorder.tmpDir);
      if (needAudio)
        this.warnings.push(...(await addAudio(videoOut, clips, out, log)));
      resultFiles.push({
        path: out,
        label: f.label,
        index: i + 1,
        durationMs: Math.round(f.durationMs),
        bytes: statSync(out).size,
      });
    }

    recorder.removeTmp();
    this.result = {
      status: "completed",
      files: resultFiles,
      outputDir: cfg.outputDir,
      durationMs: resultFiles.reduce((sum, f) => sum + f.durationMs, 0),
      elapsedMs,
      warnings: this.warnings,
    };
  }
}
