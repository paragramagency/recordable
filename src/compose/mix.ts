import { getDuration, runFfmpeg } from "../ffmpeg.js";
import {
  audioFilterGraph,
  audioOverruns,
  type AudioClip,
} from "../audio/track.js";
import type { Logger } from "../logger.js";

// ─── Compose layer: combining audio onto the video ───────────────────────────
//
// `addAudio` lays the finished audio track onto the silent video — combining the
// two streams (the operation a pro A/V tool would call "muxing"). It lives in the
// compose layer because it joins layers; the audio layer only models the clips.
// Each clip is delayed to its position, gained, and mixed; the video is copied
// untouched.

/**
 * Add the audio `clips` onto the silent `videoPath`, writing `out`. Each clip is
 * delayed to its `startMs` (`adelay`), gained (`volume`), then `amix`ed; the
 * video is stream-copied and `-t` clamps the result to the video length.
 *
 * Per the timing contract the video defines the length: a clip that runs past
 * the end is the author's cue to add a trailing `wait()`, so we warn and let
 * `-t` truncate it rather than padding the video. Returns the overrun warnings
 * (also logged) so the caller can surface them on the run result.
 */
export async function addAudio(
  videoPath: string,
  clips: readonly AudioClip[],
  out: string,
  log: Logger,
): Promise<string[]> {
  const videoMs = (await getDuration(videoPath)) * 1000;
  const warnings: string[] = [];
  for (const { path, overMs } of audioOverruns(clips, videoMs)) {
    const msg =
      `"${path}" runs ${overMs}ms past the video end and will be cut — ` +
      `add a trailing wait() to give it room`;
    warnings.push(msg);
    log("Audio", `warning: ${msg}`);
  }

  const { filters, mapLabel } = audioFilterGraph(clips);
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    ...clips.flatMap((c) => ["-i", c.path]),
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
    // The video defines the length: `-t` clamps the output to it, so short audio
    // leaves trailing silence and an overrun is cut (not padded). (`-shortest`
    // would wrongly truncate the video when the audio is shorter.)
    "-t",
    (videoMs / 1000).toFixed(3),
    out,
  ]);
  log("Audio", `mixed ${clips.length} audio clip(s)`);
  return warnings;
}
