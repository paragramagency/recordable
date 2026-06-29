import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseMarkdown,
  type Interpolate,
  type Marker,
  type NarrationBlock,
} from "../formats/markdown/parse.js";
import type { Action } from "../actions.js";
import type { RecordableConfig, VoiceoverConfig } from "../config.js";
import { truncate } from "../utils.js";
import { RecordableError } from "../errors.js";
import { createLogger, type Logger } from "../logger.js";
import { actionDurationMs } from "../timing.js";
import { cacheKey, FileCache } from "./cache.js";
import {
  ElevenLabsProvider,
  DEFAULT_MODEL,
  DEFAULT_FORMAT,
} from "./elevenlabs.js";
import { MockTTSProvider } from "./mock.js";
import {
  extFor,
  type Alignment,
  type TTSProvider,
  type TTSResult,
} from "./types.js";

// ─── Voiceover layer: the markdown → timed-chain compiler ────────────────────
//
// Turns words into waits: synthesizes each narration paragraph (cached) and
// emits a plain core script — an `audio()` clip plus computed `wait`s so each
// marker's action starts on its narrated word. Output replays offline with no
// further TTS. Placement + warnings only, never silent retiming.

/** Everything the compiler needs that isn't in the document itself. */
export interface CompileOptions {
  /** Synthesis backend. Omit to build an `ElevenLabsProvider` from the voiceover
   *  config; pass one (e.g. `MockTTSProvider`) to synthesize offline. */
  provider?: TTSProvider;
  /** Directory the generated (committable) audio assets are written to. */
  assetsDir: string;
  /** Directory relative `include(...)` paths resolve against (the document's
   *  folder). Default: "" → resolve against cwd. */
  baseDir?: string;
  /** Voiceover settings (provider/voice/model). Falls back to document frontmatter. */
  voiceover?: VoiceoverConfig;
  /** Voiceover defaults from `recordable.config.json` — frontmatter overrides them. */
  voiceoverDefaults?: VoiceoverConfig;
  /** Resolve `{{ name }}` in narration prose. Omit to leave prose verbatim. */
  interpolate?: Interpolate;
  /** Config merged over frontmatter (e.g. CLI flags). `actionDelay` is always forced to 0. */
  configOverride?: RecordableConfig;
  /** Gitignored timing cache. Default: `<assetsDir>/.cache`. */
  cacheDir?: string;
  /** Where overrun / drift warnings go. Default: the universal `[Recordable]` warn logger. */
  warn?: (message: string) => void;
  /** Progress logger for synthesis/cache events. Omit for silent (progress is opt-in);
   *  pass the host's logger to surface the whole voiceover flow. */
  log?: Logger;
}

/** The compiled artifact: a runnable script plus the audio files it references. */
export interface CompiledScript {
  config: RecordableConfig;
  actions: Action[];
  /** Paths of every audio asset written, in document order (deduped by content). */
  assets: string[];
}

