import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  flattenBlocks,
  narrationBlock,
  parseMarkdown,
  type NarrationBlock,
  type StepsBlock,
} from "../src/markdown/parse.js";
import { callToStep } from "../src/script.js";

// Canonical fixtures: the same walkthrough authored two ways — inline markers in
// prose (narration.md) and a fenced step list (fenced.md). Owned by the tests so
// demo churn can't break them.
const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

// ─── callToStep via the manifest (markdown's mapping target) ─────────────────

test("callToStep: gather flattens the trailing options to top-level keys", () => {
  assert.deepEqual(callToStep("zoom", [1.5, { origin: "#hero", duration: 800 }]), {
    action: "zoom",
    level: 1.5,
    origin: "#hero",
    duration: 800,
  });
  assert.deepEqual(callToStep("waitFor", ["text:Done", { state: "visible", timeout: 20000 }]), {
    action: "waitFor",
    target: "text:Done",
    state: "visible",
    timeout: 20000,
  });
});

test("callToStep: rest param soaks up trailing args", () => {
  assert.deepEqual(callToStep("select", ["#r", "a", "b"]), {
    action: "select",
    target: "#r",
    values: ["a", "b"],
  });
});

test("callToStep: a typo'd option key is rejected by validation", () => {
  assert.throws(() => callToStep("zoom", [1.5, { orgin: "#h" }]), /unknown key "orgin"/);
});

test("callToStep: passing the old positional origin (a string) where options go throws", () => {
  assert.throws(() => callToStep("zoom", [1.5, "#hero"]), /options object/);
});

// ─── narrationBlock: stripping + offsets ─────────────────────────────────────

test("narrationBlock: marker at end carries offset = narration length", () => {
  const b = narrationBlock(`Welcome to Lumen. \`visit("https://x.test")\``);
  assert.equal(b.narration, "Welcome to Lumen.");
  assert.equal(b.markers.length, 1);
  assert.equal(b.markers[0].offset, b.narration.length);
  assert.deepEqual(b.markers[0].step, { action: "visit", url: "https://x.test" });
});

test("narrationBlock: mid-sentence marker offsets into stripped prose, no double space", () => {
  const b = narrationBlock(`Choose a rubric \`select("#rubric", "aqa")\` — the AQA descriptors.`);
  assert.equal(b.narration, "Choose a rubric — the AQA descriptors.");
  // Offset sits right after "Choose a rubric " (the word boundary before the dash).
  assert.equal(b.narration.slice(0, b.markers[0].offset), "Choose a rubric ");
  assert.deepEqual(b.markers[0].step, {
    action: "select",
    target: "#rubric",
    values: ["aqa"],
  });
});

test("narrationBlock: two adjacent markers keep order and prose flow", () => {
  const b = narrationBlock(`Upload \`hover("text:Upload")\` \`click("text:Go")\` and it scores.`);
  assert.equal(b.narration, "Upload and it scores.");
  assert.deepEqual(
    b.markers.map((m) => m.step.action),
    ["hover", "click"],
  );
});

test("narrationBlock: a non-call backtick span stays verbatim in narration", () => {
  const b = narrationBlock(`The field is \`#title\` here. \`click("text:Go")\``);
  assert.equal(b.narration, "The field is `#title` here.");
  assert.equal(b.markers.length, 1);
});

// ─── Frontmatter + whole-document parsing ────────────────────────────────────

test("parseMarkdown: splits recording config from the voiceover block", () => {
  const { config, voiceover } = parseMarkdown(fixture("narration.md"));
  assert.deepEqual(config, { viewport: { width: 1920, height: 1080 }, cursor: true });
  assert.deepEqual(voiceover, {
    provider: "elevenlabs",
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    modelId: "eleven_multilingual_v2",
  });
});

test("parseMarkdown: fenced ```ts block becomes one steps block", () => {
  const { blocks } = parseMarkdown(fixture("fenced.md"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "steps");
});

test("parseBlocks: a fenced block is a step list regardless of language tag", () => {
  // The language indicator is a visual aid only — bare, `recordable`, and an
  // unrelated tag all yield the same steps.
  const body = `click("text:Go")\nwait(500)`;
  const expected = [
    { action: "click", target: "text:Go" },
    { action: "wait", ms: 500 },
  ];
  for (const lang of ["", "ts", "recordable", "js", "sh"]) {
    const { blocks } = parseMarkdown("```" + lang + "\n" + body + "\n```\n");
    assert.equal(blocks.length, 1, `lang=${lang}`);
    assert.equal(blocks[0].type, "steps");
    assert.deepEqual((blocks[0] as StepsBlock).steps, expected, `lang=${lang}`);
  }
});

const EXPECTED_STEPS = [
  { action: "visit", url: "https://app.lumen.edu/demo" },
  { action: "click", target: "text:New evaluation" },
  { action: "type", target: "#title", text: "Year 9 Persuasive Writing" },
  { action: "select", target: "#rubric", values: ["aqa-gcse-english"] },
  { action: "hover", target: "text:Upload" },
  { action: "click", target: "text:Upload class set" },
  { action: "waitFor", target: "text:Scoring complete", state: "visible", timeout: 20000 },
  { action: "scroll", target: "#results" },
  { action: "zoom", level: 1.5, origin: "#rationale", duration: 800 },
  { action: "wait", ms: 2000 },
  { action: "resetZoom" },
];

test("inline-marker and fenced-list authoring compile to the same step IR", () => {
  const inline = flattenBlocks(parseMarkdown(fixture("narration.md")).blocks);
  const fenced = flattenBlocks(parseMarkdown(fixture("fenced.md")).blocks);
  assert.deepEqual(inline, EXPECTED_STEPS);
  assert.deepEqual(fenced, EXPECTED_STEPS);
});

test("parseMarkdown (narration): one narration block per paragraph, each with markers", () => {
  const blocks = parseMarkdown(fixture("narration.md")).blocks;
  assert.ok(blocks.every((b) => b.type === "narration"));
  // 6 prose paragraphs in the mockup.
  assert.equal(blocks.length, 6);
  const first = blocks[0] as NarrationBlock;
  assert.equal(
    first.narration,
    "Welcome to Lumen — the tool that turns weeks of manual marking into minutes.",
  );
  assert.equal(first.markers[0].offset, first.narration.length);
});
