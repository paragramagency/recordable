import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import type { RecordableConfig, VoiceoverConfig } from "./config.js";
import { parseConfig, parseVariables, parseVoiceover } from "./validate.js";
import { normalizeVarName, toVarLayer, type VarLayer } from "./variables.js";
import { RecordableError } from "./errors.js";

// ─── File discovery: recordable.config.json + .env ───────────────────────────
//
// Two committable/secret file kinds share one bounded walk: from the script's
// `baseDir` (deepest) up to `cwd` (the ceiling), so a folder tree of demos shares
// config and variables without repeating them. At each level a
// `recordable.config.json` (committed: flat config keys + `variables` +
// `voiceover`) and a `.env` (gitignored: secrets + `VAR_*`) are depth-merged —
// **deeper overrides shallower per key**.
//
// This subsumes the retired `DEFAULT_*` env-config path: config is now natively
// typed in JSON and validated straight through `ConfigSchema`, with no string
// coercion. `.env` is secrets only — the API key (left in `process.env` for the
// voiceover layer) and secret `VAR_*` variables.

const CONFIG_FILENAME = "recordable.config.json";
const ENV_FILENAME = ".env";
const VAR_PREFIX = "VAR_";

/** Everything the discovery cascade resolves from the file tree. */
export interface DiscoveredConfig {
  /** Merged config-file config keys, validated (native types, defaults unfilled). */
  config: RecordableConfig;
  /** Merged config-file `voiceover` defaults. */
  voiceover: VoiceoverConfig;
  /** The config-file `variables` layer. */
  variables: VarLayer;
  /** The env variables layer (`.env` `VAR_*` < `process.env` `VAR_*`). */
  envVariables: VarLayer;
  /** Human-readable log of every file that contributed (lowest → highest). */
  sources: string[];
}

/** Overrides for discovery — each replaces auto-walk for its file kind. */
export interface DiscoverOptions {
  /** The deepest directory of the walk (the script's folder). Empty → just `cwd`. */
  baseDir?: string;
  /** The walk ceiling. Default: `process.cwd()`. */
  ceiling?: string;
  /** Use exactly this `recordable.config.json` instead of walking. */
  configPath?: string;
  /** Use exactly this `.env` instead of walking. */
  envFile?: string;
}

/**
 * The directories to merge, **shallow → deep** (so a deeper file, applied later,
 * overrides a shallower one). The walk runs from `baseDir` up to and including
 * `ceiling`; if `baseDir` is empty or not under `ceiling`, only `baseDir` (or
 * `ceiling`) is scanned — we never wander into an unrelated tree.
 */
export function dirsToScan(baseDir: string, ceiling: string): string[] {
  const start = baseDir ? resolve(baseDir) : resolve(ceiling);
  const top = resolve(ceiling);
  if (start === top) return [start];

  const chain = [start]; // deep → shallow
  let cur = start;
  for (;;) {
    const parent = dirname(cur);
    if (parent === cur) break; // filesystem root
    chain.push(parent);
    if (parent === top) return chain.reverse(); // reached the ceiling
    cur = parent;
  }
  // `start` wasn't under the ceiling — scan only it.
  return [start];
}

/** Read + JSON-parse one config file, splitting reserved sibling keys from the
 *  flat config keys. Null if absent; throws on malformed JSON. */
function readConfigFile(path: string): {
  config: Record<string, unknown>;
  variables: unknown;
  voiceover: unknown;
} | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new RecordableError(
      "CONFIG_INVALID",
      `${path}: invalid JSON — ${(e as Error).message}`,
      { cause: e },
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new RecordableError(
      "CONFIG_INVALID",
      `${path}: expected a JSON object`,
    );
  const {
    variables,
    voiceover,
    $schema: _schema,
    ...config
  } = raw as Record<string, unknown>;
  return { config, variables, voiceover };
}

/** Merge every `recordable.config.json` across the scanned dirs (deeper wins),
 *  then validate the merged config / variables / voiceover once. */
