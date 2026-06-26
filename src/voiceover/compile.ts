import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarkdown, type NarrationBlock } from "../markdown/parse.js";
import type { ScriptStep } from "../script.js";
import type { RecordableConfig, VoiceoverConfig } from "../config.js";
import { cacheKey, FileCache } from "./cache.js";
import { ElevenLabsProvider } from "./elevenlabs.js";
import { MockTTSProvider } from "./mock.js";
import type { Alignment, TTSProvider } from "./types.js";

// ─── Layer C: the markdown → timed-chain compiler ────────────────────────────
//
// Turns words into waits: synthesizes each narration paragraph (cached) and
// emits a plain core script — an `audio()` clip plus computed `wait`s so each
// marker's action starts on its narrated word. Output replays offline with no
// further TTS. Placement + warnings only, never silent retiming (spec §C).

/** Everything the compiler needs that isn't in the document itself. */
export interface CompileOptions {
  /** Synthesis backend. Omit to build an `ElevenLabsProvider` from the voiceover
   *  config; pass one (e.g. `MockTTSProvider`) to synthesize offline. */
  provider?: TTSProvider;
  /** Directory the generated (committable) audio assets are written to. */
  assetsDir: string;
  /** Voiceover settings (provider/voice/model). Falls back to document frontmatter. */
  voiceover?: VoiceoverConfig;
  /** Config merged over frontmatter (e.g. CLI flags). `actionDelay` is always forced to 0. */
  configOverride?: RecordableConfig;
  /** Gitignored timing cache. Default: `<assetsDir>/.cache`. */
  cacheDir?: string;
  /** Where overrun / drift warnings go. Default: `console.warn`. */
  warn?: (message: string) => void;
}

/** The compiled artifact: a runnable script plus the audio files it references. */
export interface CompiledScript {
  config: RecordableConfig;
  steps: ScriptStep[];
  /** Paths of every audio asset written, in document order (deduped by content). */
  assets: string[];
}

/** Map an encoded format ("mp3_44100_128", "wav") to a file extension. */
function extFor(format: string): string {
  return format.split("_")[0] || "mp3";
}

/** How long a step occupies the timeline, so the next wait measures from its end.
 *  Omitted durations use the config default, never an elastic fit (spec §C). */
