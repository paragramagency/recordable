// Shared test fixtures for the ffmpeg-backed I/O layer. Not a test file (no
// `.test.ts`), so the runner won't pick it up as a suite. Uses the same bundled
// ffmpeg the library resolves, synthesizing tiny clips so the real getDuration /
// runFfmpeg / addAudio / stitch paths run end-to-end without checked-in binaries.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG_PATH } from "../src/ffmpeg.js";
import type { Logger } from "../src/logger.js";

/** A fresh temp directory for a test's fixtures and outputs. */
export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "recordable-ff-"));
}

/** Run ffmpeg, resolving with its stderr (rejects on non-zero exit). */
function ff(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_PATH, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    proc.stderr?.on("data", (d) => (err += String(d)));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve(err) : reject(new Error(`ffmpeg ${code}: ${err}`)),
    );
  });
}

/** Synthesize a silent test-pattern MP4 of `seconds` at `path`. */
export function makeVideo(path: string, seconds = 1): Promise<string> {
  return ff([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=64x64:rate=15:duration=${seconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
}

/** Synthesize a sine-tone WAV of `seconds` at `path`. */
export function makeTone(path: string, seconds = 0.5): Promise<string> {
  return ff([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${seconds}`,
    path,
  ]);
}

/** Probe a media file, returning ffmpeg's stderr banner (has the stream lines). */
export function probe(path: string): Promise<string> {
  return ff(["-i", path]).then(
    (s) => s,
    (e) => String((e as Error).message), // ffmpeg -i with no output exits non-zero
  );
}

/** A Logger that records every call instead of printing, for assertions. */
export function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const log = ((name: string, value?: string) =>
    lines.push(value !== undefined ? `${name} ${value}` : name)) as Logger & {
    lines: string[];
  };
  log.success = (name, value) =>
    lines.push(value !== undefined ? `${name} ${value}` : name);
  log.warn = (m) => lines.push(m);
  log.error = (m) => lines.push(m);
  log.lines = lines;
  return log;
}
