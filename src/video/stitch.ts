import { writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { getDuration, runFfmpeg } from "../ffmpeg.js";
import { moveFile, type Logger } from "../utils.js";
import type { ResolvedConfig } from "../config.js";

// ─── Video layer: stitching segments ─────────────────────────────────────────
//
// Turns the captured (and inserted) segments into one video. Three paths: a lone
// segment is just moved; plain segments are joined by a lossless stream-copy
// concat; segments that asked for cross-fades are re-encoded through an xfade
// filter graph. `stitch` picks the right one.

/**
 * One piece of the final timeline: a captured stretch or an inserted clip.
 * `fadeIn`/`fadeOut` (seconds) are non-zero only for inserted clips and request
 * a cross-fade with the neighbouring piece (or with black at the timeline ends).
 */
export interface Segment {
  path: string;
  fadeIn: number;
  fadeOut: number;
}

/** Stitch `segs` into `out`, choosing move / join / cross-fade automatically. */
export async function stitch(
  segs: Segment[],
  cfg: ResolvedConfig,
  log: Logger,
  out: string,
  tmpDir: string,
): Promise<void> {
  const hasFades = segs.some((s) => s.fadeIn > 0 || s.fadeOut > 0);
  if (hasFades) {
    await stitchWithFades(segs, cfg, log, out);
  } else if (segs.length === 1) {
    moveFile(segs[0].path, out);
  } else {
    await join(segs, cfg, log, out, tmpDir);
  }
}

/** Concatenate segments into one file. Stream-copies (lossless, fast) when the
 *  segments are compatible; falls back to a re-encode if they aren't. */
async function join(
  segments: Segment[],
  cfg: ResolvedConfig,
  log: Logger,
  out: string,
  tmpDir: string,
): Promise<void> {
  const listFile = joinPath(tmpDir, "concat.txt");
  const list = segments
    .map((s) => `file '${s.path.replace(/'/g, "'\\''")}'`)
    .join("\n");
  writeFileSync(listFile, list + "\n");
  const base = ["-y", "-f", "concat", "-safe", "0", "-i", listFile];
  try {
    await runFfmpeg([...base, "-c", "copy", out]);
    log("Record", `joined ${segments.length} segments`);
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
    log("Record", `joined ${segments.length} segments (re-encoded)`);
  }
}

/**
 * Stitch segments into one file with cross-fade transitions. Builds a single
 * `filter_complex` that, walking left to right, `xfade`s across every cross-fade
 * boundary and `concat`s across hard cuts, then fades from/to black at the very
 * ends when the edge clip asked for it.
 *
 * A cross-fade of duration `d` *overlaps* the two pieces by `d` (the outgoing
 * tail dissolves into the incoming head), so the timeline shortens by `d` at each
 * such boundary — tracked in `accDur` to place the next `xfade` offset.
 * Re-encodes throughout, since xfade can't stream-copy.
 */
async function stitchWithFades(
  segs: Segment[],
  cfg: ResolvedConfig,
  log: Logger,
  out: string,
): Promise<void> {
  const n = segs.length;
  const dur = await Promise.all(segs.map((s) => getDuration(s.path)));

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
  log("Record", `joined ${n} segments (cross-faded)`);
}
