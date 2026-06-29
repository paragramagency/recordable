import * as z from "zod";
import { ACTIONS } from "./actions.js";
import { ConfigSchema } from "./config.js";

// ─── JSON Schema generation ──────────────────────────────────────────────────
//
// Converts the Zod ACTIONS manifest into a Draft 2020-12 schema for script
// files. Authoring tools (VS Code et al.) use it for autocomplete, required-key
// checking, and typo catching — independent of whether the project uses TS.
//
// Regenerate the committed `recordable.schema.json` with: npm run gen:schema

type JSONSchema = Record<string, unknown>;

const SCHEMA_URL = "https://json-schema.org/draft/2020-12/schema";

/** Recursively delete every `key` from a JSON Schema object tree. */
function stripKey(node: unknown, key: string): void {
  if (Array.isArray(node)) {
    node.forEach((n) => stripKey(n, key));
  } else if (node && typeof node === "object") {
    delete (node as Record<string, unknown>)[key];
    Object.values(node).forEach((v) => stripKey(v, key));
  }
}

/** The properties + required keys an action contributes (beyond `action`),
 *  read from its Zod schema. `setConfig`'s nested config points at the shared
 *  `$defs/config` rather than inlining the whole config schema. */
function actionShape(name: string): {
  properties: JSONSchema;
  required: string[];
} {
  const js = z.toJSONSchema((ACTIONS as Record<string, z.ZodObject>)[name], {
    io: "input",
  }) as JSONSchema;
  const properties = (js.properties ?? {}) as JSONSchema;
  const required = (js.required ?? []) as string[];
  if ("config" in properties) properties.config = { $ref: "#/$defs/config" };
  return { properties, required };
}

/**
 * The `action` schema: a single object whose `action` key enumerates every action,
 * with one `if/then` per action applying that action's keys.
 *
 * This shape (rather than a `oneOf` of per-action objects) is what makes editor
 * autocomplete offer *all* action names: VS Code only suggests `const` values
 * from `oneOf` branches the current object already satisfies, so a `oneOf` lists
 * just the no-arg actions until you've typed the other keys. The `enum` + `then`
 * form keeps full autocomplete while preserving required-key and typo checks.
 */
function actionSchema(): JSONSchema {
  const actions = Object.keys(ACTIONS);

  const allOf = actions.map((action) => {
    const { properties, required } = actionShape(action);
    return {
      if: { properties: { action: { const: action } }, required: ["action"] },
      then: {
        properties: { action: { const: action }, ...properties },
        required: ["action", ...required],
        additionalProperties: false,
      },
    };
  });

  return {
    type: "object",
    required: ["action"],
    properties: {
      action: { enum: actions, description: "The action to perform." },
    },
    allOf,
  };
}

/** Schema for the `config` block — derived from the Zod {@link ConfigSchema}.
 *  Uses the input view (every field optional) and strips the emitted defaults so
 *  the authoring schema stays type-only. `baseDir` is set by the CLI/runtime, not
 *  authored in script files, so it's omitted. */
function configSchema(): JSONSchema {
  const schema = z.toJSONSchema(ConfigSchema, { io: "input" }) as JSONSchema;
  delete schema.$schema;
  stripKey(schema, "default");
  delete (schema.properties as Record<string, unknown>).baseDir;
  return schema;
}

/** Schema for a `variables` block — a flat map of string values. */
function variablesSchema(): JSONSchema {
  return {
    type: "object",
    additionalProperties: { type: "string" },
    description:
      "Reusable values referenced with {{ name }}. Names are case- and separator-insensitive.",
  };
}

/** Schema for a `voiceover` block (provider/voice/model defaults). Hand-written
 *  to mirror `VoiceoverConfig` — a small, stable shape. */
function voiceoverSchema(): JSONSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      provider: { type: "string" },
      voiceId: { type: "string" },
      modelId: { type: "string" },
      apiKey: { type: "string" },
      voiceSettings: {
        type: "object",
        additionalProperties: { type: "number" },
      },
      format: { type: "string" },
    },
  };
}

/** Build the full JSON Schema for a Recordable script file. */
export function buildSchema(): JSONSchema {
  const action = actionSchema();

  const objectForm: JSONSchema = {
    type: "object",
    required: ["actions"],
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      config: { $ref: "#/$defs/config" },
      variables: { $ref: "#/$defs/variables" },
      actions: { type: "array", items: { $ref: "#/$defs/action" } },
    },
  };

  const arrayForm: JSONSchema = {
    type: "array",
    items: { $ref: "#/$defs/action" },
  };

  return {
    $schema: SCHEMA_URL,
    $id: "https://raw.githubusercontent.com/paragramagency/recordable/main/recordable.schema.json",
    title: "Recordable script",
    description:
      "A declarative recording script: config + variables + an array of actions.",
    oneOf: [objectForm, arrayForm],
    $defs: {
      config: configSchema(),
      variables: variablesSchema(),
      action,
    },
  };
}

/** Build the JSON Schema for a `recordable.config.json` file: the flat config
 *  keys plus the reserved `variables` and `voiceover` sibling sections. */
export function buildConfigFileSchema(): JSONSchema {
  const config = configSchema();
  const properties: JSONSchema = {
    $schema: { type: "string" },
    ...(config.properties as JSONSchema),
    variables: { $ref: "#/$defs/variables" },
    voiceover: { $ref: "#/$defs/voiceover" },
  };

  return {
    $schema: SCHEMA_URL,
    $id: "https://raw.githubusercontent.com/paragramagency/recordable/main/recordable.config.schema.json",
    title: "Recordable config",
    description:
      "Shared recording config, variables, and voiceover defaults (recordable.config.json).",
    type: "object",
    additionalProperties: false,
    properties,
    $defs: {
      variables: variablesSchema(),
      voiceover: voiceoverSchema(),
    },
  };
}
