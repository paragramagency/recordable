import type { Alignment } from "./types.js";

// ─── Alignment normalisation (pure) ──────────────────────────────────────────
//
// ElevenLabs returns character timing in *seconds* under snake_case keys; some
// SDK versions use camelCase. This maps either shape onto the provider-agnostic
// `Alignment` (milliseconds), so the compiler never sees provider specifics.

/** The raw alignment block as returned by ElevenLabs (either key casing). */
export interface ElevenLabsAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
  // camelCase variants seen in some SDK versions:
  characterStartTimesSeconds?: number[];
  characterEndTimesSeconds?: number[];
}

const toMs = (secs: number[]): number[] => secs.map((s) => Math.round(s * 1000));

/** Normalise a raw ElevenLabs alignment to ms-based {@link Alignment}. */
export function normalizeAlignment(raw: ElevenLabsAlignment): Alignment {
  const chars = raw.characters ?? [];
  const startSecs = raw.character_start_times_seconds ?? raw.characterStartTimesSeconds ?? [];
  const endSecs = raw.character_end_times_seconds ?? raw.characterEndTimesSeconds ?? [];
  return { chars, startMs: toMs(startSecs), endMs: toMs(endSecs) };
}

/** Clip duration implied by an alignment: the last character's end time (ms). */
export function alignmentDurationMs(a: Alignment): number {
  return a.endMs.length ? a.endMs[a.endMs.length - 1] : 0;
}
