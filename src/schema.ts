import { ACTIONS, type Param, type Typ } from "./script.js";

// ─── JSON Schema generation ──────────────────────────────────────────────────
//
// Walks the ACTIONS manifest to produce a Draft 2020-12 schema for script
// files. Authoring tools (VS Code et al.) use it for autocomplete, required-key
// checking, and typo catching — independent of whether the project uses TS.
//
// Regenerate the committed `recordable.schema.json` with: npm run gen:schema

type JSONSchema = Record<string, unknown>;

const SCHEMA_URL = "https://json-schema.org/draft/2020-12/schema";

const norm = (p: Param) =>
  typeof p === "string" ? { name: p, type: "string" as Typ } : p;
const paramType = (p: Exclude<Param, string>): Typ =>
  "type" in p && p.type ? p.type : "string";

/** Convert a manifest {@link Typ} into a JSON Schema fragment. */
function typeToSchema(t: Typ): JSONSchema {
  if (t === "string" || t === "number" || t === "boolean") return { type: t };
  if ("enum" in t) return { type: "string", enum: [...t.enum] };
  if ("oneOf" in t) return { oneOf: t.oneOf.map(typeToSchema) };
  if ("configRef" in t) return { $ref: "#/$defs/config" };
  // object
  const properties: JSONSchema = {};
  for (const [k, v] of Object.entries(t.object))
    properties[k] = typeToSchema(v);
  return {
    type: "object",
    properties,
    additionalProperties: t.open === true,
    ...(t.open ? {} : { required: Object.keys(t.object) }),
  };
}

/** The properties + required keys an action contributes (beyond `action`). */
function actionShape(params: readonly Param[]): {
  properties: JSONSchema;
  required: string[];
} {
  const properties: JSONSchema = {};
  const required: string[] = [];

  for (const raw of params) {
    const p = norm(raw);

    if ("gather" in p) {
      for (const [k, v] of Object.entries(p.gather))
        properties[k] = typeToSchema(v);
      continue; // gathered keys are always optional
    }
    properties[p.name] = typeToSchema(paramType(p));
    if (!("optional" in p && p.optional)) required.push(p.name);
  }

  return { properties, required };
}

/**
 * The `step` schema: a single object whose `action` enumerates every action,
 * with one `if/then` per action applying that action's keys.
 *
 * This shape (rather than a `oneOf` of per-action objects) is what makes editor
 * autocomplete offer *all* action names: VS Code only suggests `const` values
 * from `oneOf` branches the current object already satisfies, so a `oneOf` lists
 * just the no-arg actions until you've typed the other keys. The `enum` + `then`
 * form keeps full autocomplete while preserving required-key and typo checks.
 */
function stepSchema(): JSONSchema {
  const actions = Object.keys(ACTIONS);

  const allOf = actions.map((action) => {
    const { properties, required } = actionShape(ACTIONS[action]);
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

/** Schema for the `config` block — mirrors RecordableConfig. */
function configSchema(): JSONSchema {
  const n = { type: "number" } as const;
  const s = { type: "string" } as const;
  const b = { type: "boolean" } as const;
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      viewport: {
        type: "object",
        properties: { width: n, height: n },
        required: ["width", "height"],
        additionalProperties: false,
      },
      fps: n,
      outputDir: s,
      outputName: s,
      outputTimestamp: b,
      assetsDir: s,
      headless: b,
      launchArgs: { type: "array", items: s },
      typingSpeed: n,
      videoCrf: n,
      videoCodec: s,
      videoPreset: s,
      zoomDuration: n,
      actionDelay: n,
      silent: b,
      autoScroll: b,
      scrollMargin: n,
      scrollSpeed: n,
      cursor: b,
      visitTimeout: n,
    },
  };
}

/** Build the full JSON Schema for a Recordable script file. */
export function buildSchema(): JSONSchema {
  const step = stepSchema();

  const objectForm: JSONSchema = {
    type: "object",
    required: ["steps"],
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      config: { $ref: "#/$defs/config" },
      steps: { type: "array", items: { $ref: "#/$defs/step" } },
    },
  };

  const arrayForm: JSONSchema = {
    type: "array",
    items: { $ref: "#/$defs/step" },
  };

  return {
    $schema: SCHEMA_URL,
    $id: "https://raw.githubusercontent.com/paragramagency/recordable/main/recordable.schema.json",
    title: "Recordable script",
    description:
      "A declarative recording script: config + an array of action steps.",
    oneOf: [objectForm, arrayForm],
    $defs: {
      config: configSchema(),
      step: step,
    },
  };
}
