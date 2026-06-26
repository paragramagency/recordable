import type { SynthOptions, TTSProvider, TTSResult } from "./types.js";

// ─── Mock TTS provider ───────────────────────────────────────────────────────
//
// A deterministic, offline stand-in for a real provider — no network, no API
// key, no SDK. It fabricates evenly-spaced character alignment and returns a
// real (silent) WAV of the matching duration, so the whole pipeline — compiler,
// `audio()` placement, ffmpeg mixing — can run end-to-end in tests and demos.
//
// Swap in `ElevenLabsProvider` for real speech; this exists so voiceover work
// isn't gated on credentials or connectivity.

export interface MockOptions {
  /** Synthetic speaking rate: ms of audio per character. Default 55. */
  msPerChar?: number;
  /** WAV sample rate; lower keeps the silent buffer small. Default 8000. */
  sampleRate?: number;
}

export class MockTTSProvider implements TTSProvider {
  constructor(private readonly opts: MockOptions = {}) {}

  async synthesize(text: string, _opts: SynthOptions = {}): Promise<TTSResult> {
    const msPerChar = this.opts.msPerChar ?? 55;
    const sampleRate = this.opts.sampleRate ?? 8000;

    const chars = [...text];
    const startMs = chars.map((_, i) => i * msPerChar);
    const endMs = chars.map((_, i) => (i + 1) * msPerChar);
    const durationMs = chars.length * msPerChar;

    return {
      audio: silentWav(durationMs, sampleRate),
      format: "wav",
      durationMs,
      alignment: { chars, startMs, endMs },
    };
  }
}

/** Build a valid silent 16-bit mono WAV of `durationMs` — ffmpeg-compatible. */
export function silentWav(durationMs: number, sampleRate = 8000): Buffer {
  const numSamples = Math.max(0, Math.round((durationMs / 1000) * sampleRate));
  const dataSize = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize); // samples already zero = silence

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // audioFormat = PCM
  buf.writeUInt16LE(1, 22); // channels = mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byteRate
  buf.writeUInt16LE(2, 32); // blockAlign
  buf.writeUInt16LE(16, 34); // bitsPerSample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}
