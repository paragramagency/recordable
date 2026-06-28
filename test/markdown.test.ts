import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractActions,
  narrationBlock,
  parseMarkdown,
  type NarrationBlock,
  type ActionsBlock,
} from "../src/formats/markdown/parse.js";
import { callToAction } from "../src/actions.js";

// Canonical fixtures: the same walkthrough authored two ways — inline markers in
// prose (narration.md) and a fenced step list (fenced.md). Owned by the tests so
// demo churn can't break them.
const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );

// ─── callToAction via the manifest (markdown's mapping target) ─────────────────

test("callToAction: gather flattens the trailing options to top-level keys", () => {
  assert.deepEqual(
    callToAction("zoom", [1.5, { origin: "#hero", duration: 800 }]),
    {
      action: "zoom",
      level: 1.5,
      origin: "#hero",
      duration: 800,
    },
  );
  assert.deepEqual(
    callToAction("waitFor", [
      "text:Done",
      { state: "visible", timeout: 20000 },
    ]),
    {
      action: "waitFor",
      target: "text:Done",
      state: "visible",
      timeout: 20000,
    },
  );
});

test("callToAction: select maps target + value, and rejects extra args", () => {
  assert.deepEqual(callToAction("select", ["#r", "a"]), {
    action: "select",
    target: "#r",
    value: "a",
  });
  assert.throws(() => callToAction("select", ["#r", "a", "b"]), /too many/);
});

test("callToAction: a typo'd option key is rejected by validation", () => {
  assert.throws(
    () => callToAction("zoom", [1.5, { orgin: "#h" }]),
    /unknown key "orgin"/,
  );
});

test("callToAction: passing the old positional origin (a string) where options go throws", () => {
  assert.throws(() => callToAction("zoom", [1.5, "#hero"]), /options object/);
});

// ─── narrationBlock: stripping + offsets ─────────────────────────────────────

test("narrationBlock: marker at end carries offset = narration length", () => {
  const b = narrationBlock(`Welcome to Lumen. \`visit("https://x.test")\``);
  assert.equal(b.narration, "Welcome to Lumen.");
  assert.equal(b.markers.length, 1);
  assert.equal(b.markers[0].offset, b.narration.length);
  assert.deepEqual(b.markers[0].step, {
    action: "visit",
    url: "https://x.test",
  });
});

test("narrationBlock: mid-sentence marker offsets into stripped prose, no double space", () => {
  const b = narrationBlock(
    `Choose a rubric \`select("#rubric", "aqa")\` — the AQA descriptors.`,
  );
  assert.equal(b.narration, "Choose a rubric — the AQA descriptors.");
  // Offset sits right after "Choose a rubric " (the word boundary before the dash).
  assert.equal(b.narration.slice(0, b.markers[0].offset), "Choose a rubric ");
  assert.deepEqual(b.markers[0].step, {
    action: "select",
    target: "#rubric",
    value: "aqa",
  });
});

test("narrationBlock: two adjacent markers keep order and prose flow", () => {
  const b = narrationBlock(
    `Upload \`hover("text:Upload")\` \`click("text:Go")\` and it scores.`,
  );
  assert.equal(b.narration, "Upload and it scores.");
  assert.deepEqual(
    b.markers.map((m) => m.step.action),
    ["hover", "click"],
  );
});

test("narrationBlock: a non-call backtick span stays verbatim in narration", () => {
  const b = narrationBlock(
    `The field is \`#title\` here. \`click("text:Go")\``,
  );
  assert.equal(b.narration, "The field is `#title` here.");
  assert.equal(b.markers.length, 1);
});

// ─── Frontmatter + whole-document parsing ────────────────────────────────────

test("parseMarkdown: splits recording config from the voiceover block", () => {
  const { config, voiceover } = parseMarkdown(fixture("narration.md"));
  assert.deepEqual(config, {
    viewport: { width: 1920, height: 1080 },
    cursor: true,
  });
  assert.deepEqual(voiceover, {
    provider: "elevenlabs",
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    modelId: "eleven_multilingual_v2",
  });
});

test("parseMarkdown: `voiceover: true` opts in via an empty block (env fills it)", () => {
  const on = parseMarkdown("---\nvoiceover: true\n---\nHello.");
  assert.deepEqual(on.voiceover, {});
  const off = parseMarkdown("---\nvoiceover: false\n---\nHello.");
  assert.equal(off.voiceover, undefined);
});

