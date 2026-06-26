import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as z from "zod";
import { RecordableError } from "./errors.js";
import { ConfigSchema, type RecordableConfig } from "./config.js";

// ─── Declarative JSON scripts ────────────────────────────────────────────────
//
// A script is an array of flat `{ action, ...args }` actions that map ~1:1 onto
// the chainable API. The ACTIONS manifest below is the single source of truth:
// one Zod schema per action drives value-level validation, the published JSON
// Schema (see schema.ts), and the Markdown marker mapping.
//
//   {
//     "$schema": "./recordable.schema.json",
//     "config": { "cursor": true },
//     "actions": [
//       { "action": "pause" },
//       { "action": "visit", "url": "https://example.com" },
//       { "action": "resume" },
//       { "action": "type", "target": "#title", "text": "My model" },
//       { "action": "select", "target": "#plan", "value": "pro" },
//       { "action": "waitFor", "target": "#done", "state": "visible", "timeout": 5000 }
//     ]
//   }

const STATE = z.enum(["visible", "hidden", "present"]);
const XY = z.strictObject({ x: z.number(), y: z.number() });

/**
 * Per-action argument schema (the keyed args, excluding the `action`
 * discriminator). strictObject so an unknown key (a typo) fails validation.
 */
const ACTIONS = {
  // Recording control
  pause: z.strictObject({}),
  resume: z.strictObject({}),
  resumeOnInput: z.strictObject({ message: z.string().optional() }),
  insert: z.strictObject({
    path: z.string(),
    fadeIn: z.number().optional(),
    fadeOut: z.number().optional(),
  }),
  audio: z.strictObject({
    path: z.string(),
    wait: z.boolean().optional(),
    volume: z.number().optional(),
  }),
  setConfig: z.strictObject({ config: ConfigSchema }),

  // Navigation
  visit: z.strictObject({
    url: z.string(),
    waitUntil: z.string().optional(),
    timeout: z.number().optional(),
    referer: z.string().optional(),
  }),
  waitFor: z.strictObject({
    target: z.string(),
    state: STATE.optional(),
    timeout: z.number().optional(),
  }),

  // Interactions
  click: z.strictObject({ target: z.string() }),
  hover: z.strictObject({ target: z.string() }),
  type: z.strictObject({
    target: z.string(),
    text: z.string(),
    duration: z.number().optional(),
  }),
  clear: z.strictObject({ target: z.string() }),
  select: z.strictObject({ target: z.string(), value: z.string() }),
  key: z.strictObject({ key: z.string() }),
  mouse: z.strictObject({ target: z.union([z.string(), XY]) }),

  // Scrolling / zoom
  scroll: z.strictObject({
    target: z.union([z.string(), z.number()]),
    duration: z.number().optional(),
  }),
  zoom: z.strictObject({
    level: z.number(),
    origin: z.string().optional(),
    duration: z.number().optional(),
  }),
  resetZoom: z.strictObject({ duration: z.number().optional() }),

  // Timing
  wait: z.strictObject({ ms: z.number() }),
} satisfies Record<string, z.ZodObject>;

/**
 * Keys that are optional yet passed *positionally* in Markdown method calls
 * (rather than gathered into the trailing options bag) — the only per-action
 * fact not derivable from the schema.
 */
const POSITIONAL_OPTIONAL: Record<string, readonly string[]> = {
  resumeOnInput: ["message"],
};

/** A single action: the action name plus its flat named arguments. */
export type Action = { action: string; [key: string]: unknown };

/** A whole script: a bare array of actions, or an object pairing config + actions. */
export type Script =
  | Action[]
  | { $schema?: string; config?: RecordableConfig; actions: Action[] };

// ─── Manifest derivation ─────────────────────────────────────────────────────
//
// Positional/bag layout is derived from each action's Zod `.shape`: keys in
// declaration order, with optionality read off `ZodOptional`.

const shapeOf = (name: string) =>
  (ACTIONS as Record<string, z.ZodObject>)[name].shape;

/** All argument keys, in declaration order. */
const keysInOrder = (name: string) => Object.keys(shapeOf(name));

/** Whether `key` is optional for `name` (a `ZodOptional` in the shape). */
const isOptional = (name: string, key: string) =>
  shapeOf(name)[key] instanceof z.ZodOptional;

/** Keys passed positionally: the required ones plus any flagged positional-optional. */
const positionalKeys = (name: string) =>
  keysInOrder(name).filter(
    (k) => !isOptional(name, k) || POSITIONAL_OPTIONAL[name]?.includes(k),
  );