/** First-character index of the word containing `offset` (scan back to whitespace). */
function wordStart(text: string, offset: number): number {
  let i = Math.min(offset, text.length);
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

/** Timeline position (ms) of a marker: the start of its enclosing word, or the
 *  clip end for a trailing marker clamped past the last char. */
function markerFireMs(
  offset: number,
  narration: string,
  alignment: Alignment,
  durationMs: number,
): number {
  if (offset >= alignment.startMs.length) return durationMs;
  const w = wordStart(narration, offset);
  return alignment.startMs[w] ?? durationMs;
}

/** A marker as the author wrote it, e.g. `click("#signInBtn")` — for diagnostics. */
function markerLabel(step: Action): string {
  const arg = (step.target ?? step.path ?? "") as string;
  return arg ? `${step.action}("${arg}")` : `${step.action}()`;
}

/** The narrated word a marker is anchored to (or "the end" for a trailing one). */
function wordAt(narration: string, offset: number): string {
  if (offset >= narration.length) return "the end";
  const word = narration.slice(wordStart(narration, offset)).match(/^\S+/);
  return word ? `"${word[0]}"` : "the end";
}

/** Cache/asset key for a block — narration is already the stripped, audible text.
 *  Model/format default to the same values the provider applies, so the key
 *  captures what was actually synthesized (else changing the default would serve
 *  stale audio, and naming the default explicitly would force a needless re-run). */
function keyFor(narration: string, vo: VoiceoverConfig | undefined): string {
  return cacheKey({
    provider: vo?.provider ?? "mock",
    voiceId: vo?.voiceId ?? "",
    modelId: vo?.modelId ?? DEFAULT_MODEL,
    voiceSettings: vo?.voiceSettings,
    format: vo?.format ?? DEFAULT_FORMAT,
    text: narration,
  });
}

/** Everything {@link compileNarration} and its helpers need beyond the block. */
type NarrationOpts = Required<
  Pick<CompileOptions, "provider" | "assetsDir" | "warn">
> & {
  voiceover?: VoiceoverConfig;
  cache: FileCache;
  cfg: RecordableConfig;
  log: Logger;
  providerName: string;
};

/** Synthesize one paragraph cache-first and write its audio asset to disk.
 *  A miss is a real synthesis — for a network provider, an external API call. */
async function synthesizeBlock(
  narration: string,
  opts: NarrationOpts,
): Promise<{ result: TTSResult; asset: string }> {
  const key = keyFor(narration, opts.voiceover);
  const preview = truncate(narration);

  let result = opts.cache.get(key);
  if (result) {
    opts.log("Voice", `cache hit   "${preview}"`);
  } else {
    opts.log("Voice", `synthesize  "${preview}" via ${opts.providerName}`);
    result = await opts.provider.synthesize(narration, {
      format: opts.voiceover?.format,
    });
    opts.cache.put(key, result);
    const kb = (result.audio.length / 1024).toFixed(0);
    opts.log(
      "Voice",
      `generated   "${preview}" (${Math.round(result.durationMs)}ms, ${kb} KB)`,
    );
  }

  const asset = join(opts.assetsDir, `${key}.${extFor(result.format)}`);
  mkdirSync(opts.assetsDir, { recursive: true });
  writeFileSync(asset, result.audio);
  return { result, asset };
}

/** Warn that a marker can't land on its word: earlier actions in this paragraph
 *  (their cursor travel, typing, inserts) already ran `-gap`ms past it, so this
 *  one and everything after it lag. Point at the exact spot and say why. */
function warnOverrun(
  m: Marker,
  narration: string,
  preview: string,
  gap: number,
  prevOffset: number,
  warn: (message: string) => void,
): void {
  const stacked = m.offset === prevOffset;
  const cause = stacked
    ? `it shares a spot in the narration with the action before it`
    : `the actions before it overrun by that much`;
  const fix = stacked
    ? `move ${markerLabel(m.step)} to the word it actually describes, or add narration between the two`
    : `add words before it, space the actions out, or move it into a fenced block (no audio)`;
  warn(
    `Voiceover timing — ${markerLabel(m.step)} can't start on ${wordAt(narration, m.offset)} ` +
      `(paragraph "${preview}"): ${cause}, so it and the rest lag ${-gap}ms. Fix: ${fix}.`,
  );
}

/** Turn a clip's alignment into timed actions: a `wait` before each marker so it
 *  fires on its narrated word (warn, never retime, when it overruns), the marker
 *  itself, then a tail `wait` so the narration finishes before the next block. */
async function placeMarkers(
  narration: string,
  markers: Marker[],
  result: TTSResult,
  opts: NarrationOpts,
): Promise<Action[]> {
  const preview = truncate(narration);
  const alignment: Alignment = result.alignment ?? {
    chars: [],
    startMs: [],
    endMs: [],
  };
  const actions: Action[] = [];
  let elapsed = 0;
  let prevOffset = -1;
  for (const m of markers) {
    const fire = markerFireMs(
      m.offset,
      narration,
      alignment,
      result.durationMs,
    );
    const gap = Math.round(fire - elapsed);
    if (gap > 0) {
      actions.push({ action: "wait", ms: gap });
      elapsed += gap;
    } else if (gap < 0) {
      warnOverrun(m, narration, preview, gap, prevOffset, opts.warn);
    }
    actions.push(m.step);
    elapsed += await actionDurationMs(m.step, opts.cfg);
    prevOffset = m.offset;
  }

  const tail = Math.round(result.durationMs - elapsed);
  if (tail > 0) actions.push({ action: "wait", ms: tail });
  return actions;
}

/** Synthesize one paragraph (cache-first) → its `audio()` clip, a `wait`/action
 *  pair per marker, and a tail `wait` so the voiceover finishes. */
async function compileNarration(
  block: NarrationBlock,
  opts: NarrationOpts,
): Promise<{ actions: Action[]; asset: string }> {
  const { result, asset } = await synthesizeBlock(block.narration, opts);
  const actions: Action[] = [
    { action: "audio", path: asset, wait: false },
    ...(await placeMarkers(block.narration, block.markers, result, opts)),
  ];
  return { actions, asset };
}

/** Apply `recordable.config.json` voiceover defaults to a block — frontmatter
 *  always wins. The defaults let many files share a provider/voice/model without
 *  repeating it; a file stays fully reproducible by spelling the values out.
 *  No-op without a block. */
function withVoiceoverDefaults(
  vo: VoiceoverConfig | undefined,
  defaults: VoiceoverConfig,
): VoiceoverConfig | undefined {
  if (!vo) return vo;
  return {
    ...defaults,
    ...vo,
    provider: vo.provider || defaults.provider || "elevenlabs",
    voiceId: vo.voiceId || defaults.voiceId || "",
    modelId: vo.modelId ?? defaults.modelId,
  };
}

/** Pick the synthesis backend: an explicit provider, else the one named by the
 *  voiceover config. `mock` is silent/offline; ElevenLabs requires an API key
 *  (config `apiKey`, else `ELEVENLABS_API_KEY`) — without one we throw, since a
 *  voiceover run with no key can't do anything useful. */
function resolveProvider(
  provider: TTSProvider | undefined,
  voiceover: VoiceoverConfig | undefined,
): TTSProvider {
  if (provider) return provider;
  if (!voiceover) {
    throw new RecordableError(
      "CONFIG_INVALID",
      "compileMarkdown: no `voiceover` frontmatter and no `provider` — add a voiceover block or pass a provider.",
    );
  }
  if (voiceover.provider === "mock") return new MockTTSProvider();

  const hasKey = voiceover.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!hasKey) {
    throw new RecordableError(
      "CONFIG_INVALID",
      "Voiceover: ElevenLabs needs an API key — set ELEVENLABS_API_KEY (e.g. in a .env beside " +
        'the document) or `voiceover.apiKey`, or use `provider: "mock"` for silent audio.',
    );
  }
  const voiceId = voiceover.voiceId;
  if (!voiceId) {
    throw new RecordableError(
      "CONFIG_INVALID",
      "Voiceover: ElevenLabs needs a voice — set a `voiceId` in the `voiceover` section of " +
        "recordable.config.json or in the document's `voiceover` frontmatter.",
    );
  }
  return new ElevenLabsProvider({ ...voiceover, voiceId });
}

