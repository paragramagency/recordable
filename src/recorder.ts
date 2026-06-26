import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Page, type CDPSession } from "puppeteer";
import { FFMPEG_PATH, probeDuration, runFfmpeg } from "./ffmpeg.js";
import { moveFile, type Logger } from "./utils.js";
import { type InsertOptions, type ResolvedConfig } from "./config.js";
import { audioFilterGraph, audioOverruns, timelineMs } from "./mux.js";

/**
 * One piece of the final timeline: a captured stretch or an inserted clip.
 * `fadeIn`/`fadeOut` (seconds) are non-zero only for inserted clips and request
 * a cross-fade with the neighbouring piece (or with black at the timeline ends).
 */
interface Segment {
  path: string;
  fadeIn: number;
  fadeOut: number;
}

/**
 * One audio clip laid onto the recording timeline. `startMs` is the clip's
 * position measured in *recorded* time (off-camera gaps excluded), captured at
 * the moment `audio()` ran; `durationMs` is its probed length. Muxed in at
 * {@link finalise}.
 */
interface AudioClip {
  path: string;
  startMs: number;
  durationMs: number;
  volume?: number;
}

/**
 * The in-house recorder. Captures the page via CDP `Page.startScreencast`,
 * pipes JPEG frames into ffmpeg at a steady fps to produce one MP4 per captured
 * stretch, then stitches the segments into a single seamless output.
 *
 * Segments are started lazily and ended on pause, so off-camera gaps (page
 * loads, logins, data setup) leave no trace in the final video. Config is read
 * through `getCfg` on each call so runtime changes take effect.
 */
export class SegmentRecorder {
  private tmpDir = "";
  private segments: Segment[] = [];
  private currentSegment = "";
  private finalised = false;
  private cdp: CDPSession | null = null;
  private ffmpegProc: ChildProcess | null = null;
  private frameTicker: ReturnType<typeof setInterval> | null = null;
  private latestFrame: Buffer | null = null;
  private segmentFrames = 0;
  private segmentFps = 0;

  // Timeline clock (recorded time, ms) summed over finalised segments, plus the
  // audio clips laid against it. Together these place audio on the final video.
  private completedMs = 0;
  private audioTrack: AudioClip[] = [];

  constructor(
    private readonly getCfg: () => ResolvedConfig,
    private readonly log: Logger,
  ) {}

  /** True while a segment is actively capturing frames. */
  get capturing(): boolean {
    return this.ffmpegProc !== null;
  }

  /** Create the temp working directory for segment files. Call once before use. */
  init(): void {
    this.tmpDir = mkdtempSync(join(tmpdir(), "recordable-"));
  }

