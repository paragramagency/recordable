// ─── Audio mux planning (pure) ───────────────────────────────────────────────
//
// The arithmetic and ffmpeg-filter wiring behind laying audio onto the video,
// split out from the recorder so it is unit-testable without ffmpeg or a
// browser. The recorder feeds these the audio track and consumes their output.

/** One clip's placement on the timeline (recorded-time milliseconds). */
export interface ClipPlacement {
  path: string;
  startMs: number;
  durationMs: number;
  volume?: number;
}

/**
 * Recorded-time position now: finalised segment time plus the in-flight
 * segment's elapsed time (`frames / fps`). Off-camera (paused) stretches capture
 * no frames, so they never advance this clock — audio lands in recorded time.
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

/**
 * Build the `filter_complex` chain that delays each clip to its `startMs`,
 * applies volume, and mixes them. Input index `i+1` (input 0 is the video).
 * Returns the filter parts and the label to `-map` as the output audio.
 */
export function audioFilterGraph(clips: ClipPlacement[]): {
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
 * add a trailing `wait()`; the recorder warns and lets `-t` truncate.
 */
export function audioOverruns(
  clips: ClipPlacement[],
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
