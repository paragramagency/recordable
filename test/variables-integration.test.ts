import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recordable } from "../src/compose/recordable.js";
import type { Script } from "../src/script.js";
import { compileMarkdown } from "../src/voiceover/compile.js";
import { MockTTSProvider } from "../src/voiceover/mock.js";
import type { SynthOptions, TTSResult } from "../src/voiceover/types.js";
import { substitute, VariableStore } from "../src/variables.js";
import { isRecordableError } from "../src/errors.js";

// ─── Variables, end to end ───────────────────────────────────────────────────
//
// Substitution happens at *enqueue* — inside the public chain methods — so every
// authoring surface (JSON, Markdown action-lists, the programmatic chain) resolves
// uniformly, before any browser. With no run() we observe two things: a resolved
// reference enqueues without throwing, and a missing/escaped one throws (or
// doesn't) eagerly. Narration interpolation is observed through the voiceover
// compiler with a MockTTSProvider.

let TMP: string;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), "rc-vars-int-"));
  writeFileSync(
    join(TMP, "recordable.config.json"),
    JSON.stringify({
      variables: { plan: "free", siteUrl: "https://file.test" },
    }),
  );
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// Captures every string handed to TTS, so we can assert interpolated narration.
class RecordingProvider extends MockTTSProvider {
  readonly synthesized: string[] = [];
  async synthesize(text: string, opts?: SynthOptions): Promise<TTSResult> {
    this.synthesized.push(text);
    return super.synthesize(text, opts);
  }
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "rc-vars-assets-"));
}

// ─── JSON `variables` ────────────────────────────────────────────────────────

test("JSON variables resolve into an action target (enqueues, no throw)", () => {
  assert.doesNotThrow(() =>
    new Recordable().fromJSON({
      variables: { siteUrl: "https://app.test" },
      actions: [{ action: "visit", url: "{{siteUrl}}/dashboard" }],
    } as Script),
  );
});

test("JSON: a missing variable throws CONFIG_INVALID at enqueue, naming it", () => {
  try {
    new Recordable().fromJSON({
      actions: [{ action: "click", target: "{{unknownVar}}" }],
    } as Script);
    assert.fail("expected an eager throw");
  } catch (err) {
    assert.ok(isRecordableError(err));
    assert.equal(err.code, "CONFIG_INVALID");
    assert.match(err.message, /unknownVar/);
  }
});

// ─── Programmatic layer (constructor / .variables() / .variable()) ───────────

test("programmatic variables (constructor, .variables, .variable) all resolve", () => {
  assert.doesNotThrow(() =>
    new Recordable({ variables: { a: "1" } })
      .variables({ b: "2" })
      .variable("c", "3")
      .visit("{{a}}-{{b}}-{{c}}"),
  );
});

test("names are case- and separator-insensitive across the chain", () => {
  // Defined camelCase, referenced snake_case — one variable.
  assert.doesNotThrow(() =>
    new Recordable()
      .variable("emailAddress", "ada@x.test")
      .type("#email", "{{email_address}}"),
  );
});

// ─── Markdown frontmatter variables (fenced action-list, no voiceover) ───────

test("Markdown frontmatter variables resolve in a fenced action list", () => {
  const md = [
    "---",
    "variables:",
    '  target: "text:Go"',
    "---",
    "```",
    'click("{{target}}")',
    "```",
  ].join("\n");
  assert.doesNotThrow(() => new Recordable().fromMarkdown(md));
});

test("Markdown: a missing variable in a fenced action throws eagerly", () => {
  const md = ["```", 'click("{{nope}}")', "```"].join("\n");
  assert.throws(
    () => new Recordable().fromMarkdown(md),
    (err: unknown) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});

// ─── Precedence ──────────────────────────────────────────────────────────────

test("programmatic overrides a config-file variable (both resolve, no throw)", () => {
  // The config file defines `plan: free`; the chain redefines it. Either way the
  // reference resolves — proving the file layer fed the store and the override sits
  // on top (the actual winning value is asserted via the resolver below).
  assert.doesNotThrow(() =>
    new Recordable({ baseDir: TMP }).variable("plan", "pro").click("{{plan}}"),
  );
});

test("config-file variable resolves with no programmatic override", () => {
  assert.doesNotThrow(() =>
    new Recordable({ baseDir: TMP }).visit("{{siteUrl}}/x"),
  );
});

// ─── Escape ──────────────────────────────────────────────────────────────────

test("an escaped \\{{name}} does not throw — it's a literal, never resolved", () => {
  // `\{{notAVar}}` is undefined, but the escape keeps it verbatim, so no lookup.
  assert.doesNotThrow(() =>
    new Recordable().fromJSON({
      actions: [{ action: "click", target: "\\{{notAVar}}" }],
    } as Script),
  );
});

// ─── Chain order (positional substitution) ───────────────────────────────────

test("chain order: referencing a variable before it's defined throws eagerly", () => {
  // Substitution is at enqueue, so an action that runs before its `.variable()`
  // sees no value — the earlier enqueue already errored.
  assert.throws(
    () => new Recordable().click("{{plan}}"),
    (err: unknown) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
  // Define first, then reference: fine.
  assert.doesNotThrow(() =>
    new Recordable().variable("plan", "pro").click("{{plan}}"),
  );
});

// ─── Narration interpolation (voiceover path, observed via MockTTS) ──────────

test("compileMarkdown: interpolate resolves {{ name }} in narration prose", async () => {
  // Mirror the Recordable wiring: frontmatter variables feed a store, whose
  // snapshot becomes the `interpolate` the compiler applies to prose.
  const store = new VariableStore();
  store.addDocument({ productName: "Dispatch" }, "frontmatter variables");

  const rec = new RecordingProvider({ msPerChar: 50 });
  const md = [
    "---",
    "voiceover: { provider: mock, voiceId: v1 }",
    "---",
    "Welcome to {{ productName }}.",
  ].join("\n");

  await compileMarkdown(md, {
    provider: rec,
    assetsDir: freshDir(),
    interpolate: (s) => substitute(s, store),
  });

  assert.deepEqual(rec.synthesized, ["Welcome to Dispatch."]);
});

test("compileMarkdown: programmatic var wins over the config-file var in prose", async () => {
  // configFile says `plan: free`; programmatic says `plan: pro`. The store resolves
  // the programmatic value, and that's what reaches the voice — type-major precedence.
  const store = new VariableStore();
  store.setConfigFile(
    new Map([["plan", { value: "free", source: "recordable.config.json" }]]),
  );
  store.addProgrammatic({ plan: "pro" }, ".variable()");

  const rec = new RecordingProvider({ msPerChar: 50 });
  const md = [
    "---",
    "voiceover: { provider: mock, voiceId: v1 }",
    "---",
    "You're on the {{plan}} plan.",
  ].join("\n");

  await compileMarkdown(md, {
    provider: rec,
    assetsDir: freshDir(),
    interpolate: (s) => substitute(s, store),
  });

  assert.deepEqual(rec.synthesized, ["You're on the pro plan."]);
});

test("compileMarkdown: a missing narration variable throws CONFIG_INVALID", async () => {
  const store = new VariableStore();
  const md = [
    "---",
    "voiceover: { provider: mock, voiceId: v1 }",
    "---",
    "Hello {{missingName}}.",
  ].join("\n");

  await assert.rejects(
    () =>
      compileMarkdown(md, {
        provider: new MockTTSProvider(),
        assetsDir: freshDir(),
        interpolate: (s) => substitute(s, store),
      }),
    (err: unknown) => isRecordableError(err) && err.code === "CONFIG_INVALID",
  );
});