/** Keys gathered into the trailing options bag: optional and not positional. */
const bagKeys = (name: string) =>
  keysInOrder(name).filter(
    (k) => isOptional(name, k) && !POSITIONAL_OPTIONAL[name]?.includes(k),
  );

/** One readable line per issue: `<path>: <message>`. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * Validate one keyed action against the manifest: the action must exist and its
 * argument *values* (and key names) must match the action's schema — so a wrong
 * type (`{ action: "zoom", level: "big" }`) or a typo'd key fails here. Shared by
 * {@link fromJSON} and the Markdown mapper.
 */
export function validateAction(step: Action): void {
  const schema = (ACTIONS as Record<string, z.ZodObject>)[step.action];
  if (!schema) {
    throw new RecordableError(
      "CONFIG_INVALID",
      `Unknown action "${step.action}" — valid actions: ${Object.keys(ACTIONS).join(", ")}`,
    );
  }
  const { action: _action, ...rest } = step;
  const result = schema.safeParse(rest);
  if (!result.success) {
    throw new RecordableError(
      "CONFIG_INVALID",
      `Action "${step.action}": ${formatIssues(result.error)}`,
    );
  }
}

/**
 * Turn one flat action into the positional argument list for its method.
 *
 * Optional positionals that are absent become `undefined` — JavaScript default
 * parameters then apply, so a present later arg never lands in the wrong slot.
 * Bag keys collapse into a single trailing options object.
 */
function buildArgs(step: Action, name: string): unknown[] {
  const args: unknown[] = [];
  for (const key of positionalKeys(name)) args.push(step[key]);

  const bag = bagKeys(name);
  if (bag.length) {
    const opts: Record<string, unknown> = {};
    for (const key of bag) if (key in step) opts[key] = step[key];
    args.push(Object.keys(opts).length ? opts : undefined);
  }

  // Trim trailing undefineds so the method's own defaults apply cleanly.
  while (args.length && args[args.length - 1] === undefined) args.pop();
  return args;
}

/**
 * Map a positional method call — `{ name, args }` as produced by the Markdown
 * parser — onto a flat keyed {@link Action}, the same IR the JSON layer uses.
 * Positional args are named by manifest order; a trailing options object is
 * flattened to top-level keys. The result is validated, so value/key typos throw.
 */
export function callToAction(name: string, args: readonly unknown[]): Action {
  const schema = (ACTIONS as Record<string, z.ZodObject>)[name];
  if (!schema) {
    throw new Error(
      `Unknown action "${name}" — valid actions: ${Object.keys(ACTIONS).join(", ")}`,
    );
  }

  const step: Action = { action: name };
  let i = 0;

  for (const key of positionalKeys(name)) {
    if (i < args.length) step[key] = args[i++];
    else if (!isOptional(name, key))
      throw new Error(`Action "${name}" is missing required "${key}"`);
  }

  const bag = bagKeys(name);
  if (i < args.length && bag.length) {
    const obj = args[i++];
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      throw new Error(
        `Action "${name}": expected a trailing options object, got ${JSON.stringify(obj)}`,
      );
    }
    for (const [k, v] of Object.entries(obj)) {
      if (!bag.includes(k)) {
        throw new Error(
          `Action "${name}": unknown key "${k}" — valid keys: ${bag.join(", ")}`,
        );
      }
      step[k] = v;
    }
  }

  if (i < args.length) {
    throw new Error(
      `Action "${name}": too many arguments (expected at most ${i}, got ${args.length})`,
    );
  }

  validateAction(step);
  return step;
}

/** Split a `Script` into its optional config and action array. */
export function splitScript(script: Script): {
  config?: RecordableConfig;
  actions: Action[];
} {
  if (Array.isArray(script)) return { actions: script };
  return { config: script.config, actions: script.actions };
}

/**
 * Resolve relative `visit` URLs (`./`, `../`) against `baseDir` so a script and
 * its pages travel together regardless of cwd: each becomes a `file://` URL.
 * Mutates the actions in place; a no-op when `baseDir` is empty.
 * (Relative `outputDir`/`assetsDir` are resolved alongside, in the config.)
 */
export function resolveVisitUrls(actions: Action[], baseDir: string): void {
  if (!baseDir) return;
  for (const step of actions) {
    if (
      step.action === "visit" &&
      typeof step.url === "string" &&
      /^\.\.?\//.test(step.url)
    ) {
      step.url = pathToFileURL(resolve(baseDir, step.url)).href;
    }
  }
}

/** The action manifest, exported so schema/docs tooling can read it. */
export { ACTIONS };

/** Exported for unit tests: map a keyed action to its positional method args. */
export { buildArgs };
