import type { VoiceoverConfig } from "../config.js";
import { RecordableError } from "../errors.js";
import {
  alignmentDurationMs,
  normalizeAlignment,
  type ElevenLabsAlignment,
} from "./alignment.js";
import type { SynthOptions, TTSProvider, TTSResult } from "./types.js";

// ─── ElevenLabs provider ─────────────────────────────────────────────────────
//
// The first TTS implementation. The SDK is an optionalDependency, loaded with a
// dynamic import only on this path, so a core record-JSON install never pulls it
// in. Caching lives one level up in the compiler (keyed by the same inputs);
// this provider just turns text into audio. Network calls run in the user's
// terminal (secret + connectivity).

export const DEFAULT_MODEL = "eleven_multilingual_v2";
export const DEFAULT_FORMAT = "mp3_44100_128";
const PACKAGE = "@elevenlabs/elevenlabs-js";

export interface ElevenLabsOptions extends VoiceoverConfig {
  /** Required here — resolved from config/env before the provider is built. */
  voiceId: string;
}

export class ElevenLabsProvider implements TTSProvider {
  constructor(private readonly cfg: ElevenLabsOptions) {}

  async synthesize(text: string, opts: SynthOptions = {}): Promise<TTSResult> {
    const format = opts.format ?? this.cfg.format ?? DEFAULT_FORMAT;
    return this._synthesize(text, format);
  }

  /** The raw network call — isolated so everything around it stays testable. */
  private async _synthesize(text: string, format: string): Promise<TTSResult> {
    const apiKey = this.cfg.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ElevenLabs: no API key — set ELEVENLABS_API_KEY (or voiceover.apiKey)",
      );
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

    const ElevenLabsClient =
      mod.ElevenLabsClient ?? mod.default?.ElevenLabsClient ?? mod.default;
    const client = new ElevenLabsClient({ apiKey });

    let res: any;
    try {
      res = await client.textToSpeech.convertWithTimestamps(this.cfg.voiceId, {
        text,
        modelId: this.cfg.modelId ?? DEFAULT_MODEL,
        voiceSettings: this.cfg.voiceSettings,
        outputFormat: format,
      });
    } catch (e) {
      throw new RecordableError(
        "TTS_FAILED",
        `ElevenLabs synthesis failed: ${(e as Error).message}`,
        { cause: e },
      );
    }

    // Response is the object directly in current SDKs, `.data`-wrapped in older.
    // Audio field is `audioBase64` (camelCase SDK) / `audio_base64` (raw REST).
    const data = res?.data ?? res;
    const audioBase64 = data.audioBase64 ?? data.audio_base64 ?? data.audio;
    if (!audioBase64)
      throw new RecordableError(
        "TTS_FAILED",
        "ElevenLabs returned no audio in its response",
      );
    const audio = Buffer.from(audioBase64 as string, "base64");
    const alignment = data.alignment
      ? normalizeAlignment(data.alignment as ElevenLabsAlignment)
      : undefined;
    const durationMs = alignment ? alignmentDurationMs(alignment) : 0;

    return { audio, format, durationMs, alignment };
  }
}
