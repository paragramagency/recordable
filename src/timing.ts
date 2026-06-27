import { isAbsolute, resolve } from "node:path";
import type { RecordableConfig } from "./config.js";
import type { Action } from "./actions.js";
import { getDuration } from "./ffmpeg.js";

// ─── Gesture timing (single source of truth) ─────────────────────────────────
//
// An interactive action isn't instantaneous: the cursor eases to the target and
// dips to "press". The runtime *spends* this time; the voiceover compiler must
// *predict* it, or every wait it computes is short by a gesture and actions drift
// late. Both import these constants so the prediction can't silently fall out of
// step.

/** Cursor "press" dip on click — scale down… */
export const PRESS_DOWN_MS = 120;
/** …then settle back. clickEffect spends their sum. */
export const PRESS_SETTLE_MS = 60;
/** CSS dip transition — intentionally shorter than PRESS_DOWN_MS so the dip fully renders before the class is removed. */
export const PRESS_TRANSITION_MS = 80;
/** Total clickEffect cost. */
const CLICK_PRESS_MS = PRESS_DOWN_MS + PRESS_SETTLE_MS;

/** Settle beat between arriving at a target and pressing (jitter base). */
export const PRE_CLICK_MS = 100;

/** Cursor-move duration bounds; the move eases from its current position. */
const CURSOR_MOVE_MIN_MS = 150;
const CURSOR_MOVE_MAX_MS = 700;

/** Cursor-move duration for a known pixel distance — eased, clamped. */
export function cursorMoveMs(dist: number): number {
  return Math.min(CURSOR_MOVE_MAX_MS, Math.max(CURSOR_MOVE_MIN_MS, dist * 0.5));
}

/** Compile-time estimate of a cursor move when the distance can't be known (no
 *  DOM at compile). A single representative value: the true move is distance-
 *  based, so a marker may still land a few hundred ms off — the overrun warning
 *  catches the cases that matter. */
const CURSOR_MOVE_ESTIMATE_MS = 350;

/** Estimated wall-clock an interactive action spends getting the cursor to its
 *  target and pressing — *before* its payload (the keystrokes of a `type`, the
 *  value-set of a `select`). The compiler adds this to elapsed so the next
 *  narrated word is placed after the gesture, not on top of it. With the cursor
 *  overlay off, only the real (non-animated) costs remain. */
export function gestureLeadMs(step: Action, cfg: RecordableConfig): number {
  const cursor = cfg.cursor ?? true;
  const move = cursor ? CURSOR_MOVE_ESTIMATE_MS : 0;
  const press = cursor ? PRE_CLICK_MS + CLICK_PRESS_MS : 0;
  switch (step.action) {
    case "click":
    case "type":
    case "clear":
    case "select":
      // Travel to the target and press; type/clear/select then act on the field.
      return move + press;
    case "hover":
      return move; // moves only — no press
    default:
      return 0; // key / waitFor / pause / … — no cursor travel
  }
}

/** How long an action occupies the timeline, so the next wait measures from its end.
 *  Omitted durations use the config default, never an elastic fit. The cursor's
 *  travel-and-press to a target (`gestureLeadMs`) is added on top, so a click/type
 *  doesn't silently push the rest of the paragraph late. */
export async function actionDurationMs(
  step: Action,
  cfg: RecordableConfig,
): Promise<number> {
  const lead = gestureLeadMs(step, cfg);
  switch (step.action) {
    case "wait":
      return (step.ms as number) ?? 0;
    case "insert": {
      // An inserted clip advances the recorded timeline by its full length; the
      // overlaid narration plays across it, so this much audio-relative time is
      // consumed and the next marker's wait is only the remainder. Resolve the
      // clip against baseDir, the same as the runtime's `_resolveFile`.
      const p = step.path as string;
      const file = isAbsolute(p) ? p : resolve(cfg.baseDir ?? "", p);
      return (await getDuration(file)) * 1000;
    }
    case "zoom":
    case "resetZoom":
      return (step.duration as number) ?? cfg.zoomDuration ?? 600;
    case "scroll":
      return (step.duration as number) ?? cfg.scrollDuration ?? 1200;
    case "type": {
      // Travel to the field (lead) then the keystrokes. The runtime's `type` sums
      // its jittered delays to exactly `typingDuration`, so that part agrees.
      const keys =
        (step.duration as number) ??
        typingDuration((step.text as string) ?? "", cfg.typingSpeed ?? 7);
      return lead + keys;
    }
    default:
      return lead; // click / select / hover travel; key / waitFor … are 0
  }
}

// ─── Randomness ──────────────────────────────────────────────────────────────

/** Returns `base` ± `variance` (defaults to ±50% of base). */
export function jitter(base: number, variance = 0.5): number {
  return base + (Math.random() - 0.5) * base * variance * 2;
}

// ─── Deterministic typing ──────────────────────────────────────────────────────
// `type` is jittered for realism yet deterministic in *total* time: the keystroke
// delays vary but always sum to `typingDuration`. So the voiceover compiler can
// predict a `type` action's length from the text alone (no stored duration), and
// the runtime delivers exactly that.

/** Deterministic 32-bit string hash (FNV-1a). Seeds the typing PRNG so the same
 *  text always types with the same rhythm (reproducible recordings). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG → a function yielding floats in [0, 1). Pure integer math,
 *  platform-independent, so a given seed reproduces the same sequence anywhere. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Total time (ms) a `type` action occupies — a pure function of text length and
 *  speed (cps). This is the contract the voiceover compiler estimates against, so
 *  it MUST stay identical to the compiler's `type` estimate. Jitter never alters it. */
export function typingDuration(text: string, speed: number): number {
  return Math.round((text.length / (speed > 0 ? speed : 1)) * 1000);
}

/** Per-keystroke delays (ms) that sum to exactly `total`, with seeded, zero-sum
 *  jitter. Returns `[leadPause, delayAfterChar1, …]` (lead beat + one per code
 *  point). Punctuation gets a heavier structural weight (a natural micro-pause),
 *  but all weights are normalised back onto `total` so the sum is invariant. */
export function typingGaps(
  text: string,
  speed: number,
  total: number = typingDuration(text, speed),
  amount = 0.35,
): number[] {
  const chars = [...text];
  if (chars.length === 0) return [];
  const a = Math.min(Math.max(amount, 0), 0.95); // keep weights strictly positive
  const next = rng(hashString(text));
  const LEAD_W = 1.2;
  const PUNCT_W = 1.8;
  const perturb = (w: number) => w * (1 + a * (next() - 0.5) * 2);
  const weights = [perturb(LEAD_W)];
  for (const ch of chars) {
    const structural =
      ch === " " || ch === "." || ch === "," || ch === "\n" ? PUNCT_W : 1;
    weights.push(perturb(structural));
  }
  const sum = weights.reduce((acc, w) => acc + w, 0);
  return weights.map((w) => (total * w) / sum);
}
