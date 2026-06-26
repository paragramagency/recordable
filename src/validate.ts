import * as v from "valibot";
import { RecordableError } from "./errors.js";
import type { RecordableConfig, VoiceoverConfig } from "./config.js";

// ─── Boundary validation ─────────────────────────────────────────────────────
//
// Untrusted config enters from JSON `config` blocks, Markdown frontmatter, and
// programmatic callers. valibot checks the shape *at the boundary* so a bad value
// (or a typo'd key) fails with a clear message here, not as a confusing crash
// deep in a run. Step shapes are validated separately by the manifest in
// `script.ts` (which also generates the published JSON Schema) — not duplicated here.

/** strictObject so an unknown key (usually a typo) is reported, matching the
 *  `additionalProperties: false` of the generated config schema. */
const ConfigSchema = v.strictObject({
  viewport: v.optional(
    v.strictObject({ width: v.number(), height: v.number() }),
  ),
  fps: v.optional(v.number()),
  outputDir: v.optional(v.string()),
  assetsDir: v.optional(v.string()),
  outputName: v.optional(v.string()),
  outputTimestamp: v.optional(v.boolean()),
  headless: v.optional(v.boolean()),
  launchArgs: v.optional(v.array(v.string())),
  typingSpeed: v.optional(v.number()),
  videoCrf: v.optional(v.number()),
  videoCodec: v.optional(v.string()),
  videoPreset: v.optional(v.string()),
  zoomDuration: v.optional(v.number()),
  actionDelay: v.optional(v.number()),
  silent: v.optional(v.boolean()),
  autoScroll: v.optional(v.boolean()),
  scrollMargin: v.optional(v.number()),
  scrollSpeed: v.optional(v.number()),
  cursor: v.optional(v.boolean()),
  visitTimeout: v.optional(v.number()),
  baseDir: v.optional(v.string()),
});

const VoiceoverSchema = v.strictObject({
  provider: v.optional(v.string()),
  voiceId: v.optional(v.string()),
  modelId: v.optional(v.string()),
  apiKey: v.optional(v.string()),
  voiceSettings: v.optional(v.record(v.string(), v.number())),
  format: v.optional(v.string()),
});

/** One readable line per issue: `<label>.<path>: <message>`. */
function describe(label: string, issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]]): string {
  const parts = issues.map((issue) => {
    const path = v.getDotPath(issue);
    return `${path ? `${label}.${path}` : label}: ${issue.message}`;
  });
  return parts.join("; ");
}

/** Validate a recording-config object (JSON `config`, frontmatter, or a caller).
 *  Returns it typed; throws {@link RecordableError} `CONFIG_INVALID` on a bad shape. */
export function parseConfig(input: unknown): RecordableConfig {
  const result = v.safeParse(ConfigSchema, input ?? {});
  if (!result.success) {
    throw new RecordableError(
      "CONFIG_INVALID",
      `Invalid config — ${describe("config", result.issues)}`,
    );
  }
  return result.output;
}

/** Validate a `voiceover` frontmatter block. Returns it typed; throws
 *  {@link RecordableError} `CONFIG_INVALID` on a bad shape. */
export function parseVoiceover(input: unknown): VoiceoverConfig {
  const result = v.safeParse(VoiceoverSchema, input ?? {});
  if (!result.success) {
    throw new RecordableError(
      "CONFIG_INVALID",
      `Invalid voiceover config — ${describe("voiceover", result.issues)}`,
    );
  }
  return result.output;
}
