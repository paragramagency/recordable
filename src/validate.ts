import * as z from "zod";
import { RecordableError } from "./errors.js";
import { ConfigSchema } from "./config.js";
import type { RecordableConfig, VoiceoverConfig } from "./config.js";

// ─── Boundary validation ─────────────────────────────────────────────────────
//
// Untrusted config enters from JSON `config` blocks, Markdown frontmatter, and
// programmatic callers. Zod checks the shape *at the boundary* so a bad value
// (or a typo'd key) fails with a clear message here, not as a confusing crash
// deep in a run. Action shapes are validated separately by the manifest in
// `actions.ts` (which also generates the published JSON Schema) — not duplicated here.

// Validate against a copy of the config schema with every `.default()` stripped
// and each field made optional. A provided config then passes through with only
// its own keys (defaults are applied later, when resolving against DEFAULT_CONFIG),
// so the config-layering in `Recordable` stays intact. `.partial()` alone is not
// enough — the inner `.default()` still fills missing keys.
const ConfigInputSchema = z.strictObject(
  Object.fromEntries(
    Object.entries(ConfigSchema.shape).map(([key, field]) => [
      key,
      (field instanceof z.ZodDefault ? field.def.innerType : field).optional(),
    ]),
  ),
);

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
  const result = ConfigInputSchema.safeParse(input ?? {});
  if (!result.success) {
    throw new RecordableError(
      "CONFIG_INVALID",
      `Invalid config — ${describe("config", result.error.issues)}`,
    );
  }
  return result.data as RecordableConfig;
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
