import puppeteer, { type Browser, type Page } from "puppeteer";
import { join } from "node:path";
import { getOutputPath, sleep, type Logger } from "../utils.js";
import type { ResolvedConfig } from "../config.js";
import { RecordableError } from "../errors.js";
import { type Recorder } from "../video/recorder.js";
import { stitch } from "../video/stitch.js";
import { type AudioTrack } from "../audio/track.js";
import { addAudio } from "../audio/mix.js";
import { type Runtime } from "./runtime.js";

// ─── Compose layer: the session ──────────────────────────────────────────────
//
// Drives one run end-to-end: launch the browser, walk the queue (beginning a
// capture segment lazily before the first on-camera action), then seal the
// recording — stitch the video, mix the audio onto it. Owns the browser + output
// lifecycle; reads the composed script and live config from the builder.

/** One queued action. `control` steps (pause/resume/insert) run without forcing a
 *  capture segment to begin. */
export interface QueueItem {
  run: (page: Page) => Promise<void>;
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
    try {
      this.browser = await puppeteer.launch({
        headless: cfg.headless,
        args: [
          `--window-size=${cfg.viewport.width},${cfg.viewport.height}`,
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

    const page = await this.browser.newPage();
    await page.setViewport({ ...cfg.viewport, deviceScaleFactor: 1 });

    // A navigation wipes the in-page cursor overlay and any zoom transform.
    // Re-inject (at the carried position) and reset zoom on every main-frame nav,
    // so click-triggered navigations stay covered without an explicit re-inject.
    if (cfg.cursor) {
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        runtime.resetZoomState();
        // Only mask the real pointer while recording — a paused / wait-for-user
        // step is driven by hand, so the `cursor: none` overlay stays off.
        if (!this.comp.recording) return;
        void runtime.injectCursor(page).catch(() => {});
      });
    }

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
        await item.run(page);
        if (this.comp.cfg.actionDelay > 0) await sleep(this.comp.cfg.actionDelay);
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

  private async _cleanup(): Promise<void> {
    await this._finalize();
    await this.comp.recorder.dispose();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
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
