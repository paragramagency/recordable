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

// ─── SDK shape (minimal) + guards ────────────────────────────────────────────
//
// The SDK is loaded as `unknown` (optional dep, version drift). These guards
// narrow it explicitly and throw a clear TTS_FAILED on an unexpected shape,
// rather than casting blindly and crashing somewhere downstream.

/** The slice of the client we actually call. */
interface ElevenLabsClient {
  textToSpeech: {
    convertWithTimestamps(
      voiceId: string,
      body: {
        text: string;
        modelId: string;
        voiceSettings?: Record<string, number>;
        outputFormat: string;
      },
    ): Promise<unknown>;
  };
}
type ElevenLabsClientCtor = new (opts: { apiKey: string }) => ElevenLabsClient;

/** Read a property off an unknown value, or undefined if it isn't an object. */
function prop(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

/** Resolve the client constructor across SDK layouts. */
function resolveClientCtor(mod: unknown): ElevenLabsClientCtor {
  const candidate =
    prop(mod, "ElevenLabsClient") ?? // named export (current ESM)
    prop(prop(mod, "default"), "ElevenLabsClient") ?? // default-wrapped (CJS interop)
    prop(mod, "default"); // bare default export
  if (typeof candidate !== "function") {
    throw new RecordableError(
      "TTS_FAILED",
      `ElevenLabs: "${PACKAGE}" has no usable ElevenLabsClient export — ` +
        `its API may have changed; check the installed version`,
    );
  }
  return candidate as ElevenLabsClientCtor;
}

/** Pull audio + optional alignment out of a synthesis response, unwrapping SDK
 *  drift. Throws if no usable audio is present. */
function extractSynthesis(res: unknown): {
  audioBase64: string;
  alignment?: ElevenLabsAlignment;
} {
  // Response is the object directly in current SDKs, `.data`-wrapped in older.
  const data = prop(res, "data") ?? res;
  // Audio field is `audioBase64` (camelCase SDK) / `audio_base64` (raw REST).
  const audioBase64 =
    prop(data, "audioBase64") ?? prop(data, "audio_base64") ?? prop(data, "audio");
  if (typeof audioBase64 !== "string") {
    throw new RecordableError(
      "TTS_FAILED",
      "ElevenLabs returned no audio in its response",
    );
  }
  const rawAlignment = prop(data, "alignment");
  const alignment =
    typeof rawAlignment === "object" && rawAlignment !== null
      ? (rawAlignment as ElevenLabsAlignment)
      : undefined;
  return { audioBase64, alignment };
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
      throw new RecordableError(
        "CONFIG_INVALID",
        "ElevenLabs: no API key — set ELEVENLABS_API_KEY (or voiceover.apiKey)",
      );
    }

    // Non-literal specifier so tsc doesn't try to resolve the optional dep; it's
    // present only when the voiceover add-on path is actually used.
    let mod: unknown;
    try {
      mod = await import(PACKAGE);
    } catch {
      throw new RecordableError(
        "TTS_FAILED",
        `ElevenLabs: the "${PACKAGE}" package is not installed — ` +
          `add it to use voiceover (it is an optional dependency)`,
      );
    }

    const ElevenLabsClient = resolveClientCtor(mod);
    const client = new ElevenLabsClient({ apiKey });

    let res: unknown;
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

    const { audioBase64, alignment: rawAlignment } = extractSynthesis(res);
    const audio = Buffer.from(audioBase64, "base64");
    const alignment = rawAlignment
      ? normalizeAlignment(rawAlignment)
      : undefined;
    const durationMs = alignment ? alignmentDurationMs(alignment) : 0;

    return { audio, format, durationMs, alignment };
  }
}
