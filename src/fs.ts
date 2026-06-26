// Filesystem helpers: cross-device-safe move and timestamped output-path build.

import { mkdirSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

/** Move a file, falling back to copy+unlink across filesystem boundaries. */
export function moveFile(src: string, dest: string): void {
  try {
    renameSync(src, dest);
  } catch {
    // Cross-device (tmp on a different filesystem) — copy then unlink.
    copyFileSync(src, dest);
    try {
      unlinkSync(src);
    } catch {
      /* best effort */
    }
  }
}

/** Build the timestamped output path and ensure its directory exists. */
export function getOutputPath(opts: {
  outputDir: string;
  outputName: string;
  outputTimestamp: boolean;
}): string {
  const { outputDir, outputName, outputTimestamp } = opts;
  const timestamp = outputTimestamp
    ? "-" + new Date().toISOString().replace(/\D/g, "").slice(0, 14)
    : "";
  const out = `${outputDir}/${outputName}${timestamp}.mp4`;
  mkdirSync(dirname(out), { recursive: true });
  return out;
}
