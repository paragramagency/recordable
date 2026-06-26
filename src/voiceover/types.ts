// ─── TTS adapter contract ────────────────────────────────────────────────────
//
// The swappable boundary between narration text and audio+timing. A provider
// knows nothing about ffmpeg, the queue, or scheduling — it only turns text into
// sound plus optional character alignment. ElevenLabs is the first implementation.

/** Provider-agnostic, normalised character alignment (all times in ms). */
export interface Alignment {
  /** One entry per character of the synthesized text. */
  chars: string[];
  /** Per-character start time, ms from the clip start. */
  startMs: number[];
  /** Per-character end time, ms from the clip start. */
  endMs: number[];
}

/** The product of one synthesis: decoded audio bytes plus timing. */
export interface TTSResult {
  /** Decoded audio bytes (already base64-decoded). */
  audio: Buffer;
  /** Encoded format, e.g. "mp3_44100_128". */
  format: string;
  /** Clip duration in ms (alignment-derived when available). */
  durationMs: number;
  /** Character alignment, if the provider returned it. Degrade gracefully if absent. */
  alignment?: Alignment;
}

/** Per-call synthesis options (reserved for future per-block overrides). */
export interface SynthOptions {
  format?: string;
}

/** Turns narration text into audio + timing. The one thing add-ons implement. */
export interface TTSProvider {
  synthesize(text: string, opts?: SynthOptions): Promise<TTSResult>;
}

/** File extension for an encoded format string, e.g. "mp3_44100_128" → "mp3". */
export function extFor(format: string): string {
  return format.split("_")[0] || "mp3";
}
