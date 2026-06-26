import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Recordable } from "./main.js";
import type { RecordableConfig } from "./config.js";

// ─── Declarative JSON scripts ────────────────────────────────────────────────
//
// A script is an array of flat `{ action, ...args }` steps that map ~1:1 onto
// the chainable API. The ACTIONS manifest below is the single source of truth:
// it drives this interpreter, the published JSON Schema (see schema.ts), and
// the Markdown marker parser later.
//
//   {
//     "$schema": "./recordable.schema.json",
//     "config": { "cursor": true },
//     "steps": [
//       { "action": "pause" },
//       { "action": "visit", "url": "https://example.com" },
//       { "action": "resume" },
//       { "action": "type", "target": "#title", "text": "My model" },
//       { "action": "select", "target": "#plan", "value": "pro" },
//       { "action": "waitFor", "target": "#done", "state": "visible", "timeout": 5000 }
//     ]
//   }

// ─── Parameter types ─────────────────────────────────────────────────────────
//
// A small type vocabulary, rich enough to generate a useful JSON Schema while
// staying readable in the manifest. Plain `"string"` is the common case, so a
// bare string param is shorthand for a required string positional.

/** The type of a single argument, used only for schema/doc generation. */
export type Typ =
  | "string"
  | "number"
  | "boolean"
  | { enum: readonly string[] }
  | { oneOf: readonly Typ[] }
  | { object: Record<string, Typ>; open?: boolean }
  | { configRef: true };

/**
 * A single positional parameter of an action.
 * - bare string → a required string positional named by that string
 * - `gather`    → instead of one nested key, these top-level keys are collected
 *                 into a trailing options object (the "trailing options bag")
 */
export type Param =
  | string
  | { name: string; type?: Typ; optional?: true }
  | { name: string; optional?: true; gather: Record<string, Typ> };

const STATE: Typ = { enum: ["visible", "hidden", "present"] };
const XY: Typ = { object: { x: "number", y: "number" } };

/** Ordered parameter list for every chainable action exposed to JSON. */
const ACTIONS: Record<string, readonly Param[]> = {
  // Recording control
  pause: [],
  resume: [],
  resumeOnInput: [{ name: "message", optional: true }],
  insert: [
    "path",
    {
      name: "options",
      optional: true,
      gather: { fadeIn: "number", fadeOut: "number" },
    },
  ],
  audio: [
    "path",
    {
      name: "options",
      optional: true,
      gather: { wait: "boolean", volume: "number" },
    },
  ],
  setConfig: [{ name: "config", type: { configRef: true } }],

  // Navigation
  visit: [
    "url",
    {
      name: "options",
      optional: true,
      type: {
        object: { waitUntil: "string", timeout: "number", referer: "string" },
        open: true,
      },
    },
  ],
  waitFor: [
    "target",
    {
      name: "options",
      optional: true,
      gather: { state: STATE, timeout: "number" },
    },
  ],

  // Interactions
  click: ["target"],
  hover: ["target"],
  type: [
    "target",
    "text",
    { name: "options", optional: true, gather: { duration: "number" } },
  ],
  clear: ["target"],
  select: ["target", "value"],
  key: ["key"],
  mouse: [{ name: "target", type: { oneOf: ["string", XY] } }],

  // Scrolling / zoom
  scroll: [
    { name: "target", type: { oneOf: ["string", "number"] } },
    { name: "options", optional: true, gather: { duration: "number" } },
  ],
  zoom: [
    { name: "level", type: "number" },
    {
      name: "options",
      optional: true,
      gather: { origin: "string", duration: "number" },
    },
  ],
  resetZoom: [
    { name: "options", optional: true, gather: { duration: "number" } },
  ],

  // Timing
  wait: [{ name: "ms", type: "number" }],
};

type ParamObj = Exclude<Param, string>;
const norm = (p: Param): ParamObj =>
  typeof p === "string" ? { name: p, type: "string" } : p;
const isOptional = (p: ParamObj) => "optional" in p && p.optional === true;

/** A single step: the action name plus its flat named arguments. */
export type ScriptStep = { action: string; [key: string]: unknown };

/** A whole script: a bare array of steps, or an object pairing config + steps. */
export type Script =
  | ScriptStep[]
  | { $schema?: string; config?: RecordableConfig; steps: ScriptStep[] };

/** The set of valid top-level keys for an action (for typo detection). */
function validKeys(params: readonly Param[]): Set<string> {
  const keys = new Set<string>(["action"]);
  for (const raw of params) {
    const p = norm(raw);
    if ("gather" in p) for (const k of Object.keys(p.gather)) keys.add(k);
    else keys.add(p.name);
  }
  return keys;
}

/**
 * Turn one flat step into the positional argument list for its method.
 *
 * Optional positionals that are absent become `undefined` — JavaScript default
 * parameters then apply, so a present later arg (e.g. `zoom` duration without
 * origin) never lands in the wrong slot.
 */
