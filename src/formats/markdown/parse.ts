import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { callToAction, type Action } from "../../actions.js";
import type { RecordableConfig, VoiceoverConfig } from "../../config.js";
import { parseVariables, parseVoiceover } from "../../validate.js";
import { RecordableError } from "../../errors.js";
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
// per line (a pure action list, no narration). It's a *surface* over the same
// keyed-action IR the JSON layer uses — every call goes through `callToAction`.
//
// markdown-it tokenises the document, so the awkward cases (blank-line
// boundaries, indented/`~~~` fences, code spans with commas or parens) are the
// library's problem; we only interpret the tokens.
//
// Pure and browser-free: no TTS, ffmpeg or runtime. The voiceover add-on consumes
// the offset-bearing narration blocks for timing; the core path extracts markers
// to a plain action list, exactly as JSON would run.

const md = new MarkdownIt();

/** A marker: one call lifted out of narration, with its position in the prose. */
export interface Marker {
  step: Action;
  /** Character offset of the marker within the stripped narration (markers removed). */
  offset: number;
}

/** A prose paragraph: the narration TTS will read, plus its inline markers. */
export interface NarrationBlock {
  type: "narration";
  narration: string;
  markers: Marker[];
}

/** A fenced code block: a pure ordered action list, no narration or timing. */
export interface ActionsBlock {
  type: "actions";
  actions: Action[];
}

export type MarkdownBlock = NarrationBlock | ActionsBlock;

/** A resolved `include(path)` directive. Expanded into the calling document's
 *  blocks before {@link parseMarkdown} returns, so consumers never see it. */
interface IncludeBlock {
  type: "include";
  path: string;
}

/** A block as first parsed, before include expansion. */
type RawBlock = MarkdownBlock | IncludeBlock;

/** A narration-prose interpolator: resolves `{{ name }}` in text the TTS reads.
 *  Markers (call spans) are never passed through it — only prose. */
export type Interpolate = (text: string) => string;

/** The fully parsed document: recording config, optional voiceover + variables,
 *  blocks. */
export interface ParsedMarkdown {
  config: RecordableConfig;
  voiceover?: VoiceoverConfig;
  variables?: Record<string, string>;
  blocks: MarkdownBlock[];
}

// Sentinel marking a removed call-span while we normalise narration whitespace.
// A NUL never appears in prose and survives `\s+` collapsing (it isn't \s).
const SENTINEL = "\u0000";

// Whole-line `//` author notes (the syntax VS Code injects on toggle-comment).
// Stripped before tokenising so a note never becomes narration the TTS reads or
// an action that compiles. Dropping the whole line incl. its newline keeps a
// note placed inside a paragraph from splitting it in two. Only a line whose
// first non-whitespace is `//` matches — `//` mid-line (e.g. in `https://…`) is
// left untouched.
const LINE_COMMENT = /^[ \t]*\/\/.*\r?\n?/gm;

function stripComments(content: string): string {
  return content.replace(LINE_COMMENT, "");
}

/**
 * Parse a Markdown document into config + ordered blocks. Body-pure (no audio, no
 * network), but reads any files pulled in by `include(...)`, resolved against
 * `baseDir` (the document's folder). Frontmatter (YAML, via gray-matter) carries
 * recording config and an optional `voiceover` block; everything else is body
 * content.
 */
export function parseMarkdown(
  md: string,
  baseDir = "",
  interpolate?: Interpolate,
): ParsedMarkdown {
  const { data, content } = matter(md);
  const { voiceover, variables, ...config } = (data ??
    {}) as RecordableConfig & {
    voiceover?: VoiceoverConfig | boolean;
    variables?: Record<string, string>;
  };

  // `voiceover: true` opts in with everything from config defaults (provider,
  // voice, model); `false`/absent stays a plain, audio-free recording. An object
  // is validated so a typo'd key (e.g. `voicId`) fails clearly here.
  const vo =
    voiceover === true
      ? {}
      : voiceover === false || voiceover === undefined
        ? undefined
        : parseVoiceover(voiceover);

  return {
    config: config as RecordableConfig,
    voiceover: vo,
    variables: variables === undefined ? undefined : parseVariables(variables),
    blocks: expandIncludes(
      parseBlocks(stripComments(content), interpolate),
      baseDir,
      [],
      interpolate,
    ),
  };
}

/**
 * Tokenise the body and emit a block per top-level token: any fenced/indented
 * code block becomes an action list (the language tag is a visual aid only and is
 * ignored), and each paragraph becomes a narration block. An `include(...)` call —
 * a line in a fenced block, or a standalone paragraph — becomes an include block,
 * splitting the surrounding action list around it.
 */
