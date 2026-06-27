// Target resolution: author-facing target strings → Puppeteer selectors, plus
// the position-keyword test used by zoom/scroll origins.

// `:text(...)` anywhere in a selector → Puppeteer's `::-p-text(...)`. Bare, not
// quoted: the target is already a quoted string in JSON/markdown, so nesting
// quotes would force escaping. Captures up to the closing `)`, so the matched
// text can't itself contain `)` (same limit as the native pseudo).
const TEXT_PSEUDO = /:text\(([^)]*)\)/g;

/** Resolve an author target string to a Puppeteer selector.
 *  - `:text(Save)` anywhere → `::-p-text(Save)`, so it composes with CSS:
 *    `button:text(Save)`, `table tr:nth-child(3) td:text(Done)`.
 *    Match is substring on the smallest element containing the text.
 *  - legacy `text:` prefix → the whole remaining string becomes a text match.
 *  - everything else passes through verbatim as a CSS selector. */
export function resolveTarget(target: string): string {
  if (target.startsWith("text:")) return `::-p-text(${target.slice(5)})`;
  return target.replace(TEXT_PSEUDO, (_, text) => `::-p-text(${text.trim()})`);
}

/** Returns true if the string is a CSS position keyword or percentage. */
export function isPositionValue(value: string): boolean {
  const token = "(top|bottom|left|right|center|\\d+%)";
  return new RegExp(`^${token}(\\s+${token})?$`, "i").test(value.trim());
}
