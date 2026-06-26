import { spawn } from "node:child_process";
import { createRequire } from "node:module";

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

/** Run ffmpeg to completion. Resolves on exit code 0, rejects otherwise. */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited with code ${code}`)),
    );
  });
}
