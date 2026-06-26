import * as z from "zod";
import { RecordableError } from "./errors.js";
import type { RecordableConfig, VoiceoverConfig } from "./config.js";

// ─── Boundary validation ─────────────────────────────────────────────────────
//
// Untrusted config enters from JSON `config` blocks, Markdown frontmatter, and
// programmatic callers. Zod checks the shape *at the boundary* so a bad value
// (or a typo'd key) fails with a clear message here, not as a confusing crash
// deep in a run. Action shapes are validated separately by the manifest in
// `actions.ts` (which also generates the published JSON Schema) — not duplicated here.

/** strictObject so an unknown key (usually a typo) is reported, matching the
 *  `additionalProperties: false` of the generated config schema. */
const ConfigSchema = z.strictObject({
  viewport: z.strictObject({ width: z.number(), height: z.number() }).optional(),
  fps: z.number().optional(),
  outputDir: z.string().optional(),
  assetsDir: z.string().optional(),
  outputName: z.string().optional(),
  outputTimestamp: z.boolean().optional(),
  headless: z.boolean().optional(),
  launchArgs: z.array(z.string()).optional(),
  typingSpeed: z.number().optional(),
  videoCrf: z.number().optional(),
  videoCodec: z.string().optional(),
  videoPreset: z.string().optional(),
  zoomDuration: z.number().optional(),
  actionDelay: z.number().optional(),
  silent: z.boolean().optional(),
  autoScroll: z.boolean().optional(),
  scrollMargin: z.number().optional(),
  scrollSpeed: z.number().optional(),
  cursor: z.boolean().optional(),
  visitTimeout: z.number().optional(),
  baseDir: z.string().optional(),
});

const VoiceoverSchema = z.strictObject({
  provider: z.string().optional(),
  voiceId: z.string().optional(),
  modelId: z.string().optional(),
  apiKey: z.string().optional(),
  voiceSettings: z.record(z.string(), z.number()).optional(),
  format: z.string().optional(),
});

/** One readable line per issue: `<label>.<path>: <message>`. */
function describe(label: string, issues: z.core.$ZodIssue[]): string {
  const parts = issues.map((issue) => {
    const path = issue.path.join(".");
    return `${path ? `${label}.${path}` : label}: ${issue.message}`;
  });
  return parts.join("; ");
}

/** Validate a recording-config object (JSON `config`, frontmatter, or a caller).
 *  Returns it typed; throws {@link RecordableError} `CONFIG_INVALID` on a bad shape. */
export function parseConfig(input: unknown): RecordableConfig {
  const result = ConfigSchema.safeParse(input ?? {});
  if (!result.success) {
    throw new RecordableError(
      "CONFIG_INVALID",
      `Invalid config — ${describe("config", result.error.issues)}`,
    );
  }
  return result.data;
}

/** Validate a `voiceover` frontmatter block. Returns it typed; throws
 *  {@link RecordableError} `CONFIG_INVALID` on a bad shape. */
export function parseVoiceover(input: unknown): VoiceoverConfig {
  const result = VoiceoverSchema.safeParse(input ?? {});
  if (!result.success) {
    throw new RecordableError(
      "CONFIG_INVALID",
      `Invalid voiceover config — ${describe("voiceover", result.error.issues)}`,
    );
  }
  return result.data;
}
