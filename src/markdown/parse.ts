import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { Recordable } from "../main.js";
import { callToStep, fromJSON, type ScriptStep } from "../script.js";
import type { RecordableConfig, VoiceoverConfig } from "../config.js";
import {
  isMethodCall,
  parseMethodCall,
  parseMethodCalls,
  type MethodCall,
} from "./method.js";

// ─── Markdown authoring surface ──────────────────────────────────────────────
//
// A recording can be authored as Markdown: fluent-API calls as inline backtick
// spans inside narration prose (voiceover/timed), or a fenced block of one call
// per line (a pure step list, no narration). It's a *surface* over the same
// keyed-step IR the JSON layer uses — every call goes through `callToStep`.
//
// markdown-it tokenises the document, so the awkward cases (blank-line
// boundaries, indented/`~~~` fences, code spans with commas or parens) are the
// library's problem; we only interpret the tokens.
//
// Pure and browser-free: no TTS, no ffmpeg. The voiceover add-on consumes the
// offset-bearing narration blocks to compute timing; the core path here flattens
// markers to a plain chain, exactly as JSON would run.

const md = new MarkdownIt();

/** A marker: one call lifted out of narration, with its position in the prose. */
export interface Marker {
  step: ScriptStep;
  /** Character offset of the marker within the stripped narration (markers removed). */
  offset: number;
}

/** A prose paragraph: the narration TTS will read, plus its inline markers. */
export interface NarrationBlock {
  type: "narration";
  narration: string;
  markers: Marker[];
}

/** A fenced code block: a pure ordered step list, no narration or timing. */
export interface StepsBlock {
  type: "steps";
  steps: ScriptStep[];
}

export type MarkdownBlock = NarrationBlock | StepsBlock;

/** The fully parsed document: recording config, optional voiceover, blocks. */
export interface ParsedMarkdown {
  config: RecordableConfig;
  voiceover?: VoiceoverConfig;
  blocks: MarkdownBlock[];
}

// Sentinel marking a removed call-span while we normalise narration whitespace.
// A NUL never appears in prose and survives `\s+` collapsing (it isn't \s).
const SENTINEL = "\u0000";

/**
 * Parse a Markdown document into config + ordered blocks. Pure: no audio, no
 * network. Frontmatter (YAML, via gray-matter) carries recording config and an
 * optional `voiceover` block; everything else is body content.
 */
export function parseMarkdown(md: string): ParsedMarkdown {
  const { data, content } = matter(md);
  const { voiceover, ...config } = (data ?? {}) as RecordableConfig & {
    voiceover?: VoiceoverConfig | boolean;
  };

  // `voiceover: true` opts in with everything from the environment (provider,
  // voice, model); `false`/absent stays a plain, audio-free recording.
  const vo =
    voiceover === true ? {} : voiceover === false ? undefined : voiceover;

  return {
    config: config as RecordableConfig,
    voiceover: vo,
    blocks: parseBlocks(content),
  };
}

/**
 * Tokenise the body and emit a block per top-level token: any fenced/indented
 * code block becomes a step list (the language tag is a visual aid only and is
 * ignored), and each paragraph becomes a narration block.
 */
function parseBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];

  for (const t of md.parse(content, {})) {
    if (t.type === "fence" || t.type === "code_block") {
      const steps = parseMethodCalls(t.content).map((c) =>
        callToStep(c.name, c.args),
      );
      if (steps.length) blocks.push({ type: "steps", steps });
    } else if (t.type === "inline") {
      // The `inline` token carries a paragraph's (or heading's) content.
      const block = narrationFromInline(t.children ?? []);
      if (block.narration || block.markers.length) blocks.push(block);
    }
  }

  return blocks;
}

/**
 * Turn one prose paragraph into narration + markers. Call-shaped backtick spans
 * are lifted out as markers; their character offset into the *stripped*
 * narration (what TTS reads) is preserved for the compiler. Non-call backtick
 * spans stay in the prose verbatim. Whitespace is collapsed without shifting any
 * recorded offset.
 */
export function narrationBlock(raw: string): NarrationBlock {
  return narrationFromInline(md.parseInline(raw, {})[0]?.children ?? []);
}

/** Build a narration block from a paragraph's inline tokens (markdown-it). */
function narrationFromInline(children: Token[]): NarrationBlock {
  const calls: MethodCall[] = [];

  // Flatten the inline tokens to text, replacing each method-call span with a
  // single sentinel and keeping non-call code spans (and other prose) verbatim.
  // Each span holds at most one call, so a call span maps to exactly one marker.
  let s = "";
  for (const tok of children) {
    if (tok.type === "code_inline" && isMethodCall(tok.content)) {
      calls.push(parseMethodCall(tok.content));
      s += SENTINEL;
    } else if (tok.type === "code_inline") {
      s += "`" + tok.content + "`";
    } else if (tok.type === "softbreak" || tok.type === "hardbreak") {
      s += " ";
    } else if (tok.type === "text") {
      s += tok.content;
    }
    // Emphasis/link wrappers (em_open, link_open, …) carry no text of their own;
    // their text arrives as separate `text` children, so they're skipped here.
  }

  // Collapse all whitespace to single spaces, then drop a space immediately
  // after a sentinel so removing it later never leaves a double space (a single
  // leading space before the sentinel is kept as the word boundary).
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(new RegExp(SENTINEL + " ", "g"), SENTINEL);

  let narration = "";
  const markers: Marker[] = [];
  let ci = 0;
  for (const ch of s) {
    if (ch === SENTINEL) {
      const c = calls[ci++];
      markers.push({
        step: callToStep(c.name, c.args),
        offset: narration.length,
      });
    } else {
      narration += ch;
    }
  }

  // A trailing marker leaves a dangling space ("Lumen. ▮"); drop it and clamp
  // any offset that now points past the end so it fires after the last word.
  narration = narration.replace(/\s+$/, "");
  for (const m of markers)
    if (m.offset > narration.length) m.offset = narration.length;

  return { type: "narration", narration, markers };
}

/** Flatten parsed blocks to a plain step list (markers in order; no audio). */
export function flattenBlocks(blocks: MarkdownBlock[]): ScriptStep[] {
  const steps: ScriptStep[] = [];
  for (const b of blocks) {
    if (b.type === "steps") steps.push(...b.steps);
    else for (const m of b.markers) steps.push(m.step);
  }
  return steps;
}

/**
 * Build a {@link Recordable} from a Markdown document — the core, no-audio path:
 * markers compile to a plain chain exactly as JSON would, synchronously, ignoring
 * any `voiceover` frontmatter. For the voiceover-aware entry use the async
 * {@link Recordable.fromMarkdown}. `configOverride` wins over frontmatter config.
 */
export function flattenMarkdown(
  md: string,
  configOverride: RecordableConfig = {},
): Recordable {
  const { config, blocks } = parseMarkdown(md);
  return fromJSON({ config, steps: flattenBlocks(blocks) }, configOverride);
}
