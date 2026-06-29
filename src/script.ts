import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Action } from "./actions.js";
import type { RecordableConfig } from "./config.js";

// ─── Script layer: the whole document ────────────────────────────────────────
//
// While actions.ts models a single action (the ACTIONS manifest + per-action
// validation), this layer models the *document* a user authors: a `Script` —
// a bare array of actions, or a `{ config, actions }` object — plus the helpers
// that take it apart (`splitScript`) and resolve its relative `visit` URLs.
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

/** A whole script: a bare array of actions, or an object pairing config (and an
 *  optional `variables` map) with the action array. */
export type Script =
  | Action[]
  | {
      $schema?: string;
      config?: RecordableConfig;
      variables?: Record<string, string>;
      actions: Action[];
    };

/** Split a `Script` into its optional config, optional variables, and actions. */
export function splitScript(script: Script): {
  config?: RecordableConfig;
  variables?: Record<string, string>;
  actions: Action[];
} {
  if (Array.isArray(script)) return { actions: script };
  return {
    config: script.config,
    variables: script.variables,
    actions: script.actions,
  };
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
