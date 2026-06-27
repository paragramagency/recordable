// ─── Errors ──────────────────────────────────────────────────────────────────
//
// One error type for every *expected* failure — bad config, a missing file, an
// ffmpeg/TTS/browser failure. Carrying a `code` lets the CLI print a clean,
// actionable line (no stack trace) and lets callers branch on the cause. Genuine
// bugs stay plain `Error`s so their stack still surfaces.

/** Stable, machine-readable failure categories. */
export type ErrorCode =
  | "CONFIG_INVALID" // a config / frontmatter value is the wrong shape
  | "FILE_NOT_FOUND" // a referenced asset (insert/audio/script) is missing
  | "TARGET_NOT_FOUND" // a selector/text target matched no element on the page
  | "FFMPEG_FAILED" // an ffmpeg invocation exited non-zero or couldn't spawn
  | "TTS_FAILED" // the voiceover provider (network / SDK) failed
  | "BROWSER_LAUNCH"; // Chromium failed to launch

/** An expected, user-facing failure. `message` should say what went wrong *and*
 *  how to fix it; `cause` keeps the original error for debugging. */
export class RecordableError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "RecordableError";
  }
}

/** True for our own expected failures — the CLI prints these without a stack. */
export function isRecordableError(err: unknown): err is RecordableError {
  return err instanceof RecordableError;
}
