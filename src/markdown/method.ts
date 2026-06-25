import JSON5 from "json5";

// ─── Parsing a fluent-API method call ────────────────────────────────────────
//
// The Markdown authoring format embeds fluent-API method calls — `zoom(1.5,
// {origin: "#hero", duration: 800})` — as inline backtick spans and as lines in
// fenced code blocks. Each call lives alone: one backtick span, or one line of a
// code block, holds exactly one call. That rule keeps parsing trivial — the
// opening paren is the first `(` after the name and the closing paren is the
// last character once whitespace is trimmed, so there is no bracket matching.
//
// A call's arguments are exactly a JS array literal without its brackets, so we
// wrap them in `[…]` and hand them to a JSON5 parser. JSON5 accepts the surface
// we want (bare object keys, single or double quotes, trailing commas, numbers,
// booleans, null, nested arrays/objects) and rejects everything else with a
// clear error — no hand-rolled literal parser to maintain.

/** One parsed method call: the method name and its evaluated arguments. */
export interface MethodCall {
  name: string;
  args: unknown[];
}

/** True if a string looks like a method call — `ident(` at the start. */
export function isMethodCall(src: string): boolean {
  return /^\s*[A-Za-z_]\w*\s*\(/.test(src);
}

/**
 * Parse a string holding exactly one method call (`name(args)`). The name leads,
 * its argument list is delimited by the first `(` and the trailing `)`, and the
 * arguments are parsed as JSON5. Throws if the string is not a single call.
 */
export function parseMethodCall(src: string): MethodCall {
  const s = src.trim();
  const head = /^([A-Za-z_]\w*)\s*\(/.exec(s);
  if (!head) throw new Error(`Not a method call: ${src.trim()}`);
  if (!s.endsWith(")")) throw new Error(`A method call must end with ")": ${src.trim()}`);

  const open = head[0].length - 1; // index of the first "("
  const close = s.length - 1; // index of the trailing ")"
  return { name: head[1], args: parseArgList(s.slice(open + 1, close)) };
}

/**
 * Parse a fenced code block: one method call per non-blank line, in order. Each
 * line is an independent call (no line may carry two), which is what makes
 * splitting on newlines sufficient.
 */
export function parseMethodCalls(src: string): MethodCall[] {
  return src
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(parseMethodCall);
}

/**
 * Parse the comma-separated argument list inside a call's parens. The list is a
 * JS array literal minus its brackets, so we wrap and parse it as JSON5.
 */
export function parseArgList(src: string): unknown[] {
  if (src.trim() === "") return [];
  try {
    return JSON5.parse(`[${src}]`);
  } catch (e) {
    throw new Error(`Invalid arguments "${src.trim()}": ${(e as Error).message}`);
  }
}
