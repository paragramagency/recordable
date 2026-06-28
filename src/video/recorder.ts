import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Page, type CDPSession } from "puppeteer";
import {
  FFMPEG_PATH,
  getDuration,
  runFfmpeg,
  videoEncodeArgs,
} from "../ffmpeg.js";
import { RecordableError } from "../errors.js";
import { type Logger } from "../logger.js";
import { type InsertOptions, type ResolvedConfig } from "../config.js";
import { type Segment } from "./stitch.js";

// ─── Video layer: capture ────────────────────────────────────────────────────
//
// Captures the page via CDP `Page.startScreencast`, pipes JPEG frames into ffmpeg
// at a steady fps to produce one MP4 per captured stretch, and tracks the
// recorded-time clock the audio layer positions clips against. Stitching the
// segments into the final video lives in `./stitch.ts`.
//
// Segments are started lazily and ended on pause, so off-camera gaps (page loads,
// logins, data setup) leave no trace. Config is read through `getCfg` on each call
// so runtime changes take effect.
//
// Captured segments are partitioned into output files (ROADMAP §6): start/end/split
// open and close files; each captured/inserted segment lands in the file that's
// open at the time. The recorded-time clock runs continuously across files, so a
// file's global range `[startMs, startMs+durationMs)` lets the audio layer assign
// and rebase its clips.

/** One output file's captured + inserted segments, with its place on the global
 *  recorded-time line (so audio clips can be partitioned and rebased per file). */
export interface OutputFile {
  /** The `start`/`split` label, or null for an unlabelled / implicit file. */
  label: string | null;
  /** Segments in timeline order, for stitching. */
  segments: Segment[];
  /** Global recorded-time position (ms) where this file opened. */
  startMs: number;
  /** Recorded length (ms); set when the file closes. */
  durationMs: number;
}

/**
 * Recorded-time position now: finalised segment time plus the in-flight segment's
 * elapsed time (`frames / fps`). Off-camera (paused) stretches capture no frames,
 * so they never advance this clock — audio lands in recorded time.
 */
export function timelineMs(
  completedMs: number,
  segmentFrames: number,
  fps: number,
  capturing: boolean,
): number {
  const current = capturing && fps > 0 ? (segmentFrames / fps) * 1000 : 0;
  return completedMs + current;
}

export class Recorder {
  private tmpDirPath = "";
  // Output files, in timeline order, plus the one currently open (null in an
  // off-camera gap). Segments land in `current`; start/end/split manage the set.
  private files: OutputFile[] = [];
  private current: OutputFile | null = null;
  // Monotonic segment counter for unique temp filenames across all files.
  private segCount = 0;
  private currentSegment = "";
  private cdp: CDPSession | null = null;
  // The page `cdp` is attached to — a new tab needs a fresh session (per-target).
  private cdpPage: Page | null = null;
  private ffmpegProc: ChildProcess | null = null;
  private frameTicker: ReturnType<typeof setInterval> | null = null;
  private latestFrame: Buffer | null = null;
  private segmentFrames = 0;
  private segmentFps = 0;
  // A spawn/encode failure on the capture ffmpeg, surfaced at the next end().
  private captureError: Error | null = null;

  // Timeline clock (recorded time, ms) summed over finalised segments.
  private completedMs = 0;

  constructor(
    private readonly getCfg: () => ResolvedConfig,
    private readonly log: Logger,
  ) {}

  /** True while a segment is actively capturing frames. */
  get capturing(): boolean {
    return this.ffmpegProc !== null;
  }

  /** True while an output file is open (capturing or paused). */
  get fileOpen(): boolean {
    return this.current !== null;
  }

  /** The closed output files, in timeline order (for finalising). */
  get outputFiles(): readonly OutputFile[] {
    return this.files;
  }

  /** The temp working directory holding segment files. */
  get tmpDir(): string {
    return this.tmpDirPath;
  }

  /** Open a new output file at the current recorded-time position. Segments
   *  captured/inserted from here on land in it until `closeFile`. */
  openFile(label: string | null): void {
    if (this.current)
      throw new RecordableError(
        "CONFIG_INVALID",
        "openFile: a recording is already open",
      );
    this.current = {
      label,
      segments: [],
      startMs: this.completedMs,
      durationMs: 0,
    };
  }

  /** Seal the active segment and close the open file (recording its duration).
   *  An empty file (no captured frames) is still recorded so finalisation can
   *  report and skip it. No-op if no file is open. */
  async closeFile(): Promise<void> {
    await this.end(true); // seal the in-flight segment, no "pause" log
    if (!this.current) return;
    this.current.durationMs = this.completedMs - this.current.startMs;
    this.files.push(this.current);
    this.current = null;
  }

  /** Recorded-time position now: finalised segments + the in-flight segment. */
  currentTimelineMs(): number {
    const fps = this.segmentFps || this.getCfg().fps;
    return timelineMs(
      this.completedMs,
      this.segmentFrames,
      fps,
      this.capturing,
    );
  }

  /** Create the temp working directory for segment files. Call once before use. */
  init(): void {
    this.tmpDirPath = mkdtempSync(join(tmpdir(), "recordable-"));
  }