  /** Lazily create the CDP session used for screencast capture. */
  private async _ensureCdp(page: Page): Promise<CDPSession> {
    if (this.cdp) return this.cdp;
    const cdp = await page.createCDPSession();
    cdp.on("Page.screencastFrame", (frame) => {
      this.latestFrame = Buffer.from(frame.data, "base64");
      cdp
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {});
    });
    this.cdp = cdp;
    return cdp;
  }

  /** Begin capturing into a fresh segment. No-op if already capturing. */
  async begin(page: Page): Promise<void> {
    if (this.ffmpegProc) return;
    const cfg = this.getCfg();
    const idx = this.segments.length;
    const file = join(this.tmpDir, `seg-${String(idx).padStart(3, "0")}.mp4`);
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
        "-c:v",
        cfg.videoCodec,
        "-preset",
        cfg.videoPreset,
        "-crf",
        String(cfg.videoCrf),
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2", // libx264 needs even dimensions
        file,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    proc.on("error", (e) => this.log.error(`ffmpeg: ${String(e)}`));
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

    // Only keep segments that actually captured frames (avoids empty/invalid mp4).
    if (this.currentSegment && frames > 0) {
      this.segments.push({ path: this.currentSegment, fadeIn: 0, fadeOut: 0 });
      this.completedMs +=
        (frames / (this.segmentFps || this.getCfg().fps)) * 1000;
    }
    this.currentSegment = "";
    this.latestFrame = null;
    if (!silent) this.log("Record", "pause");
  }

  /**
   * Splice an external video into the timeline at the current position. Seals
   * the active segment (silently), normalizes the clip to the recording's
   * resolution / fps / codec / pixel format, and appends it as the next
   * segment — first call = intro, last = outro, anywhere between = mid-roll.
   *
   * `options.fadeIn` / `options.fadeOut` (ms) request a cross-fade with the
   * neighbouring recorded segment — or a fade from/to black at the timeline
   * ends — applied at finalise (see {@link _assemble}). Omit them for a hard cut.
   *
   * Does not touch the recording *intent*: if capture was active, the run loop
   * lazily begins a fresh segment before the next action, so recording resumes
   * automatically with no pause/resume needed. Audio is dropped (recorded
   * segments are silent).
   */
  async insert(path: string, options: InsertOptions = {}): Promise<void> {
    if (!existsSync(path)) throw new Error(`insert: file not found: ${path}`);
    await this.end(true);

    const cfg = this.getCfg();
    const idx = this.segments.length;
    const file = join(this.tmpDir, `seg-${String(idx).padStart(3, "0")}.mp4`);
    const { width, height } = cfg.viewport;

    // Letterbox-fit to the viewport and conform fps/codec/pixel format so the
    // clip is concat-compatible with the captured segments.
    await runFfmpeg([
      "-y",
      "-i",
      path,
      "-an",
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${cfg.fps}`,
      "-c:v",
      cfg.videoCodec,
      "-preset",
      cfg.videoPreset,
      "-crf",
      String(cfg.videoCrf),
      "-pix_fmt",
      "yuv420p",
      file,
    ]);

    this.segments.push({
      path: file,
      fadeIn: Math.max(0, options.fadeIn ?? 0) / 1000,
      fadeOut: Math.max(0, options.fadeOut ?? 0) / 1000,
    });
    this.completedMs += (await probeDuration(file)) * 1000;
  }

  /**
   * Lay an audio clip onto the timeline at the current recorded position. The
   * file is muxed in at {@link finalise}; nothing is sounded during capture
   * (recorded frames are silent). Returns the clip's `startMs`/`durationMs` so
   * the caller can block for its duration when `audio({ wait: true })`.
   *
   * Note: don't `pause()` mid-clip — paused time is dropped from the video, so
   * the audio (placed in recorded time) would desync.
   */
  async addAudio(
    path: string,
    options: { volume?: number } = {},
  ): Promise<{ startMs: number; durationMs: number }> {
    if (!existsSync(path)) throw new Error(`audio: file not found: ${path}`);
    const startMs = this._currentTimelineMs();
    const durationMs = (await probeDuration(path)) * 1000;
    this.audioTrack.push({ path, startMs, durationMs, volume: options.volume });
    return { startMs, durationMs };
  }

  /** Recorded-time position now: finalised segments + the in-flight segment. */
  private _currentTimelineMs(): number {
    const fps = this.segmentFps || this.getCfg().fps;
    return timelineMs(
      this.completedMs,
      this.segmentFrames,
      fps,
      this.capturing,
    );
  }

  /** Stop the active segment, stitch all segments into `outputPath`, clean up temp. */
  async finalise(outputPath: string): Promise<void> {
    if (this.finalised) return;
    this.finalised = true;
    await this.end();

    const segs = this.segments;
    if (segs.length === 0) {
      this.log("Record", "nothing was recorded — no output written");
      if (this.tmpDir) rmSync(this.tmpDir, { recursive: true, force: true });
      return;
    }

    // When there's an audio track, render the (silent) video to a temp file
    // first, then mux audio onto it; otherwise render straight to the output.
    const muxAudio = this.audioTrack.length > 0;
    const videoOut = muxAudio ? join(this.tmpDir, "video.mp4") : outputPath;

    const hasFades = segs.some((s) => s.fadeIn > 0 || s.fadeOut > 0);
    if (hasFades) {
      // Cross-fades can't be stream-copied; assemble with a filter graph.
      await this._assemble(segs, videoOut);
    } else if (segs.length === 1) {
      moveFile(segs[0].path, videoOut);
    } else {
      await this._concat(segs, videoOut);
    }

    if (muxAudio) await this._mux(videoOut, outputPath);

    if (this.tmpDir) rmSync(this.tmpDir, { recursive: true, force: true });
  }

  /** Detach the CDP session. Call after `finalise`. */
  async dispose(): Promise<void> {
    if (this.cdp) {
      await this.cdp.detach().catch(() => {});
      this.cdp = null;
    }
  }

  /** Concatenate segments into one file. Stream-copies (lossless, fast) when the
   *  segments are compatible; falls back to a re-encode if they aren't. */
  private async _concat(segments: Segment[], out: string): Promise<void> {
    const cfg = this.getCfg();
    const listFile = join(this.tmpDir, "concat.txt");
    const list = segments
      .map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`)
      .join("\n");
    writeFileSync(listFile, list + "\n");
    const base = ["-y", "-f", "concat", "-safe", "0", "-i", listFile];
    try {
      await runFfmpeg([...base, "-c", "copy", out]);
      this.log("Record", `joined ${segments.length} segments`);
    } catch {
      await runFfmpeg([
        ...base,
        "-c:v",
        cfg.videoCodec,
        "-preset",
        cfg.videoPreset,
        "-crf",
        String(cfg.videoCrf),
        out,
      ]);
      this.log("Record", `joined ${segments.length} segments (re-encoded)`);
    }
  }

  /**
   * Stitch segments into one file with cross-fade transitions. Builds a single
   * `filter_complex` that, walking left to right, `xfade`s across every
   * cross-fade boundary and `concat`s across hard cuts, then fades from/to black
   * at the very ends when the edge clip asked for it.
   *
   * A cross-fade of duration `d` *overlaps* the two pieces by `d` (the outgoing
   * tail dissolves into the incoming head), so the timeline shortens by `d` at
   * each such boundary — tracked in `accDur` to place the next `xfade` offset.
   * Re-encodes throughout, since xfade can't stream-copy.
   */
  private async _assemble(segs: Segment[], out: string): Promise<void> {
    const cfg = this.getCfg();
    const n = segs.length;
    const dur = await Promise.all(segs.map((s) => probeDuration(s.path)));

    // The outer ends have no neighbour to dissolve with, so an edge clip's fade
    // there is a fade against black; interior boundaries cross-fade two pieces.
    const startBlack = Math.min(segs[0].fadeIn, dur[0]);
    const endBlack = Math.min(segs[n - 1].fadeOut, dur[n - 1]);
    const boundary = (i: number) => segs[i].fadeOut || segs[i + 1].fadeIn || 0;

    // 1. Pre-process each input: relabel [i:v] → [vi], baking in the black fades.
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const f: string[] = [];
      if (i === 0 && startBlack > 0)
        f.push(`fade=t=in:st=0:d=${startBlack.toFixed(3)}`);
      if (i === n - 1 && endBlack > 0)
        f.push(
          `fade=t=out:st=${(dur[i] - endBlack).toFixed(3)}:d=${endBlack.toFixed(3)}`,
        );
      parts.push(`[${i}:v]${f.length ? f.join(",") : "null"}[v${i}]`);
    }

    // 2. Fold the inputs together left to right, xfade or concat per boundary.
    let acc = "v0";
    let accDur = dur[0];
    for (let i = 1; i < n; i++) {
      const lbl = `x${i}`;
      const d = boundary(i - 1);
      if (d > 0) {
        const dd = Math.min(d, accDur, dur[i]);
        const offset = Math.max(0, accDur - dd);
        parts.push(
          `[${acc}][v${i}]xfade=transition=fade:duration=${dd.toFixed(3)}:offset=${offset.toFixed(3)}[${lbl}]`,
        );
        accDur += dur[i] - dd;
      } else {
        parts.push(`[${acc}][v${i}]concat=n=2:v=1:a=0[${lbl}]`);
        accDur += dur[i];
      }
      acc = lbl;
    }

    await runFfmpeg([
      "-y",
      ...segs.flatMap((s) => ["-i", s.path]),
      "-filter_complex",
      parts.join(";"),
      "-map",
      `[${acc}]`,
      "-c:v",
      cfg.videoCodec,
      "-preset",
      cfg.videoPreset,
      "-crf",
      String(cfg.videoCrf),
      "-pix_fmt",
      "yuv420p",
      out,
    ]);
    this.log("Record", `joined ${n} segments (cross-faded)`);
  }

  /**
   * Mux the audio track onto the silent `videoPath` → `out`. Each clip is
   * delayed to its `startMs` (`adelay`), gained (`volume`), then `amix`ed; the
   * video is stream-copied and `-shortest` clamps output to the video length.
   *
   * Per the timing contract the video defines the length: a clip that runs past
   * the end is the author's cue to add a trailing `wait()`, so we warn and let
   * `-shortest` truncate it rather than padding the video.
   */
  private async _mux(videoPath: string, out: string): Promise<void> {
    const videoMs = (await probeDuration(videoPath)) * 1000;
    for (const { path, overMs } of audioOverruns(this.audioTrack, videoMs)) {
      this.log(
        "Audio",
        `warning: "${path}" runs ${overMs}ms past the video end and will be cut — ` +
          `add a trailing wait() to give it room`,
      );
    }

    const { filters, mapLabel } = audioFilterGraph(this.audioTrack);
    await runFfmpeg([
      "-y",
      "-i",
      videoPath,
      ...this.audioTrack.flatMap((a) => ["-i", a.path]),
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v",
      "-map",
      `[${mapLabel}]`,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      // The video defines the length: `-t` clamps the muxed output to it, so
      // short audio leaves trailing silence and an overrun is cut (not padded).
      // (`-shortest` would wrongly truncate the video when the audio is shorter.)
      "-t",
      (videoMs / 1000).toFixed(3),
      out,
    ]);
    this.log("Record", `muxed ${this.audioTrack.length} audio clip(s)`);
  }
}
