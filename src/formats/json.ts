import { Recordable } from "../compose/recordable.js";
import type { RecordableConfig } from "../config.js";
import type { Script } from "../actions.js";

// ─── JSON authoring format ───────────────────────────────────────────────────
//
// The declarative JSON entry points: turn a `Script` (a bare action array, a
// `{ config, actions }` object, or a raw JSON string) into a Recordable. The
// shared action model — the ACTIONS manifest, validation, and call→action
// mapping — lives in `../actions.ts`; this file is just the JSON doorway.

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