function parseBlocks(content: string, interpolate?: Interpolate): RawBlock[] {
  const blocks: RawBlock[] = [];

  for (const t of md.parse(content, {})) {
    if (t.type === "fence" || t.type === "code_block") {
      let actions: Action[] = [];
      for (const c of parseMethodCalls(t.content)) {
        if (c.name === "include") {
          if (actions.length) {
            blocks.push({ type: "actions", actions });
            actions = [];
          }
          blocks.push({ type: "include", path: includePath(c) });
        } else {
          actions.push(callToAction(c.name, c.args));
        }
      }
      if (actions.length) blocks.push({ type: "actions", actions });
    } else if (t.type === "inline") {
      // The `inline` token carries a paragraph's (or heading's) content.
      const includes = inlineIncludePaths(t.children ?? []);
      if (includes) {
        for (const p of includes) blocks.push({ type: "include", path: p });
      } else {
        const block = narrationFromInline(t.children ?? [], interpolate);
        if (block.narration || block.markers.length) blocks.push(block);
      }
    }
  }

  return blocks;
}

/** The single string path of an `include(path)` call. */
function includePath(call: MethodCall): string {
  const [p, ...rest] = call.args;
  if (typeof p !== "string" || rest.length)
    throw new RecordableError(
      "CONFIG_INVALID",
      `include(path) takes one string path, got: ${JSON.stringify(call.args)}`,
    );
  return p;
}

/**
 * If a paragraph is one or more standalone `include(...)` calls (no surrounding
 * prose), return their paths; null if it has no include. Throws if an include is
 * mixed with prose or other calls — an include must stand alone so it splices
 * cleanly between blocks.
 */
function inlineIncludePaths(children: Token[]): string[] | null {
  const includes: string[] = [];
  let hasOther = false;
  for (const tok of children) {
    if (tok.type === "code_inline" && isMethodCall(tok.content)) {
      const call = parseMethodCall(tok.content);
      if (call.name === "include") {
        includes.push(includePath(call));
        continue;
      }
      hasOther = true;
    } else if (tok.type === "code_inline") {
      hasOther = true;
    } else if (tok.type === "text" && tok.content.trim() !== "") {
      hasOther = true;
    }
    // softbreak/hardbreak and emphasis/link wrappers carry no prose: ignore.
  }
  if (includes.length === 0) return null;
  if (hasOther)
    throw new RecordableError(
      "CONFIG_INVALID",
      "`include(...)` must be on its own line or in its own paragraph",
    );
  return includes;
}

/** Backstop against an unbounded include chain (e.g. a file that includes itself
 *  by a path we can't dedupe across the root document). */
const MAX_INCLUDE_DEPTH = 40;

/**
 * Replace every include block with the blocks of the file it names, resolved
 * against `baseDir` and parsed the same way. Nested includes resolve against their
 * own file's folder; an included file's frontmatter (config/voiceover) is ignored
 * — only its steps and narration are spliced in. `seen` carries the resolved paths
 * on the current branch to catch cycles.
 */
function expandIncludes(
  blocks: RawBlock[],
  baseDir: string,
  seen: string[],
  interpolate?: Interpolate,
): MarkdownBlock[] {
  if (seen.length > MAX_INCLUDE_DEPTH)
    throw new RecordableError(
      "CONFIG_INVALID",
      `include nesting too deep (> ${MAX_INCLUDE_DEPTH}) — likely a cycle`,
    );

  const out: MarkdownBlock[] = [];
  for (const b of blocks) {
    if (b.type !== "include") {
      out.push(b);
      continue;
    }
    const file = resolve(baseDir, b.path);
    if (seen.includes(file))
      throw new RecordableError(
        "CONFIG_INVALID",
        `Circular include: ${[...seen, file].join(" → ")}`,
      );
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch (e) {
      throw new RecordableError(
        "CONFIG_INVALID",
        `include: cannot read "${b.path}" (resolved to ${file})`,
        { cause: e },
      );
    }
    const { content } = matter(src); // included frontmatter is ignored
    const childBlocks = parseBlocks(stripComments(content), interpolate);
    out.push(
      ...expandIncludes(
        childBlocks,
        dirname(file),
        [...seen, file],
        interpolate,
      ),
    );
  }
  return out;
}

/**
 * Turn one prose paragraph into narration + markers. Call-shaped backtick spans
 * are lifted out as markers; their character offset into the *stripped*
 * narration (what TTS reads) is preserved for the compiler. Non-call backtick
 * spans stay in the prose verbatim. Whitespace is collapsed without shifting any
 * recorded offset.
 */
export function narrationBlock(
  raw: string,
  interpolate?: Interpolate,
): NarrationBlock {
  return narrationFromInline(
    md.parseInline(raw, {})[0]?.children ?? [],
    interpolate,
  );
}

/** Build a narration block from a paragraph's inline tokens (markdown-it).
 *  `interpolate`, when given, resolves `{{ name }}` in prose text (not markers
 *  or non-call code spans), with marker offsets computed on the resolved text. */
function narrationFromInline(
  children: Token[],
  interpolate?: Interpolate,
): NarrationBlock {
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
      s += interpolate ? interpolate(tok.content) : tok.content;
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
        step: callToAction(c.name, c.args),
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

/** Extract a plain action list from parsed blocks (markers in order, narration
 *  and timing discarded; no audio). */
export function extractActions(blocks: MarkdownBlock[]): Action[] {
  const actions: Action[] = [];
  for (const b of blocks) {
    if (b.type === "actions") actions.push(...b.actions);
    else for (const m of b.markers) actions.push(m.step);
  }
  return actions;
}
