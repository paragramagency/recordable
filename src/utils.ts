import { mkdirSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

// ─── Logging ─────────────────────────────────────────────────────────────────

/**
 * A callable logger. Call it for a normal progress line — a padded `name` label
 * plus an optional value — and use `.success` / `.warn` / `.error` for status.
 * Status is conveyed by the colour of the `[Recordable]` prefix: soft blue for
 * progress, green for success, yellow for warnings, red for errors. Progress,
 * success and warnings go to stdout/stderr respectively and honour `silent`;
 * errors always print (to stderr) so failures are never swallowed.
 */
export interface Logger {
  (name: string, value?: string): void;
  /** Completion line, green prefix → stdout. Suppressed when `silent`. */
  success(name: string, value?: string): void;
  /** Non-fatal diagnostic → stderr. Suppressed when `silent`. */
  warn(message: string): void;
  /** Failure → stderr. Always printed, even when `silent`. */
  error(message: string): void;
}

const PREFIX = "[Recordable]";

// 256-colour codes for the prefix, keyed by status.
const COLOR = {
  info: "38;5;111",
  success: "38;5;114",
  warn: "38;5;221",
  error: "38;5;203",
};

/** Colour is on only for TTY streams, and never when NO_COLOR is set. */
function colorEnabled(stream: NodeJS.WriteStream): boolean {
  return !process.env.NO_COLOR && Boolean(stream.isTTY);
}

/** Format a line: a status-coloured prefix followed by the message body. */
function format(
  code: string,
  stream: NodeJS.WriteStream,
  label: string,
  value?: string,
): string {
  const prefix = colorEnabled(stream) ? `\x1b[${code}m${PREFIX}\x1b[0m` : PREFIX;
  const body = value !== undefined ? `${label.padEnd(8)}${value}` : label;
  return `${prefix} ${body}`;
}

/**
 * Build a logger. `isSilent` is read on every call so runtime `silent` changes
 * (via `setConfig`) take effect immediately.
 */
export function createLogger(isSilent: () => boolean): Logger {
  const log = ((name: string, value?: string) => {
    if (isSilent()) return;
    console.log(format(COLOR.info, process.stdout, name, value));
  }) as Logger;
  log.success = (name, value) => {
    if (isSilent()) return;
    console.log(format(COLOR.success, process.stdout, name, value));
  };
  log.warn = (message) => {
    if (isSilent()) return;
    console.warn(format(COLOR.warn, process.stderr, message));
  };
  log.error = (message) => {
    console.error(format(COLOR.error, process.stderr, message));
  };
  return log;
}

// ─── Timing ──────────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Returns `base` ± `variance` (defaults to ±50% of base). */
export function jitter(base: number, variance = 0.5): number {
  return base + (Math.random() - 0.5) * base * variance * 2;
}

/** Per-character keystroke delay (ms) for human-like typing at `speed` cps. */
export function typeDelay(char: string, speed: number): number {
  const base = speed > 0 ? 1000 / speed : 0;
  const pause =
    char === " " || char === "." || char === "," ? jitter(30, 1) : 0;
  return Math.max(0, jitter(base, 0.35) + pause);
}

// ─── Deterministic typing ──────────────────────────────────────────────────────
// `type` is jittered for realism yet deterministic in *total* time: the keystroke
// delays vary, but they always sum to `typingDuration`. So the voiceover compiler
// can predict a `type` action's length from the text alone (no stored duration),
// and the runtime delivers exactly that. The jitter only *redistributes* time
// within the fixed budget — it never changes the sum.

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

// ─── Targets ─────────────────────────────────────────────────────────────────

/** Resolve a target string to a Puppeteer selector.
 *  Prefix with `text:` for plain-text matching; everything else is a CSS selector. */
export function resolveTarget(target: string): string {
  return target.startsWith("text:") ? `::-p-text(${target.slice(5)})` : target;
}

/** Returns true if the string is a CSS position keyword or percentage. */
export function isPositionValue(value: string): boolean {
  const token = "(top|bottom|left|right|center|\\d+%)";
  return new RegExp(`^${token}(\\s+${token})?$`, "i").test(value.trim());
}

// ─── Text ────────────────────────────────────────────────────────────────────

export function truncate(text: string, max = 40): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ─── Files ───────────────────────────────────────────────────────────────────

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