function discoverConfigFiles(
  dirs: string[],
  configPath: string | undefined,
  sources: string[],
): Pick<DiscoveredConfig, "config" | "voiceover" | "variables"> {
  const files = configPath
    ? [resolve(configPath)]
    : dirs.map((d) => join(d, CONFIG_FILENAME));

  const config: Record<string, unknown> = {};
  const variables: Record<string, unknown> = {};
  const voiceover: Record<string, unknown> = {};
  for (const file of files) {
    const r = readConfigFile(file);
    if (!r) continue;
    Object.assign(config, r.config);
    if (r.variables)
      Object.assign(variables, asObject(file, "variables", r.variables));
    if (r.voiceover)
      Object.assign(voiceover, asObject(file, "voiceover", r.voiceover));
    sources.push(`config: ${file}`);
  }

  return {
    config: parseConfig(config),
    voiceover: parseVoiceover(voiceover),
    variables: toVarLayer(parseVariables(variables), CONFIG_FILENAME),
  };
}

/** Guard a reserved sibling key to an object before merging. */
function asObject(
  file: string,
  key: string,
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RecordableError(
      "CONFIG_INVALID",
      `${file}: "${key}" must be an object`,
    );
  return value as Record<string, unknown>;
}

/**
 * Merge every `.env` across the scanned dirs (deeper wins) into one map, inject
 * its non-`VAR_` secrets into `process.env` (real env still wins), and build the
 * env variables layer: `.env` `VAR_*` first, then real `process.env` `VAR_*`
 * overlaid on top (standard dotenv precedence — the `VAR_` prefix is the
 * allowlist, so `HOME`/`PATH` never leak).
 */
function discoverEnvFiles(
  dirs: string[],
  envFile: string | undefined,
  sources: string[],
): VarLayer {
  const files = envFile
    ? [resolve(envFile)]
    : dirs.map((d) => join(d, ENV_FILENAME));

  const fileVars: Record<string, string> = {};
  for (const file of files) {
    if (!existsSync(file)) continue;
    let parsed: Record<string, string | undefined>;
    try {
      parsed = parseEnv(readFileSync(file, "utf8"));
    } catch (e) {
      throw new RecordableError(
        "CONFIG_INVALID",
        `${file}: could not parse .env — ${(e as Error).message}`,
        { cause: e },
      );
    }
    for (const [k, v] of Object.entries(parsed))
      if (v !== undefined) fileVars[k] = v;
    sources.push(`env: ${file}`);
  }

  // Secrets (non-VAR keys) flow into process.env so the voiceover layer can read
  // ELEVENLABS_API_KEY; a real env var always wins.
  for (const [k, v] of Object.entries(fileVars))
    if (!k.startsWith(VAR_PREFIX) && !(k in process.env)) process.env[k] = v;

  const layer: VarLayer = new Map();
  for (const [k, v] of Object.entries(fileVars))
    if (k.startsWith(VAR_PREFIX))
      layer.set(normalizeVarName(k.slice(VAR_PREFIX.length)), {
        value: v,
        source: ".env",
      });
  for (const [k, v] of Object.entries(process.env))
    if (k.startsWith(VAR_PREFIX) && v !== undefined)
      layer.set(normalizeVarName(k.slice(VAR_PREFIX.length)), {
        value: v,
        source: "process.env",
      });
  return layer;
}

/**
 * Discover and merge `recordable.config.json` + `.env` across the bounded walk
 * `baseDir → cwd`. Pure config layering and variable collection — no browser, no
 * synthesis. Mutates `process.env` only to surface `.env` secrets (matching the
 * old `.env` loading).
 */
export function discoverConfig(
  options: DiscoverOptions = {},
): DiscoveredConfig {
  const ceiling = options.ceiling ?? process.cwd();
  const dirs = dirsToScan(options.baseDir ?? "", ceiling);
  const sources: string[] = [];

  const { config, voiceover, variables } = discoverConfigFiles(
    dirs,
    options.configPath,
    sources,
  );
  const envVariables = discoverEnvFiles(dirs, options.envFile, sources);

  return { config, voiceover, variables, envVariables, sources };
}
