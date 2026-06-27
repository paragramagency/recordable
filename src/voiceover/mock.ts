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
  // Canonical 44-byte RIFF/WAVE header for 16-bit mono PCM, then silent samples.
  const CHANNELS = 1; // mono
  const BITS_PER_SAMPLE = 16;
  const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
  const BLOCK_ALIGN = CHANNELS * BYTES_PER_SAMPLE; // bytes per sample frame
  const BYTE_RATE = sampleRate * BLOCK_ALIGN;
  const FMT_CHUNK_SIZE = 16; // bytes of the fmt subchunk body (PCM)
  const AUDIO_FORMAT_PCM = 1; // 1 = uncompressed PCM
  const HEADER_SIZE = 44;

  // Byte offsets of each field within the header (RIFF + fmt + data subchunks).
  const OFF_RIFF_ID = 0; // "RIFF"
  const OFF_RIFF_SIZE = 4; // file size minus 8 bytes (the "RIFF" id + this field)
  const OFF_WAVE_ID = 8; // "WAVE"
  const OFF_FMT_ID = 12; // "fmt "
  const OFF_FMT_SIZE = 16; // fmt chunk body size
  const OFF_AUDIO_FORMAT = 20; // PCM = 1
  const OFF_CHANNELS = 22; // channel count
  const OFF_SAMPLE_RATE = 24; // samples per second
  const OFF_BYTE_RATE = 28; // sampleRate * blockAlign
  const OFF_BLOCK_ALIGN = 32; // bytes per sample frame
  const OFF_BITS_PER_SAMPLE = 34; // bits per sample
  const OFF_DATA_ID = 36; // "data"
  const OFF_DATA_SIZE = 40; // data chunk body size (= byte length of samples)

  const numSamples = Math.max(0, Math.round((durationMs / 1000) * sampleRate));
  const dataSize = numSamples * BYTES_PER_SAMPLE; // 16-bit mono
  const buf = Buffer.alloc(HEADER_SIZE + dataSize); // samples already zero = silence

  buf.write("RIFF", OFF_RIFF_ID, "ascii");
  buf.writeUInt32LE(HEADER_SIZE - 8 + dataSize, OFF_RIFF_SIZE);
  buf.write("WAVE", OFF_WAVE_ID, "ascii");
  buf.write("fmt ", OFF_FMT_ID, "ascii");
  buf.writeUInt32LE(FMT_CHUNK_SIZE, OFF_FMT_SIZE);
  buf.writeUInt16LE(AUDIO_FORMAT_PCM, OFF_AUDIO_FORMAT);
  buf.writeUInt16LE(CHANNELS, OFF_CHANNELS);
  buf.writeUInt32LE(sampleRate, OFF_SAMPLE_RATE);
  buf.writeUInt32LE(BYTE_RATE, OFF_BYTE_RATE);
  buf.writeUInt16LE(BLOCK_ALIGN, OFF_BLOCK_ALIGN);
  buf.writeUInt16LE(BITS_PER_SAMPLE, OFF_BITS_PER_SAMPLE);
  buf.write("data", OFF_DATA_ID, "ascii");
  buf.writeUInt32LE(dataSize, OFF_DATA_SIZE);
  return buf;
}
