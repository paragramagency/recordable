import type { RecordableConfig } from "./config.js";
import type { ScriptStep } from "./script.js";

// ─── Gesture timing (single source of truth) ─────────────────────────────────
//
// An interactive action isn't instantaneous: the cursor eases to the target,
// dips to "press", and a click waits a beat to see if it navigated. The runtime
// (cursor.ts / main.ts) *spends* this time; the voiceover compiler must *predict*
// it, or every wait it computes is short by a gesture and actions drift late.
// Both import these constants so the prediction can't silently fall out of step.

/** Cursor "press" dip on click — scale down… */
export const PRESS_DOWN_MS = 120;
/** …then settle back. clickEffect spends their sum. */
export const PRESS_SETTLE_MS = 60;
/** Total clickEffect cost. */
export const CLICK_PRESS_MS = PRESS_DOWN_MS + PRESS_SETTLE_MS;

/** Settle beat between arriving at a target and pressing (jitter base). */
export const PRE_CLICK_MS = 100;

/** Post-click probe: how long a click waits for a possible navigation to begin. */
export const NAV_PROBE_MS = 200;

/** Cursor-move duration bounds; the move eases from its current position. */
export const CURSOR_MOVE_MIN_MS = 150;
export const CURSOR_MOVE_MAX_MS = 700;

/** Cursor-move duration for a known pixel distance — eased, clamped. */
export function cursorMoveMs(dist: number): number {
  return Math.min(CURSOR_MOVE_MAX_MS, Math.max(CURSOR_MOVE_MIN_MS, dist * 0.5));
}

/** Compile-time estimate of a cursor move when the distance can't be known (no
 *  DOM at compile). A single representative value: the true move is distance-
 *  based, so a marker may still land a few hundred ms off — the overrun warning
 *  catches the cases that matter. */
export const CURSOR_MOVE_ESTIMATE_MS = 350;

/** Estimated wall-clock an interactive step spends getting the cursor to its
 *  target and pressing — *before* its payload (the keystrokes of a `type`, the
 *  value-set of a `select`). The compiler adds this to elapsed so the next
 *  narrated word is placed after the gesture, not on top of it. With the cursor
 *  overlay off, only the real (non-animated) costs remain. */
export function gestureLeadMs(step: ScriptStep, cfg: RecordableConfig): number {
  const cursor = cfg.cursor ?? true;
  const move = cursor ? CURSOR_MOVE_ESTIMATE_MS : 0;
  const press = cursor ? PRE_CLICK_MS + CLICK_PRESS_MS : 0;
  switch (step.action) {
    case "click":
    case "type":
    case "clear":
      // type/clear focus the field with the same move-press-probe as a click.
      return move + press + NAV_PROBE_MS;
    case "select":
      // Animates to the control and presses, but sets the value directly — no
      // mouse click, so no navigation probe.
      return move + press;
    case "hover":
      return move; // moves only — no press
    default:
      return 0; // key / waitFor / pause / … — no cursor travel
  }
}
