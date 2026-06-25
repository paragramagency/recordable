import type { VoiceoverConfig } from "../config.js";
import { alignmentDurationMs, normalizeAlignment, type ElevenLabsAlignment } from "./alignment.js";
import { cacheKey, FileCache } from "./cache.js";
import type { SynthOptions, TTSProvider, TTSResult } from "./types.js";

// ─── ElevenLabs provider ─────────────────────────────────────────────────────
//
// The first TTS implementation. The SDK is an optionalDependency, loaded with a
// dynamic import only on this path, so a core record-JSON install never pulls it
// in. Synthesis is wrapped in a hash-keyed file cache for free, deterministic
// re-runs. Network calls run in the user's terminal (secret + connectivity).

const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_FORMAT = "mp3_44100_128";
const PACKAGE = "@elevenlabs/elevenlabs-js";

export interface ElevenLabsOptions extends VoiceoverConfig {
  /** Cache directory; when set, synthesis results are stored and reused. */
  cacheDir?: string;
}

export class ElevenLabsProvider implements TTSProvider {
  private readonly cache: FileCache | null;

  constructor(private readonly cfg: ElevenLabsOptions) {
    this.cache = cfg.cacheDir ? new FileCache(cfg.cacheDir) : null;
  }

  async synthesize(text: string, opts: SynthOptions = {}): Promise<TTSResult> {
    const format = opts.format ?? this.cfg.format ?? DEFAULT_FORMAT;
    const key = cacheKey({
      provider: "elevenlabs",
      voiceId: this.cfg.voiceId,
      modelId: this.cfg.modelId ?? DEFAULT_MODEL,
      voiceSettings: this.cfg.voiceSettings,
      format,
      text,
    });

    const hit = this.cache?.get(key);
    if (hit) return hit;

    const result = await this._synthesize(text, format);
    this.cache?.put(key, result);
    return result;
  }

  /** The raw network call — isolated so everything around it stays testable. */
  private async _synthesize(text: string, format: string): Promise<TTSResult> {
    const apiKey = this.cfg.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ElevenLabs: no API key — set ELEVENLABS_API_KEY (or voiceover.apiKey)");
    }

    // Non-literal specifier so tsc doesn't try to resolve the optional dep; it's
    // present only when the voiceover add-on path is actually used.
    let mod: any;
    try {
      mod = await import(PACKAGE);
    } catch {
      throw new Error(
        `ElevenLabs: the "${PACKAGE}" package is not installed — ` +
          `add it to use voiceover (it is an optional dependency)`,
      );
    }

    const ElevenLabsClient = mod.ElevenLabsClient ?? mod.default?.ElevenLabsClient ?? mod.default;
    const client = new ElevenLabsClient({ apiKey });

    const res = await client.textToSpeech.convertWithTimestamps(this.cfg.voiceId, {
      text,
      modelId: this.cfg.modelId ?? DEFAULT_MODEL,
      voiceSettings: this.cfg.voiceSettings,
      outputFormat: format,
    });

    // Response is the object directly in current SDKs, `.data`-wrapped in older.
    const data = res?.data ?? res;
    const audio = Buffer.from(data.audio as string, "base64");
    const alignment = data.alignment
      ? normalizeAlignment(data.alignment as ElevenLabsAlignment)
      : undefined;
    const durationMs = alignment ? alignmentDurationMs(alignment) : 0;

    return { audio, format, durationMs, alignment };
  }
}