  /** The CDP session for screencast capture on `page`. A `CDPSession` is bound to one
   *  target, so a new tab (different page) gets a fresh session — the old one is
   *  detached. The single-tab path reuses the cached session (same page). */
  private async _ensureCdp(page: Page): Promise<CDPSession> {
    if (this.cdp && this.cdpPage === page) return this.cdp;
    if (this.cdp) {
      await this.cdp.detach().catch(() => {});
      this.cdp = null;
    }
    const cdp = await page.createCDPSession();
    cdp.on("Page.screencastFrame", (frame) => {
      this.latestFrame = Buffer.from(frame.data, "base64");
      cdp
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {});
    });
    this.cdp = cdp;
    this.cdpPage = page;
    return cdp;
  }

  /** Begin capturing into a fresh segment. No-op if already capturing. */
  async begin(page: Page): Promise<void> {
    if (this.ffmpegProc) return;
    const cfg = this.getCfg();
    const idx = this.segCount++;
    const file = join(
      this.tmpDirPath,
      `seg-${String(idx).padStart(3, "0")}.mp4`,
    );
    const { width, height } = cfg.viewport;
    const fps = cfg.fps;

    // Encode a stream of JPEG frames piped on stdin into an MP4 segment.
    const proc = spawn(
      FFMPEG_PATH,
      [
        "-y",
        "-f",
        "image2pipe",
        "-framerate",
        String(fps),
        "-i",
        "pipe:0",
        "-r",
        String(fps),
        ...videoEncodeArgs(cfg),
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2", // libx264 needs even dimensions
        file,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    proc.on("error", (e) => {
      // Encoding is async; remember the failure and surface it at end() rather
      // than silently dropping a frameless, invalid segment.
      this.captureError = e;
      this.log.error(`ffmpeg: ${String(e)}`);
    });
    this.ffmpegProc = proc;
    this.currentSegment = file;
    this.segmentFrames = 0;
    this.segmentFps = fps;
    this.latestFrame = null;

    // Begin the screencast and push the most recent frame at a steady fps so the
    // output is constant-frame-rate even when the page is idle.
    const cdp = await this._ensureCdp(page);
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: width,
      maxHeight: height,
      everyNthFrame: 1,
    });
    this.frameTicker = setInterval(
      () => {
        const p = this.ffmpegProc;
        if (!p || !p.stdin?.writable || !this.latestFrame) return;
        p.stdin.write(this.latestFrame);
        this.segmentFrames++;
      },
      Math.max(1, Math.round(1000 / fps)),
    );

    this.log("Record", idx === 0 ? "start" : `resume (segment ${idx + 1})`);
  }

  /** End the active segment, flushing ffmpeg and keeping it only if it has frames.
   *  Pass `silent` to skip the "pause" log (used by `insert`, which seals the
   *  current segment as an internal step rather than a user-visible pause). */
  async end(silent = false): Promise<void> {
    if (!this.ffmpegProc) return;
    if (this.frameTicker) {
      clearInterval(this.frameTicker);
      this.frameTicker = null;
    }
    await this.cdp?.send("Page.stopScreencast").catch(() => {});

    const proc = this.ffmpegProc;
    this.ffmpegProc = null;
    const frames = this.segmentFrames;

    // Flush stdin and wait for ffmpeg to finish writing the file.
    await new Promise<void>((resolve) => {
      proc.once("close", () => resolve());
      try {
        proc.stdin?.end();
      } catch {
        resolve();
      }
    });

    if (this.captureError) {
      const e = this.captureError;
      this.captureError = null;
      throw new RecordableError(
        "FFMPEG_FAILED",
        `recording capture failed: ${e.message}`,
        { cause: e },
      );
    }

    // Only keep segments that actually captured frames (avoids empty/invalid mp4).
    if (this.currentSegment && frames > 0 && this.current) {
      this.current.segments.push({
        path: this.currentSegment,
        fadeIn: 0,
        fadeOut: 0,
      });
      this.completedMs +=
        (frames / (this.segmentFps || this.getCfg().fps)) * 1000;
    }
    this.currentSegment = "";
    this.latestFrame = null;
    if (!silent) this.log("Record", "pause");
  }

  /**
   * Seal the active segment (silently), normalize the clip to the recording's
   * resolution / fps / codec / pixel format, and append it as the next segment.
   * Fades (ms) are recorded on the segment and applied at stitch time. Doesn't
   * touch recording *intent* — if capture was active the run loop lazily begins a
   * fresh segment before the next action, so recording resumes on its own.
   */
  async insert(path: string, options: InsertOptions = {}): Promise<void> {
    if (!existsSync(path))
      throw new RecordableError(
        "FILE_NOT_FOUND",
        `insert: file not found: ${path}`,
      );
    await this.end(true);
    if (!this.current)
      throw new RecordableError(
        "CONFIG_INVALID",
        "insert: no open recording — call start() first",
      );

    const cfg = this.getCfg();
    const idx = this.segCount++;
    const file = join(
      this.tmpDirPath,
      `seg-${String(idx).padStart(3, "0")}.mp4`,
    );
    const { width, height } = cfg.viewport;

    // Letterbox-fit to the viewport and conform fps/codec/pixel format so the clip
    // is concat-compatible with the captured segments.
    await runFfmpeg([
      "-y",
      "-i",
      path,
      "-an",
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${cfg.fps}`,
      ...videoEncodeArgs(cfg),
      "-pix_fmt",
      "yuv420p",
      file,
    ]);

    this.current.segments.push({
      path: file,
      fadeIn: Math.max(0, options.fadeIn ?? 0) / 1000,
      fadeOut: Math.max(0, options.fadeOut ?? 0) / 1000,
    });
    this.completedMs += (await getDuration(file)) * 1000;
  }

  /** Detach the CDP session. Call after the final segment is sealed. */
  async dispose(): Promise<void> {
    if (this.cdp) {
      await this.cdp.detach().catch(() => {});
      this.cdp = null;
    }
    this.cdpPage = null;
  }

  /** Remove the temp working directory. Call once the output is written. */
  removeTmp(): void {
    if (this.tmpDirPath)
      rmSync(this.tmpDirPath, { recursive: true, force: true });
  }
}
