import { RecordableError } from "./errors.js";

// ─── Variables ───────────────────────────────────────────────────────────────
//
// Reusable values (URLs, names, labels, selectors) defined once and referenced
// across a script with `{{ name }}`. This module is pure: a name normaliser, a
// single-pass substituter, and the layered store that resolves a token against
// its sources. Discovery of the values themselves (config files, `.env`,
// frontmatter, the chain) lives in `config-file.ts` and `compose/recordable.ts`;
// here we only normalise, look up, and substitute.

/** One resolved variable: its value plus where it came from (for diagnostics). */
export interface VarEntry {
  value: string;
  source: string;
}

/** A set of variables from one source, keyed by *normalised* name. */
export type VarLayer = Map<string, VarEntry>;

/** What `substitute` needs to resolve a token: a lookup and the list of sources
 *  it searched (for the missing-variable error). */
export interface VariableResolver {
  lookup(normalizedName: string): VarEntry | undefined;
  sources(): string[];
}

/**
 * Canonical key for a variable name: case- and separator-insensitive, so
 * `VAR_EMAIL_ADDRESS` (env, prefix already stripped) ≡ `emailAddress`
 * (frontmatter) ≡ `{{ email_address }}` (a token) all resolve to one variable.
 */
export function normalizeVarName(raw: string): string {
  return raw.replace(/[_-]/g, "").toLowerCase();
}

// A token is treated as a variable reference only if it *looks like a name* — a
// letter-led identifier (letters/digits/`_`/`-`, no spaces). Anything else
// (`{{ some code }}`, `{{ 2 + 2 }}`) is non-name content and is left verbatim, so
// technical narration never trips the system.
const VALID_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Whether `token` (already trimmed) is a valid variable name vs literal prose. */
export function isValidVarName(token: string): boolean {
  return VALID_NAME.test(token);
}

// `\{{name}}` escapes a literal that would otherwise resolve; the leading `\` is
// captured so we can drop just it. `[^{}]*?` keeps a token to a single `{{…}}`
// span (no nesting) and is trimmed by the surrounding `\s*`.
const TOKEN = /(\\?)\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * Replace every `{{ name }}` in `text` with its resolved value, in one
 * left-to-right pass (a value containing `{{…}}` is never re-expanded). An
 * escaped `\{{ name }}` becomes the literal `{{ name }}`. A token that isn't a
 * valid name is left verbatim; a valid name with no value is a hard error naming
 * the variable and the sources searched.
 */
export function substitute(text: string, resolver: VariableResolver): string {
  return text.replace(TOKEN, (match, esc: string, inner: string) => {
    if (esc) return match.slice(1); // `\{{x}}` → literal `{{x}}`
    if (!isValidVarName(inner)) return match; // non-name content: leave verbatim
    const entry = resolver.lookup(normalizeVarName(inner));
    if (!entry) {
      const where = resolver.sources();
      throw new RecordableError(
        "CONFIG_INVALID",
        `Unknown variable {{${inner}}} — ` +
          (where.length
            ? `not defined in any source (searched: ${where.join(", ")})`
            : "no variable sources are defined"),
      );
    }
    return entry.value;
  });
}

/**
 * The layered variable map: one resolved view over four sources. Resolution is
 * **type-major** — every variables source outranks every env source — so the
 * layers stack lowest → highest as env < config file < document < programmatic.
 * Only the programmatic layer mutates as the chain advances; {@link snapshot}
 * freezes the current view for the deferred (voiceover) compile so a later
 * `.variable()` can't retroactively touch it.
 */
export class VariableStore implements VariableResolver {
  private env: VarLayer = new Map();
  private configFile: VarLayer = new Map();
  private document: VarLayer = new Map();
  private programmatic: VarLayer = new Map();

  /** Replace the env layer (`.env` + `process.env` `VAR_*`). */
  setEnv(layer: VarLayer): void {
    this.env = layer;
  }

  /** Replace the config-file layer (`recordable.config.json` `variables`). */
  setConfigFile(layer: VarLayer): void {
    this.configFile = layer;
  }

  /** Merge document variables (frontmatter / JSON `variables`) over the layer. */
  addDocument(vars: Record<string, string>, source: string): void {
    mergeInto(this.document, vars, source);
  }

  /** Merge programmatic variables (constructor / `.variables()` / `--var`). */
  addProgrammatic(vars: Record<string, string>, source: string): void {
    mergeInto(this.programmatic, vars, source);
  }

  /** Set one programmatic variable (`.variable(name, value)`). */
  setProgrammatic(name: string, value: string, source: string): void {
    this.programmatic.set(normalizeVarName(name), { value, source });
  }

  lookup(norm: string): VarEntry | undefined {
    return (
      this.programmatic.get(norm) ??
      this.document.get(norm) ??
      this.configFile.get(norm) ??
      this.env.get(norm)
    );
  }

  /** Distinct source labels present across every layer (for diagnostics). */
  sources(): string[] {
    const out = new Set<string>();
    for (const layer of [
      this.env,
      this.configFile,
      this.document,
      this.programmatic,
    ])
      for (const entry of layer.values()) out.add(entry.source);
    return [...out];
  }

  /** A frozen resolver over the current merged state — higher layers win. Used
   *  for the deferred voiceover compile so it sees variables as they stood when
   *  `fromMarkdown` was called, not after later `.variable()` calls. */
  snapshot(): VariableResolver {
    const merged: VarLayer = new Map();
    for (const layer of [
      this.env,
      this.configFile,
      this.document,
      this.programmatic,
    ])
      for (const [k, v] of layer) merged.set(k, v);
    const sources = [...new Set([...merged.values()].map((e) => e.source))];
    return { lookup: (n) => merged.get(n), sources: () => sources };
  }
}

/** Merge a raw name→value record into a layer under one source label. */
function mergeInto(
  layer: VarLayer,
  vars: Record<string, string>,
  source: string,
): void {
  for (const [name, value] of Object.entries(vars))
    layer.set(normalizeVarName(name), { value, source });
}

/** Build a {@link VarLayer} from a raw name→value record under one source. */
export function toVarLayer(
  vars: Record<string, string>,
  source: string,
): VarLayer {
  const layer: VarLayer = new Map();
  mergeInto(layer, vars, source);
  return layer;
}
