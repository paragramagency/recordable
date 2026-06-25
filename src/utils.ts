import {
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";

// ─── Logging ─────────────────────────────────────────────────────────────────

/** A logger that prints a padded `name` label followed by an optional value. */
export type LogFn = (name: string, value?: string) => void;

/**
 * Build a logger. `isSilent` is read on every call so runtime `silent` changes
 * (via `setConfig`) take effect immediately.
 */
export function createLogger(isSilent: () => boolean): LogFn {
  return (name, value) => {
    if (isSilent()) return;
    const label = name.padEnd(8);
    console.log(value !== undefined ? `${label}${value}` : label.trimEnd());
  };
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
