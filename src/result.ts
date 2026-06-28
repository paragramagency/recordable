// ─── Run result ──────────────────────────────────────────────────────────────
//
// What a successful run() resolves to. A run produces one or more output files
// (one per start/end/split boundary; one for a plain top-to-bottom script). Hard
// failures throw a RecordableError instead — so on the result `files` is always
// real and there is never two ways to model the same failure.

/** One written output file. */
export interface RecordableFile {
  /** Absolute path to the .mp4. */
  path: string;
  /** The `start`/`split` label, or null when the file fell back to its position. */
  label: string | null;
  /** 1-based position among the written files. */
  index: number;
  /** Recorded length (ms), off-camera gaps excluded. */
  durationMs: number;
  /** File size in bytes. */
  bytes: number;
}

/** What a successful `run()` resolves to. */
export interface RecordableResult {
  /** `"completed"` when at least one file was written; `"empty"` when nothing
   *  was captured (no frames anywhere) and no file was written. */
  status: "completed" | "empty";
  /** The written files, in timeline order. Empty only when `status` is "empty". */
  files: RecordableFile[];
  /** The directory the files were written to. */
  outputDir: string;
  /** Total recorded length (ms) across all files. */
  durationMs: number;
  /** Wall-clock time the run took (ms). */
  elapsedMs: number;
  /** Non-fatal notes (skipped empty files, trimmed audio overruns). */
  warnings: string[];
}
