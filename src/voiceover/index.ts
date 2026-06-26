// The optional voiceover add-on. Imports core; core never imports this. Pulls in
// the ElevenLabs SDK (an optional dependency) only when actually used.

export type {
  Alignment,
  TTSResult,
  TTSProvider,
  SynthOptions,
} from "./types.js";
export {
  normalizeAlignment,
  alignmentDurationMs,
  type ElevenLabsAlignment,
} from "./alignment.js";
export { cacheKey, FileCache, type CacheKeyParts } from "./cache.js";
export { ElevenLabsProvider, type ElevenLabsOptions } from "./elevenlabs.js";
export { MockTTSProvider, silentWav, type MockOptions } from "./mock.js";
export {
  compileMarkdown,
  type CompileOptions,
  type CompiledScript,
} from "./compile.js";
