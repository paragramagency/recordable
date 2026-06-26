import { existsSync } from "node:fs";
import { getDuration } from "../ffmpeg.js";
import { RecordableError } from "../errors.js";

// ─── Audio layer: the track ──────────────────────────────────────────────────
//
// The clips laid onto a recording — narration, a music bed, a sound effect — plus
// the pure arithmetic/ffmpeg-filter wiring that mixes them (kept testable without
// ffmpeg or a browser). Each clip is positioned in *recorded* time (off-camera
// pauses excluded); the position is read from the video timeline at the moment
// the clip is added. The combining step itself lives in `./mix.ts`.

/** One clip placed on the timeline (recorded-time milliseconds). */
export interface AudioClip {
  path: string;
  startMs: number;
  durationMs: number;
  volume?: number;
}

/**
 * The audio layered onto a recording: an ordered set of clips, each pinned to a
 * recorded-time position supplied by the caller (the video timeline). Mixed onto
 * the finished video at finalise via {@link ./mix.ts addAudio}.
 */
export class AudioTrack {
  private readonly clips: AudioClip[] = [];

  /** Number of clips on the track. */
  get length(): number {
    return this.clips.length;
  }

  /** The clips in document order (read-only view for the mixer). */
  list(): readonly AudioClip[] {
    return this.clips;
  }

  /**
   * Add a clip at `startMs` (recorded time). Probes its duration so the caller
   * can block for it when `audio({ wait: true })`. Throws if the file is missing.
   */
  async add(
    path: string,
    startMs: number,
    options: { volume?: number } = {},
  ): Promise<{ startMs: number; durationMs: number }> {
    if (!existsSync(path))
      throw new RecordableError("FILE_NOT_FOUND", `audio: file not found: ${path}`);
    const durationMs = (await getDuration(path)) * 1000;
    this.clips.push({ path, startMs, durationMs, volume: options.volume });
    return { startMs, durationMs };
  }
}

/**
 * Build the `filter_complex` chain that delays each clip to its `startMs`,
 * applies volume, and mixes them. Input index `i+1` (input 0 is the video).
 * Returns the filter parts and the label to `-map` as the output audio.
 */
export function audioFilterGraph(clips: readonly AudioClip[]): {
  filters: string[];
  mapLabel: string;
} {
  const labels: string[] = [];
  const filters = clips.map((c, i) => {
    const chain = [`adelay=${Math.round(c.startMs)}:all=1`];
    if (c.volume != null && c.volume !== 1) chain.push(`volume=${c.volume}`);
    labels.push(`[a${i}]`);
    return `[${i + 1}:a]${chain.join(",")}[a${i}]`;
  });

  if (clips.length === 1) return { filters, mapLabel: "a0" };

  filters.push(
    `${labels.join("")}amix=inputs=${clips.length}:normalize=0[aout]`,
  );
  return { filters, mapLabel: "aout" };
}

/**
 * Clips that run past the video end (beyond `tolMs` slack). Per the timing
 * contract the video defines the length, so an overrun is the author's cue to
 * add a trailing `wait()`; the mixer warns and lets `-t` truncate.
 */
export function audioOverruns(
  clips: readonly AudioClip[],
  videoMs: number,
  tolMs = 50,
): { path: string; overMs: number }[] {
  const over: { path: string; overMs: number }[] = [];
  for (const c of clips) {
    const overMs = Math.round(c.startMs + c.durationMs - videoMs);
    if (overMs > tolMs) over.push({ path: c.path, overMs });
  }
  return over;
}