/** Compile a Markdown document into a runnable core script plus generated audio.
 *  Paragraphs become synthesized clips with computed waits; fenced blocks between
 *  them are narrative-level pauses. `actionDelay` is forced to 0 to keep timing exact. */
export async function compileMarkdown(
  md: string,
  options: CompileOptions,
): Promise<CompiledScript> {
  const parsed = parseMarkdown(md, options.baseDir, options.interpolate);
  // Progress is opt-in (silent default); warnings always surface.
  const log = options.log ?? createLogger(() => true);
  const warn =
    options.warn ?? options.log?.warn ?? createLogger(() => false).warn;
  const voiceover = withVoiceoverDefaults(
    options.voiceover ?? parsed.voiceover,
    options.voiceoverDefaults ?? {},
  );
  const provider = resolveProvider(options.provider, voiceover);
  const providerName =
    provider.constructor?.name?.replace(/(TTS)?Provider$/, "").toLowerCase() ||
    "provider";
  const cache = new FileCache(
    options.cacheDir ?? join(options.assetsDir, ".cache"),
  );

  const config: RecordableConfig = {
    ...parsed.config,
    ...options.configOverride,
    actionDelay: 0,
  };

  const actions: Action[] = [];
  const assets: string[] = [];

  const narrationCount = parsed.blocks.filter(
    (b) => b.type !== "actions",
  ).length;
  log(
    "Voice",
    `compiling ${narrationCount} narration block(s) → ${providerName}`,
  );

  for (const block of parsed.blocks) {
    if (block.type === "actions") {
      actions.push(...block.actions); // a fenced pause: actions run sequentially, no audio
      continue;
    }
    const compiled = await compileNarration(block, {
      provider,
      assetsDir: options.assetsDir,
      voiceover,
      cache,
      cfg: config,
      warn,
      log,
      providerName,
    });
    actions.push(...compiled.actions);
    assets.push(compiled.asset);
  }

  log.success("Voice", `done — compiled ${assets.length} clip(s)`);

  return { config, actions, assets };
}
