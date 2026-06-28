// Console logger: a status-coloured `[Recordable]` prefix plus a message body.

/**
 * A callable logger. Call it for a normal progress line — a padded `name` label
 * plus an optional value — and use `.success` / `.warn` / `.error` for status,
 * conveyed by the colour of the `[Recordable]` prefix: blue progress, green
 * success, yellow warn, red error. Stream + `silent` behaviour per method below.
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
  const prefix = colorEnabled(stream)
    ? `\x1b[${code}m${PREFIX}\x1b[0m`
    : PREFIX;
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
