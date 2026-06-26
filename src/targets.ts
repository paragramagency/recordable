// Target resolution: author-facing target strings → Puppeteer selectors, plus
// the position-keyword test used by zoom/scroll origins.

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
