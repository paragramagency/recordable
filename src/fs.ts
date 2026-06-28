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

/** The optional `-YYYYMMDDhhmmss` suffix shared across a run's output files. */
function stamp(outputTimestamp: boolean): string {
  return outputTimestamp
    ? "-" + new Date().toISOString().replace(/\D/g, "").slice(0, 14)
    : "";
}

/** Build the timestamped output path and ensure its directory exists. */
export function getOutputPath(opts: {
  outputDir: string;
  outputName: string;
  outputTimestamp: boolean;
}): string {
  const { outputDir, outputName, outputTimestamp } = opts;
  const out = `${outputDir}/${outputName}${stamp(outputTimestamp)}.mp4`;
  mkdirSync(dirname(out), { recursive: true });
  return out;
}

/**
 * Resolve the output path for each file of a multi-file run (ROADMAP §6),
 * ensuring the directory exists. A single unlabelled file stays
 * `<name>.mp4`; otherwise each file is suffixed — a label always wins
 * (`<name>-intro.mp4`), an unlabelled file falls back to its 1-based position
 * (`<name>-2.mp4`). One run-wide timestamp (when enabled) is shared by all.
 * Collisions (e.g. a label equal to another's index) are disambiguated by
 * appending the position.
 */
export function resolveOutputPaths(
  opts: { outputDir: string; outputName: string; outputTimestamp: boolean },
  files: readonly { label: string | null }[],
): string[] {
  const { outputDir, outputName, outputTimestamp } = opts;
  const ts = stamp(outputTimestamp);

  const single = files.length === 1 && files[0].label == null;
  const used = new Set<string>();
  const paths = files.map((f, i) => {
    const suffix = single ? "" : `-${f.label ?? i + 1}`;
    let name = `${outputName}${suffix}${ts}.mp4`;
    if (used.has(name)) name = `${outputName}${suffix}-${i + 1}${ts}.mp4`;
    used.add(name);
    return `${outputDir}/${name}`;
  });

  if (paths.length) mkdirSync(dirname(paths[0]), { recursive: true });
  return paths;
}
