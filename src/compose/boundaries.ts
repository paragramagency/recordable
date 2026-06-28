import { RecordableError } from "../errors.js";

// ─── Compose layer: recording-control state machine ──────────────────────────
//
// The two-axis model (ROADMAP §6): pause/resume carve off-camera gaps *within*
// one output file; start/end/split move the *file* boundaries. At any point
// either no file is open (off-camera) or one is (capturing or paused). This
// validates a run's control actions against that machine *before* the browser
// launches, so an illegal sequence fails fast with a clean message. Pure — it
// reads only the ordered action kinds, so it's unit-testable without a browser.

/** Control actions whose ordering the state machine cares about. Plain actions
 *  (click, type, visit, …) are legal anywhere and aren't tracked. */
export type QueueKind =
  "start" | "end" | "split" | "pause" | "resume" | "insert" | "audio";

const err = (message: string) => new RecordableError("CONFIG_INVALID", message);

/**
 * Walk the ordered control `kinds` and throw on the first illegal transition.
 *
 * Boundaries default to the script edges: with no explicit `start()` the file is
 * open from the top (records top-to-bottom as before); an explicit `start()`
 * means content before it is off-camera, so the file opens closed. An unmatched
 * `start()` gets an implicit end at the bottom — finalisation closes it, no error.
 */
export function validateBoundaries(kinds: readonly QueueKind[]): void {
  // The only state that gates legality is whether a file is open. pause/resume
  // toggle the camera *within* an open file, so they never change it; split/end
  // are allowed even while paused — so paused-ness needs no separate tracking.
  let fileOpen = !kinds.includes("start"); // implicit start at top when none given

  for (const k of kinds) {
    switch (k) {
      case "start":
        if (fileOpen)
          throw err(
            "start() while a recording is already open — call end() or split() first",
          );
        fileOpen = true;
        break;
      case "end":
        if (!fileOpen)
          throw err("end() with no open recording — call start() first");
        fileOpen = false; // sealed; allowed while paused
        break;
      case "split":
        if (!fileOpen)
          throw err("split() with no open recording — call start() first");
        break; // end+start fused: stays open, new file rolls (allowed while paused)
      case "pause":
        if (!fileOpen) throw err("pause() with no open recording to pause");
        break; // redundant pause is a no-op, not an error
      case "resume":
        if (!fileOpen) throw err("resume() with no open recording to resume");
        break; // redundant resume is a no-op, not an error
      case "insert":
      case "audio":
        if (!fileOpen)
          throw err(
            `${k}() needs an open recording — it can't run in an off-camera gap; ` +
              `call start() first`,
          );
        break;
    }
  }
}
