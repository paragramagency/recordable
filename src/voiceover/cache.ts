import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Alignment, TTSResult } from "./types.js";

// ─── Synthesis cache (hash-keyed, on disk) ───────────────────────────────────
//
// TTS is a paid network call; the same (voice, model, settings, format, text)
// always yields the same audio, so we cache it. Re-runs become free, instant,
// and byte-identical — preserving "a recording is code, it reproduces exactly".
// Lives in a gitignored `.recordable-cache/` by default.

/** The inputs that fully determine a synthesis result. */
export interface CacheKeyParts {
  provider: string;
  voiceId: string;
  modelId?: string;
  voiceSettings?: Record<string, number>;
  format?: string;
  text: string;
}

/** Stable hash of everything that affects the audio — order-independent. */
export function cacheKey(parts: CacheKeyParts): string {
  const settings = parts.voiceSettings ?? {};
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(settings).sort()) sorted[k] = settings[k];

  const canonical = JSON.stringify({
    provider: parts.provider,
    voiceId: parts.voiceId,
    modelId: parts.modelId ?? "",
    voiceSettings: sorted,
    format: parts.format ?? "",
    text: parts.text,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** File extension for an encoded format string, e.g. "mp3_44100_128" → "mp3". */
function extFor(format: string): string {
  const head = format.split("_")[0];
  return head || "mp3";
}

/** Sidecar metadata stored alongside each cached audio file. */
interface CacheMeta {
  format: string;
  durationMs: number;
  alignment?: Alignment;
}

/** A directory-backed cache of {@link TTSResult}s, keyed by {@link cacheKey}. */
export class FileCache {
  constructor(private readonly dir: string) {}

  /** Cached result for `key`, or null on a miss. */
  get(key: string): TTSResult | null {
    const metaPath = join(this.dir, `${key}.json`);
    if (!existsSync(metaPath)) return null;
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as CacheMeta;
    const audioPath = join(this.dir, `${key}.${extFor(meta.format)}`);
    if (!existsSync(audioPath)) return null;
    return {
      audio: readFileSync(audioPath),
      format: meta.format,
      durationMs: meta.durationMs,
      alignment: meta.alignment,
    };
  }

  /** Store `result` under `key` (audio file + JSON sidecar). */
  put(key: string, result: TTSResult): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, `${key}.${extFor(result.format)}`),
      result.audio,
    );
    const meta: CacheMeta = {
      format: result.format,
      durationMs: result.durationMs,
      alignment: result.alignment,
    };
    writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(meta));
  }
}
