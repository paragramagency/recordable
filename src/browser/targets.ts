// Target resolution: author-facing target strings → Puppeteer selectors, plus
// the position-keyword test used by zoom/scroll origins.

import { RecordableError } from "../errors.js";

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

// `:nth(N)` — pick the Nth element (1-based, document order) among everything a
// selector matches, where plain CSS `:nth-child`/`:nth-of-type` only count among
// siblings. Composes with `:text()`: `a:text(Submit):nth(2)` is the
// second link whose text contains "Submit". For now it must be the
// single, trailing marker on a target (mid-selector `:nth` is a future step).
const NTH_TAIL = /^(.+):nth\((\d+)\)$/;

/** Split a trailing `:nth(N)` off a target. Returns the resolved base selector
 *  plus the 1-based index, or null when there's no `:nth(…)`. Throws on a
 *  mid-selector or malformed marker so the mistake surfaces at author time. */
export function parseIndexedTarget(
  target: string,
): { selector: string; index: number } | null {
  if (!target.includes(":nth(")) return null;
  const m = target.match(NTH_TAIL);
  if (!m || m[1].includes(":nth("))
    throw new RecordableError(
      "CONFIG_INVALID",
      `\`:nth(N)\` must be a single marker at the end of a target — got "${target}". ` +
        `(Mid-selector \`:nth\` isn't supported yet.)`,
    );
  const index = Number(m[2]);
  if (index < 1)
    throw new RecordableError(
      "CONFIG_INVALID",
      `\`:nth(N)\` is 1-based; got \`:nth(${index})\` in "${target}".`,
    );
  return { selector: resolveTarget(m[1]), index };
}

// Author-facing pseudos for picking a `<select>` option. Puppeteer's native
// `select()` matches the option's `value` attribute only, so these resolve to a
// concrete value in-page (see runtime.select). `:option-index(N)` is 1-based to
// read like `:nth-child(N)`; `:option-label(Foo)` matches the visible text.
const OPTION_INDEX = /^:option-index\((\d+)\)$/;
const OPTION_LABEL = /^:option-label\(([^)]*)\)$/;

/** Parse a select value-spec. Returns how to pick the option, or `null` when the
 *  string is a literal `value` (the default, unchanged behaviour). */
export function parseOptionSpec(
  spec: string,
): { index: number } | { label: string } | null {
  const idx = spec.match(OPTION_INDEX);
  if (idx) return { index: Number(idx[1]) }; // 1-based, as authored
  const label = spec.match(OPTION_LABEL);
  if (label) return { label: label[1].trim() };
  return null;
}

// One/two CSS position keywords or percentages. Non-global: `.test` is reused.
const POSITION_VALUE =
  /^(top|bottom|left|right|center|\d+%)(\s+(top|bottom|left|right|center|\d+%))?$/i;

/** Returns true if the string is a CSS position keyword or percentage. */
export function isPositionValue(value: string): boolean {
  return POSITION_VALUE.test(value.trim());
}
