import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { RecordableError } from "./errors.js";

/** Probe a clip's duration in seconds by parsing ffmpeg's stderr banner. 0 if unreadable. */
export function probeDuration(path: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG_PATH, ["-i", path], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    proc.stderr?.on("data", (d) => (err += String(d)));
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0);
    });
  });
}

// Prefer the ffmpeg binary bundled by @ffmpeg-installer/ffmpeg; fall back to a
// system `ffmpeg` on PATH if it isn't present for some reason.
function resolveFfmpegPath(): string {
  try {
    return createRequire(import.meta.url)("@ffmpeg-installer/ffmpeg").path;
  } catch {
    return "ffmpeg";
  }
}

export const FFMPEG_PATH = resolveFfmpegPath();

/** Tail of an ffmpeg stderr stream — the last `max` non-blank lines, where the
 *  actual error usually lives (the rest is the version/config banner). */
function tail(text: string, max = 8): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(-max).join("\n");
}

/** Run ffmpeg to completion. Resolves on exit code 0; on a non-zero exit or a
 *  spawn failure rejects with a {@link RecordableError} carrying the stderr tail,
 *  so the real cause (bad filter, missing codec, unreadable input) is visible. */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr?.on("data", (d) => (err += String(d)));
    proc.on("error", (e) =>
      reject(
        new RecordableError("FFMPEG_FAILED", `Could not run ffmpeg: ${e.message}`, {
          cause: e,
        }),
      ),
    );
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      const detail = tail(err);
      reject(
        new RecordableError(
          "FFMPEG_FAILED",
          `ffmpeg exited with code ${code}${detail ? `:\n${detail}` : ""}`,
        ),
      );
    });
  });
}
