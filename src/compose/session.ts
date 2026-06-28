import puppeteer, { type Browser, type Page } from "puppeteer";
import { join } from "node:path";
import { sleep } from "../utils.js";
import { getOutputPath } from "../fs.js";
import { type Logger } from "../logger.js";
import type { ResolvedConfig } from "../config.js";
import { RecordableError } from "../errors.js";
import { type Recorder } from "../video/recorder.js";
import { stitch } from "../video/stitch.js";
import { type AudioTrack } from "../audio/track.js";
import { addAudio } from "./mix.js";
import { type Runtime } from "../browser/runtime.js";
import {
  createZoomExtension,
  type ZoomExtension,
} from "../browser/page-zoom.js";

// ─── Compose layer: the session ──────────────────────────────────────────────
//
// Drives one run end-to-end: launch the browser, walk the queue (beginning a
// capture segment lazily before the first on-camera action), then seal the
// recording — stitch the video, mix the audio onto it. Owns the browser + output
// lifecycle; reads the composed script and live config from the builder.

/** One queued action. `control` actions (pause/resume/insert) run without forcing a
 *  capture segment to begin. */
export interface QueueItem {
  /** Returns a `Page` to switch the active tab to (e.g. a `followNewTab` click),
   *  otherwise void — capture stays on the current tab. */
  run: (page: Page) => Promise<Page | void>;
  control: boolean;
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
  private outputPath = "";
  private finalised = false;

  constructor(private readonly comp: Composition) {}

  /** Execute the queued action sequence, then finalise the recording. */
  async run(): Promise<void> {
    const { log, recorder, runtime } = this.comp;
    log("Start", "recording…");
    let ok = true;
    this.outputPath = getOutputPath(this.comp.cfg);
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

    // Finalise the recording and close the browser on SIGINT / SIGTERM.
    const onSignal = () => {
      log("Signal", "finalising recording…");
      this._cleanup().finally(() => process.exit(0));
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    try {
      for (const item of this.comp.queue) {
        // Lazily begin a segment before the first capture-worthy action while
        // recording is intended — keeps a leading pause() from making an empty clip.
        if (!item.control && this.comp.recording && !recorder.capturing) {
          await recorder.begin(page);
        }
        // A `followNewTab` click returns the tab it opened: seal the current segment
        // and switch capture to the new tab (which becomes the active page).
        const next = await item.run(page);
        if (next && next !== page) {
          page = await this._switchTab(next, runtime, cfg, recorder);
        }
        if (this.comp.cfg.actionDelay > 0)
          await sleep(this.comp.cfg.actionDelay);
      }
    } catch (err) {
      ok = false;
      log.error(String(err));
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await this._cleanup();
      log("Output", this.outputPath);
      // Bookends the "Start" line; green only when the run actually succeeded.
      if (ok) log.success("Done", "recording complete");
    }
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
      // Only mask the real pointer while recording — a paused / wait-for-user
      // step is driven by hand, so the `cursor: none` overlay stays off.
      if (!this.comp.recording) return;
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

  /** Seal the recording: stitch the captured/inserted segments (video layer),
   *  then mix the audio track onto them (audio layer). The video defines the
   *  length. Idempotent — a signal handler and the normal path both call it. */
  private async _finalize(): Promise<void> {
    if (this.finalised) return;
    this.finalised = true;
    const { recorder, audioTrack, cfg, log } = this.comp;
    await recorder.end();

    const segs = recorder.segments;
    if (segs.length === 0) {
      log("Record", "nothing was recorded — no output written");
      recorder.removeTmp();
      return;
    }

    // With audio, render the silent video to a temp file then mix onto it;
    // otherwise stitch straight to the output.
    const needAudio = audioTrack.length > 0;
    const videoOut = needAudio
      ? join(recorder.tmpDir, "video.mp4")
      : this.outputPath;

    await stitch(segs, cfg, log, videoOut, recorder.tmpDir);
    if (needAudio)
      await addAudio(videoOut, audioTrack.list(), this.outputPath, log);

    recorder.removeTmp();
  }
}