function buildArgs(step: ScriptStep, params: readonly Param[]): unknown[] {
  const args: unknown[] = [];
  for (const raw of params) {
    const p = norm(raw);

    if ("gather" in p) {
      const opts: Record<string, unknown> = {};
      for (const k of Object.keys(p.gather)) if (k in step) opts[k] = step[k];
      args.push(Object.keys(opts).length ? opts : undefined);
      continue;
    }

    if (p.name in step) args.push(step[p.name]);
    else if (isOptional(p)) args.push(undefined);
    else
      throw new Error(
        `Action "${step.action}" is missing required "${p.name}"`,
      );
  }

  // Trim trailing undefineds so the method's own defaults apply cleanly.
  while (args.length && args[args.length - 1] === undefined) args.pop();
  return args;
}

/**
 * Validate one keyed step against the manifest: the action must exist and every
 * key must be a recognised argument (catches typos like `orgin`). Returns the
 * action's parameter list. Shared by {@link fromJSON} and the Markdown mapper.
 */
export function validateStep(step: ScriptStep): readonly Param[] {
  const params = ACTIONS[step.action];
  if (!params) {
    throw new Error(
      `Unknown action "${step.action}" — valid actions: ${Object.keys(ACTIONS).join(", ")}`,
    );
  }
  const allowed = validKeys(params);
  for (const key of Object.keys(step)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Action "${step.action}": unknown key "${key}" — valid keys: ${[...allowed].join(", ")}`,
      );
    }
  }
  return params;
}

/**
 * Map a positional method call — `{ name, args }` as produced by the Markdown
 * parser — onto a flat keyed {@link ScriptStep}, the same IR the JSON layer
 * uses. Positional args are named by manifest order; a trailing options object
 * for a `gather` param is flattened to top-level keys. The result is validated,
 * so option-key typos throw here.
 */
export function callToStep(name: string, args: readonly unknown[]): ScriptStep {
  const params = ACTIONS[name];
  if (!params) {
    throw new Error(
      `Unknown action "${name}" — valid actions: ${Object.keys(ACTIONS).join(", ")}`,
    );
  }

  const step: ScriptStep = { action: name };
  let i = 0;

  for (const raw of params) {
    const p = norm(raw);

    if ("gather" in p) {
      const obj = args[i++];
      if (obj === undefined) continue;
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        throw new Error(
          `Action "${name}": expected a trailing options object, got ${JSON.stringify(obj)}`,
        );
      }
      for (const [k, v] of Object.entries(obj)) step[k] = v;
      continue;
    }

    if (i < args.length) {
      step[p.name] = args[i++];
    } else if (!isOptional(p)) {
      throw new Error(`Action "${name}" is missing required "${p.name}"`);
    }
  }

  if (i < args.length) {
    throw new Error(
      `Action "${name}": too many arguments (expected at most ${i}, got ${args.length})`,
    );
  }

  validateStep(step);
  return step;
}

/** Split a `Script` into its optional config and step array. */
export function splitScript(script: Script): {
  config?: RecordableConfig;
  steps: ScriptStep[];
} {
  if (Array.isArray(script)) return { steps: script };
  return { config: script.config, steps: script.steps };
}

/**
 * Resolve relative `visit` URLs (`./`, `../`) against `baseDir` so a script and
 * its pages travel together regardless of cwd: each becomes a `file://` URL.
 * Mutates the steps in place; a no-op when `baseDir` is empty.
 * (Relative `outputDir`/`assetsDir` are resolved alongside, in the config.)
 */
export function resolveVisitUrls(steps: ScriptStep[], baseDir: string): void {
  if (!baseDir) return;
  for (const step of steps) {
    if (
      step.action === "visit" &&
      typeof step.url === "string" &&
      /^\.\.?\//.test(step.url)
    ) {
      step.url = pathToFileURL(resolve(baseDir, step.url)).href;
    }
  }
}

/**
 * Build a {@link Recordable} from a JSON script without running it — a thin
 * wrapper over `new Recordable(configOverride).fromJSON(script)`. `configOverride`
 * (the explicit/programmatic config) wins over the script's own `config`.
 */
export function fromJSON(
  script: Script | string,
  configOverride: RecordableConfig = {},
): Recordable {
  return new Recordable(configOverride).fromJSON(script);
}

/** Build a {@link Recordable} from a JSON script and run it to completion. */
export function runScript(
  script: Script | string,
  configOverride?: RecordableConfig,
): Promise<void> {
  return fromJSON(script, configOverride).run();
}

/** The action manifest, exported so schema/docs tooling can read it. */
export { ACTIONS };

/** Exported for unit tests: map a keyed step to its positional method args. */
export { buildArgs };
