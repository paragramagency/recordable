import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSchema } from "../src/schema.js";
import { ACTIONS } from "../src/actions.js";

// ─── JSON Schema generation ──────────────────────────────────────────────────
//
// buildSchema() drives editor autocomplete + validation for script files. These
// pin the structural contract; the committed recordable.schema.json is separately
// guarded by CI (git diff after gen:schema).

const schema = buildSchema() as Record<string, any>;

test("buildSchema: top level is a oneOf of the object and array forms", () => {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.ok(Array.isArray(schema.oneOf));
  assert.equal(schema.oneOf.length, 2);

  const [objectForm, arrayForm] = schema.oneOf;
  assert.equal(objectForm.type, "object");
  assert.deepEqual(objectForm.required, ["actions"]);
  assert.equal(arrayForm.type, "array");
  assert.deepEqual(arrayForm.items, { $ref: "#/$defs/action" });
});

test("buildSchema: $defs holds config and action", () => {
  assert.ok(schema.$defs.config);
  assert.ok(schema.$defs.action);
});

test("buildSchema: action enum lists every action in the manifest", () => {
  assert.deepEqual(
    schema.$defs.action.properties.action.enum,
    Object.keys(ACTIONS),
  );
});

test("buildSchema: one if/then branch per action", () => {
  const allOf = schema.$defs.action.allOf as any[];
  assert.equal(allOf.length, Object.keys(ACTIONS).length);
  for (const branch of allOf) {
    assert.equal(branch.then.additionalProperties, false);
    assert.ok(branch.then.required.includes("action"));
  }
});

test("buildSchema: config $def omits baseDir and strips defaults", () => {
  const config = schema.$defs.config as Record<string, any>;
  assert.equal("baseDir" in config.properties, false);
  // defaults are stripped recursively → no `default` key anywhere in the tree
  assert.equal(JSON.stringify(config).includes('"default"'), false);
});