function stepDurationMs(step: ScriptStep, cfg: RecordableConfig): number {
  switch (step.action) {
    case "wait":
      return (step.ms as number) ?? 0;
    case "zoom":
    case "resetZoom":
      return (step.duration as number) ?? cfg.zoomDuration ?? 600;
    case "scroll":
      return (step.duration as number) ?? 1200;
    case "type": {
      if (step.duration != null) return step.duration as number;
      const len = (step.text as string)?.length ?? 0;
      return Math.round((len / (cfg.typingSpeed ?? 7)) * 1000);
    }
    default:
      return 0; // click / hover / key / select / waitFor … — a short gesture
  }
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

/** Cache/asset key for a block — narration is already the stripped, audible text. */
function keyFor(narration: string, vo: VoiceoverConfig | undefined): string {
  return cacheKey({
    provider: vo?.provider ?? "mock",
    voiceId: vo?.voiceId ?? "",
    modelId: vo?.modelId,
    voiceSettings: vo?.voiceSettings,
    format: vo?.format,
    text: narration,
  });
}

/** Synthesize one paragraph (cache-first) → its `audio()` clip, a `wait`/action
 *  pair per marker, and a tail `wait` so the voiceover finishes. */
async function compileNarration(
  block: NarrationBlock,
  opts: Required<Pick<CompileOptions, "provider" | "assetsDir" | "warn">> & {
    voiceover?: VoiceoverConfig;
    cache: FileCache;
    cfg: RecordableConfig;
  },
): Promise<{ steps: ScriptStep[]; asset: string }> {
  const { narration, markers } = block;
  const key = keyFor(narration, opts.voiceover);

  let result = opts.cache.get(key);
  if (!result) {
    result = await opts.provider.synthesize(narration, { format: opts.voiceover?.format });
    opts.cache.put(key, result);
  }

  const asset = join(opts.assetsDir, `${key}.${extFor(result.format)}`);
  mkdirSync(opts.assetsDir, { recursive: true });
  writeFileSync(asset, result.audio);

  const steps: ScriptStep[] = [{ action: "audio", path: asset, wait: false }];

  const alignment: Alignment = result.alignment ?? { chars: [], startMs: [], endMs: [] };
  let elapsed = 0;
  for (const m of markers) {
    const fire = markerFireMs(m.offset, narration, alignment, result.durationMs);
    const gap = Math.round(fire - elapsed);
    if (gap > 0) {
      steps.push({ action: "wait", ms: gap });
      elapsed += gap;
    } else if (gap < 0) {
      opts.warn(
        `Voiceover overrun: "${m.step.action}" starts ${-gap}ms after its narrated word ` +
          `(the rest of this paragraph lags). Shorten the action, lengthen the narration, ` +
          `or move it into a fenced pause block.`,
      );
    }
    steps.push(m.step);
    elapsed += stepDurationMs(m.step, opts.cfg);
  }

  // Let the narration finish before the next block begins.
  const tail = Math.round(result.durationMs - elapsed);
  if (tail > 0) steps.push({ action: "wait", ms: tail });

  return { steps, asset };
}

/** Apply env defaults to a voiceover block — frontmatter always wins. The env
 *  vars let many files share a provider/voice/model without repeating it; a file
 *  stays fully reproducible by spelling the values out. No-op without a block. */
function withEnvDefaults(vo: VoiceoverConfig | undefined): VoiceoverConfig | undefined {
  if (!vo) return vo;
  return {
    ...vo,
    provider: vo.provider || process.env.RECORDABLE_TTS_PROVIDER || "elevenlabs",
    voiceId: vo.voiceId || process.env.RECORDABLE_VOICE_ID || "",
    modelId: vo.modelId ?? process.env.RECORDABLE_MODEL_ID,
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
    throw new Error(
      "compileMarkdown: no `voiceover` frontmatter and no `provider` — add a voiceover block or pass a provider.",
    );
  }
  if (voiceover.provider === "mock") return new MockTTSProvider();

  const hasKey = voiceover.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!hasKey) {
    throw new Error(
      "Voiceover: ElevenLabs needs an API key — set ELEVENLABS_API_KEY (e.g. in a .env beside " +
        "the document) or `voiceover.apiKey`, or use RECORDABLE_TTS_PROVIDER=mock for silent audio.",
    );
  }
  return new ElevenLabsProvider(voiceover);
}

/** Compile a Markdown document into a runnable core script plus generated audio.
 *  Paragraphs become synthesized clips with computed waits; fenced blocks between
 *  them are narrative-level pauses. `actionDelay` is forced to 0 to keep timing exact. */
export async function compileMarkdown(md: string, options: CompileOptions): Promise<CompiledScript> {
  const parsed = parseMarkdown(md);
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const voiceover = withEnvDefaults(options.voiceover ?? parsed.voiceover);
  const provider = resolveProvider(options.provider, voiceover);
  const cache = new FileCache(options.cacheDir ?? join(options.assetsDir, ".cache"));

  const config: RecordableConfig = {
    ...parsed.config,
    ...options.configOverride,
    actionDelay: 0,
  };

  const steps: ScriptStep[] = [];
  const assets: string[] = [];

  for (const block of parsed.blocks) {
    if (block.type === "steps") {
      steps.push(...block.steps); // a fenced pause: actions run sequentially, no audio
      continue;
    }
    const compiled = await compileNarration(block, {
      provider,
      assetsDir: options.assetsDir,
      voiceover,
      cache,
      cfg: config,
      warn,
    });
    steps.push(...compiled.steps);
    assets.push(compiled.asset);
  }

  return { config, steps, assets };
}
