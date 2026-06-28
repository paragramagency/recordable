import * as z from "zod";
import { ConfigSchema, type RecordableConfig } from "./config.js";
import { parseConfig } from "./validate.js";
import { RecordableError } from "./errors.js";

// ─── Environment defaults ────────────────────────────────────────────────────
//
// A `.env` beside the document can default any recording-config option, so a
// whole folder of demos shares one resolution / fps / output dir without repeating
// it. Each `ConfigSchema` key maps to a `DEFAULT_<UPPER_SNAKE>` variable
// (`fps` → `DEFAULT_FPS`, `outputDir` → `DEFAULT_OUTPUT_DIR`); the value is coerced
// to the field's type and validated. Env sits *below* frontmatter / explicit
// config in precedence, so a document still overrides it. Secrets and the
// voiceover defaults keep their own names (`ELEVENLABS_API_KEY`, `DEFAULT_VOICE_ID`
// …) and are handled in the voiceover layer, not here.

/** The env var name for a config key: `DEFAULT_<UPPER_SNAKE>`. */
export function envVarName(key: string): string {
  return "DEFAULT_" + key.replace(/[A-Z]/g, (m) => "_" + m).toUpperCase();
}

/** Keys never sourced from the environment (`baseDir` is set by the runtime). */
const ENV_EXCLUDED = new Set(["baseDir"]);

/** Unwrap a `.default(...)` to the underlying type so we can read its kind. */
function baseType(field: z.ZodType): z.ZodType {
  return field instanceof z.ZodDefault
    ? (field.def.innerType as z.ZodType)
    : field;
}

/** Coerce a raw env string to the JS type the config field expects. Throws
 *  `CONFIG_INVALID` for an unparseable number / viewport. */
function coerce(key: string, raw: string, field: z.ZodType): unknown {
  const t = baseType(field);
  if (t instanceof z.ZodNumber) {
    const n = Number(raw);
    if (Number.isNaN(n))
      throw new RecordableError(
        "CONFIG_INVALID",
        `${envVarName(key)}: "${raw}" is not a number`,
      );
    return n;
  }
  if (t instanceof z.ZodBoolean) return /^(1|true|yes|on)$/i.test(raw.trim());
  if (t instanceof z.ZodArray)
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  if (t instanceof z.ZodObject) {
    // The only object field is `viewport`: `"1920x1080"` (or `"1920,1080"`).
    const m = /^\s*(\d+)\s*[x,]\s*(\d+)\s*$/i.exec(raw);
    if (!m)
      throw new RecordableError(
        "CONFIG_INVALID",
        `${envVarName(key)}: expected "WIDTHxHEIGHT", got "${raw}"`,
      );
    return { width: Number(m[1]), height: Number(m[2]) };
  }
  return raw; // string / enum: pass through (validated below)
}

/**
 * Build a partial recording config from `DEFAULT_*` environment variables — one
 * per {@link ConfigSchema} key (except `baseDir`). Unset or empty vars are
 * skipped. The result is validated like any other config input, so a bad value
 * throws a clear `CONFIG_INVALID` here.
 */
export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RecordableConfig {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(ConfigSchema.shape)) {
    if (ENV_EXCLUDED.has(key)) continue;
    const raw = env[envVarName(key)];
    if (raw === undefined || raw === "") continue;
    out[key] = coerce(key, raw, field as z.ZodType);
  }
  return parseConfig(out);
}
