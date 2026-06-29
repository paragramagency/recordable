import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidVarName,
  normalizeVarName,
  substitute,
  toVarLayer,
  VariableStore,
  type VariableResolver,
} from "../src/variables.js";
import { isRecordableError } from "../src/errors.js";

// ─── normalizeVarName ────────────────────────────────────────────────────────
//
// One canonical key per variable: lowercase + strip `_`/`-`, so snake, camel and
// kebab spellings of the same name collapse to a single lookup key.

test("normalizeVarName: snake / camel / kebab of one name collapse to one key", () => {
  const key = normalizeVarName("email_address");
  assert.equal(normalizeVarName("emailAddress"), key);
  assert.equal(normalizeVarName("email-address"), key);
  assert.equal(normalizeVarName("EMAIL_ADDRESS"), key);
  assert.equal(key, "emailaddress");
});

test("normalizeVarName: a bare lowercase word is unchanged", () => {
  assert.equal(normalizeVarName("plan"), "plan");
});

// ─── isValidVarName ──────────────────────────────────────────────────────────
//
// A token counts as a variable reference only if it looks like a name: a
// letter-led identifier of letters/digits/`_`/`-`. Anything else is prose.

test("isValidVarName: letter-led identifiers pass; prose / bad shapes fail", () => {
  for (const ok of ["plan", "email_address", "email-address", "x1", "aB9_c"])
    assert.equal(isValidVarName(ok), true, ok);
  for (const bad of [
    "1plan", // leading digit
    "some code", // a space
    "a.b", // a dot
    "", // empty
    "2 + 2", // arithmetic
    "café", // non-ASCII letter
  ])
    assert.equal(isValidVarName(bad), false, JSON.stringify(bad));
});

// ─── substitute ──────────────────────────────────────────────────────────────

// A tiny resolver from a plain record, for the substitution cases.
function resolver(map: Record<string, string>): VariableResolver {
  const layer = toVarLayer(map, "test");
  return {
    lookup: (n) => layer.get(n),
    sources: () => ["test"],
  };
}

test("substitute: resolves a token and trims whitespace inside the braces", () => {
  const r = resolver({ siteUrl: "https://app.example.com" });
  assert.equal(
    substitute("Open {{ siteUrl }}/dashboard now", r),
    "Open https://app.example.com/dashboard now",
  );
  // Separator-insensitive: a snake-cased token resolves the camel-cased name.
  assert.equal(substitute("{{site_url}}", r), "https://app.example.com");
});

test("substitute: many tokens in one string all resolve", () => {
  const r = resolver({ user: "Ada", plan: "pro" });
  assert.equal(substitute("{{user}} is on {{plan}}", r), "Ada is on pro");
});

test("substitute: \\{{name}} escapes to a literal {{name}}, not resolved", () => {
  const r = resolver({ name: "Ada" });
  assert.equal(substitute("\\{{name}}", r), "{{name}}");
  // The escape only drops the backslash; an adjacent real token still resolves.
  assert.equal(substitute("\\{{name}} vs {{name}}", r), "{{name}} vs Ada");
});

test("substitute: a non-name token ({{ some code }}) is left verbatim", () => {
  const r = resolver({ x: "1" });
  for (const verbatim of [
    "{{ some code }}",
    "{{ 2 + 2 }}",
    "{{a.b}}",
    "{{1x}}",
  ])
    assert.equal(substitute(verbatim, r), verbatim);
});

test("substitute: a missing variable throws CONFIG_INVALID naming it + sources", () => {
  const r = resolver({ known: "v" });
  try {
    substitute("hi {{unknown}}", r);
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(isRecordableError(err));
    assert.equal(err.code, "CONFIG_INVALID");
    assert.match(err.message, /unknown/); // names the variable
    assert.match(err.message, /test/); // names the searched source
  }
});

test("substitute: no sources at all → a distinct missing-variable message", () => {
  const empty: VariableResolver = {
    lookup: () => undefined,
    sources: () => [],
  };
  assert.throws(
    () => substitute("{{nope}}", empty),
    /no variable sources are defined/,
  );
});

test("substitute: single pass — {{…}} inside a resolved value is not re-expanded", () => {
  const r = resolver({ a: "{{b}}", b: "BEE" });
  // `a` resolves to the literal "{{b}}"; that is not expanded again.
  assert.equal(substitute("{{a}}", r), "{{b}}");
});

// ─── VariableStore ───────────────────────────────────────────────────────────
//
// Four layers resolved type-major: env < config file < document < programmatic.
// Every variables-file source outranks every env source.

test("VariableStore: type-major precedence env < configFile < document < programmatic", () => {
  const store = new VariableStore();
  const norm = normalizeVarName("plan");

  store.setEnv(toVarLayer({ plan: "env" }, ".env"));
  assert.equal(store.lookup(norm)?.value, "env");

  store.setConfigFile(
    toVarLayer({ plan: "configFile" }, "recordable.config.json"),
  );
  assert.equal(store.lookup(norm)?.value, "configFile");

  store.addDocument({ plan: "document" }, "frontmatter");
  assert.equal(store.lookup(norm)?.value, "document");

  store.addProgrammatic({ plan: "programmatic" }, ".variables()");
  assert.equal(store.lookup(norm)?.value, "programmatic");

  // Source travels with the value.
  assert.equal(store.lookup(norm)?.source, ".variables()");
});

test("VariableStore: setProgrammatic sets one variable in the top layer", () => {
  const store = new VariableStore();
  store.setConfigFile(toVarLayer({ plan: "free" }, "recordable.config.json"));
  store.setProgrammatic("PLAN", "pro", ".variable()");
  assert.equal(store.lookup(normalizeVarName("plan"))?.value, "pro");
});

test("VariableStore: lookup of an undefined name is undefined", () => {
  const store = new VariableStore();
  assert.equal(store.lookup(normalizeVarName("nope")), undefined);
});

test("VariableStore: sources() reports the distinct source label per layer", () => {
  const store = new VariableStore();
  store.setEnv(toVarLayer({ a: "1" }, ".env"));
  store.setConfigFile(toVarLayer({ b: "2" }, "recordable.config.json"));
  store.addDocument({ c: "3" }, "frontmatter");
  store.addProgrammatic({ d: "4" }, ".variables()");
  assert.deepEqual(store.sources(), [
    ".env",
    "recordable.config.json",
    "frontmatter",
    ".variables()",
  ]);
});

test("VariableStore: snapshot freezes the view — a later setProgrammatic doesn't touch it", () => {
  const store = new VariableStore();
  store.addProgrammatic({ plan: "free" }, ".variables()");
  const snap = store.snapshot();
  assert.equal(snap.lookup(normalizeVarName("plan"))?.value, "free");

  // Mutating the live store after snapshotting must not change the snapshot.
  store.setProgrammatic("plan", "pro", ".variable()");
  assert.equal(snap.lookup(normalizeVarName("plan"))?.value, "free");
  assert.equal(store.lookup(normalizeVarName("plan"))?.value, "pro");
});