test("parseMarkdown: fenced ```ts block becomes one actions block", () => {
  const { blocks } = parseMarkdown(fixture("fenced.md"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "actions");
});

test("parseBlocks: a fenced block is a step list regardless of language tag", () => {
  // The language indicator is a visual aid only — bare, `recordable`, and an
  // unrelated tag all yield the same actions.
  const body = `click("text:Go")\nwait(500)`;
  const expected = [
    { action: "click", target: "text:Go" },
    { action: "wait", ms: 500 },
  ];
  for (const lang of ["", "ts", "recordable", "js", "sh"]) {
    const { blocks } = parseMarkdown("```" + lang + "\n" + body + "\n```\n");
    assert.equal(blocks.length, 1, `lang=${lang}`);
    assert.equal(blocks[0].type, "actions");
    assert.deepEqual(
      (blocks[0] as ActionsBlock).actions,
      expected,
      `lang=${lang}`,
    );
  }
});

const EXPECTED_STEPS = [
  { action: "visit", url: "https://app.lumen.edu/demo" },
  { action: "click", target: "text:New evaluation" },
  { action: "type", target: "#title", text: "Year 9 Persuasive Writing" },
  { action: "select", target: "#rubric", value: "aqa-gcse-english" },
  { action: "hover", target: "text:Upload" },
  { action: "click", target: "text:Upload class set" },
  {
    action: "waitFor",
    target: "text:Scoring complete",
    state: "visible",
    timeout: 20000,
  },
  { action: "scroll", target: "#results" },
  { action: "zoom", level: 1.5, origin: "#rationale", duration: 800 },
  { action: "wait", ms: 2000 },
  { action: "resetZoom" },
];

test("inline-marker and fenced-list authoring compile to the same step IR", () => {
  const inline = extractActions(parseMarkdown(fixture("narration.md")).blocks);
  const fenced = extractActions(parseMarkdown(fixture("fenced.md")).blocks);
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

// ─── `//` comment stripping ──────────────────────────────────────────────────

test("parseMarkdown: a full-line `//` comment between paragraphs is dropped", () => {
  const { blocks } = parseMarkdown(
    "First paragraph.\n\n// a note for later — re-record this\n\nSecond paragraph.",
  );
  assert.equal(blocks.length, 2);
  assert.deepEqual(
    (blocks as NarrationBlock[]).map((b) => b.narration),
    ["First paragraph.", "Second paragraph."],
  );
  assert.ok(blocks.every((b) => (b as NarrationBlock).markers.length === 0));
});

test("parseMarkdown: a `//` line inside a paragraph keeps it one block, comment gone", () => {
  const { blocks } = parseMarkdown(
    "Welcome to the app.\n  // TODO tighten this line\nIt scores instantly.",
  );
  assert.equal(blocks.length, 1);
  assert.equal(
    (blocks[0] as NarrationBlock).narration,
    "Welcome to the app. It scores instantly.",
  );
});

test("parseMarkdown: a `//` line inside a fenced action list comments out that step", () => {
  const { blocks } = parseMarkdown(
    '```\nclick("text:Go")\n// visit("/old")\nwait(500)\n```\n',
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "actions");
  assert.deepEqual((blocks[0] as ActionsBlock).actions, [
    { action: "click", target: "text:Go" },
    { action: "wait", ms: 500 },
  ]);
});

test("parseMarkdown: `//` mid-line (a URL) and in a code span are left untouched", () => {
  const { blocks } = parseMarkdown(
    'See `//config` here. `visit("https://x.test")`',
  );
  assert.equal(blocks.length, 1);
  const b = blocks[0] as NarrationBlock;
  assert.equal(b.narration, "See `//config` here.");
  assert.deepEqual(b.markers[0].step, {
    action: "visit",
    url: "https://x.test",
  });
});

// ─── include(...) ────────────────────────────────────────────────────────────

const INCLUDE_DIR = fileURLToPath(
  new URL("./fixtures/include", import.meta.url),
);

test("include: splices a file's steps inline, splitting the surrounding list", () => {
  // main.md: visit("/"), include("./login.md"), click("#dash")
  const steps = extractActions(
    parseMarkdown(fixture("include/main.md"), INCLUDE_DIR).blocks,
  );
  assert.deepEqual(steps, [
    { action: "visit", url: "/" },
    { action: "visit", url: "/login" },
    { action: "type", target: "#user", text: "ada" },
    { action: "click", target: "#go" },
    { action: "click", target: "#dash" },
  ]);
});

test("include: the included file's frontmatter is ignored (parent config wins)", () => {
  // login.md sets `fps: 5` in its frontmatter; the top-level config is untouched.
  const { config } = parseMarkdown(fixture("include/main.md"), INCLUDE_DIR);
  assert.equal("fps" in config, false);
});

test("include: a standalone narration paragraph pulls the file in", () => {
  const steps = extractActions(
    parseMarkdown('`include("./login.md")`', INCLUDE_DIR).blocks,
  );
  assert.deepEqual(steps, [
    { action: "visit", url: "/login" },
    { action: "type", target: "#user", text: "ada" },
    { action: "click", target: "#go" },
  ]);
});

test("include: mixed with prose in a paragraph is rejected", () => {
  assert.throws(
    () => parseMarkdown('First `include("./login.md")` then go.', INCLUDE_DIR),
    /own line or .* own paragraph/,
  );
});

test("include: nested includes expand depth-first in order", () => {
  // nest-1 → nest-2 → nest-3, each contributing one visit before recursing.
  const steps = extractActions(
    parseMarkdown(fixture("include/nest-1.md"), INCLUDE_DIR).blocks,
  );
  assert.deepEqual(steps, [
    { action: "visit", url: "/1" },
    { action: "visit", url: "/2" },
    { action: "visit", url: "/3" },
  ]);
});

test("include: a circular include chain throws", () => {
  assert.throws(
    () => parseMarkdown(fixture("include/cycle-a.md"), INCLUDE_DIR),
    /Circular include/,
  );
});

test("include: a missing file throws a clear error", () => {
  assert.throws(
    () => parseMarkdown('`include("./nope.md")`', INCLUDE_DIR),
    /cannot read/,
  );
});
