#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { parseArgs } from "node:util";
import { Recordable } from "./index.js";
import { createLogger } from "./logger.js";
import { isRecordableError } from "./errors.js";
import type { RecordableConfig, RecordableInput } from "./config.js";

// CLI-level messages always print (the recorder's own `silent` governs run output).
const log = createLogger(() => false);

// ─── recordable CLI ──────────────────────────────────────────────────────────
//
//   recordable <script.json | script.md> [options]
//
// A thin wrapper over the programmatic API: read the file, then
// `new Recordable({ baseDir, ...flags }).fromJSON|fromMarkdown(contents).run()`.
// Dispatches by extension; `baseDir` (the script's folder) handles relative path
// resolution, the sibling `.env`, and assets/output defaults. Designed for
// `npx recordable demo.md`.

const USAGE = `recordable — record a declarative script

Usage:
  recordable <script.json | script.md> [options]

Options:
  --check            Validate the script and exit (no browser, no audio, no recording)
  --headless         Run without a visible browser window
  --silent           Suppress recorder console output
  --out-dir <dir>    Output directory (overrides the script's config)
  --name <name>      Output filename (without extension)
  --no-timestamp     Don't prepend an ISO timestamp to the filename
  --var name=value   Set a variable (repeatable; highest precedence)
  --config <path>    Use this recordable.config.json (skip auto-discovery)
  --env-file <path>  Use this .env (skip auto-discovery)
  --base-dir <path>  Directory the config/.env walk starts from (default: the script's)
  -h, --help         Show this help

A .json script is an array of { "action", ... } actions, or { "config", "variables",
"actions" }. A .md file authors the same actions as markers in prose; with a
"voiceover" frontmatter block it generates narration audio (needs ELEVENLABS_API_KEY,
loaded from a .env beside the file) into a sibling assets/ folder.

Config + non-secret variables live in recordable.config.json (committed),
discovered by walking from the script's folder up to the current directory;
secrets and VAR_* variables live in a sibling .env. Reference a variable in any
action string or narration with {{ name }}. Config precedence:
defaults < recordable.config.json < file < flags.

Relative "visit" URLs (e.g. "./index.html") and a relative "outputDir" resolve
against the script file, so a script and its output stay together. --out-dir
overrides (relative to the current directory).`;

interface Args {
  file?: string;
  check: boolean;
  config: RecordableConfig;
  variables?: Record<string, string>;
  configFile?: string;
  envFile?: string;
}

/** Parse argv with Node's built-in parser — strict, so bad flags throw. */
function parseCliArgs(argv: string[]): Args {
  const { values, positionals } = (() => {
    try {
      return parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          check: { type: "boolean" },
          headless: { type: "boolean" },
          silent: { type: "boolean" },
          "no-timestamp": { type: "boolean" },
          "out-dir": { type: "string" },
          name: { type: "string" },
          var: { type: "string", multiple: true },
          config: { type: "string" },
          "env-file": { type: "string" },
          "base-dir": { type: "string" },
          help: { type: "boolean", short: "h" },
        },
      });
    } catch (err) {
      fail((err as Error).message);
    }
  })();

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (positionals.length > 1)
    fail(`unexpected extra argument: ${positionals[1]}`);

  const config: RecordableConfig = {};
  if (values.headless) config.headless = true;
  if (values.silent) config.silent = true;
  if (values["no-timestamp"]) config.outputTimestamp = false;
  // Resolve --out-dir against cwd now so baseDir resolution leaves it alone.
  if (values["out-dir"]) config.outputDir = resolve(values["out-dir"]);
  if (values.name) config.outputName = values.name;
  // --base-dir overrides the walk's start (default: the script's folder).
  if (values["base-dir"]) config.baseDir = resolve(values["base-dir"]);

  return {
    file: positionals[0],
    check: Boolean(values.check),
    config,
    variables: parseVarFlags(values.var),
    configFile: values.config ? resolve(values.config) : undefined,
    envFile: values["env-file"] ? resolve(values["env-file"]) : undefined,
  };
}

/** Parse repeated `--var name=value` flags into a map. */
function parseVarFlags(
  raw: string[] | undefined,
): Record<string, string> | undefined {
  if (!raw?.length) return undefined;
  const out: Record<string, string> = {};
  for (const entry of raw) {
    const eq = entry.indexOf("=");
    if (eq < 1) fail(`--var must be name=value, got "${entry}"`);
    out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}

function fail(message: string): never {
  log.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.file) fail("no script file given (try --help)");

  const file = resolve(args.file);
  const isMarkdown = /\.(md|markdown)$/i.test(file);
  // baseDir = the script's folder: resolves its relative paths, starts the
  // config/.env walk, and defaults assets/output to <baseDir>/assets and
  // <baseDir>/output. --base-dir (in args.config) overrides it.
  const config: RecordableInput = {
    baseDir: dirname(file),
    ...args.config,
    variables: args.variables,
    configFile: args.configFile,
    envFile: args.envFile,
  };

  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    fail(`${basename(file)}: file not found`);
  }

  // Build the recording — same call a script makes. This parses + validates
  // (bad actions/keys throw) but never launches a browser or synthesizes audio;
  // that all happens in run(), so --check can build and stop here.
  let rec: Recordable;
  try {
    rec = isMarkdown
      ? new Recordable(config).fromMarkdown(contents)
      : new Recordable(config).fromJSON(contents);
  } catch (err) {
    fail(`${basename(file)}: ${(err as Error).message}`);
  }

  if (args.check) {
    log("OK", `${basename(file)} is valid`);
    return;
  }

  await rec.run();
}

main().catch((err) => {
  // Expected failures (bad config, missing file, ffmpeg/TTS/browser) print a
  // clean line; anything else is a bug, so keep its stack for debugging.
  if (isRecordableError(err)) fail(err.message);
  log.error(String((err as Error)?.stack ?? err));
  process.exit(1);
});
