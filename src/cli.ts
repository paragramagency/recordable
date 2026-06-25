#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, basename, dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { fromJSON, type Script, type ScriptStep } from "./index.js";
import type { RecordableConfig } from "./config.js";

// ─── recordable CLI ──────────────────────────────────────────────────────────
//
//   recordable <script.json> [options]
//
// Loads a declarative JSON script and records it. Designed to run with no
// install via `npx recordable demo.json` — author JSON, run, get an MP4.

const USAGE = `recordable — record a declarative JSON script

Usage:
  recordable <script.json> [options]

Options:
  --check          Validate the script and exit (no browser, no recording)
  --headless       Run without a visible browser window
  --silent         Suppress recorder console output
  --out-dir <dir>  Output directory (overrides the script's config)
  --name <name>    Output filename (without extension)
  --no-timestamp   Don't prepend an ISO timestamp to the filename
  -h, --help       Show this help

A script is a JSON file: an array of { "action", ... } steps, or
{ "config", "steps" }. See the published schema (recordable.schema.json) — add
"$schema" to your file for editor autocomplete and validation.

Relative "visit" URLs (e.g. "./index.html") and a relative "outputDir" resolve
against the script file, so a script and its output stay together. --out-dir
overrides (relative to the current directory).`;

interface Args {
  file?: string;
  check: boolean;
  config: RecordableConfig;
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
  if (positionals.length > 1) fail(`unexpected extra argument: ${positionals[1]}`);

  const config: RecordableConfig = {};
  if (values.headless) config.headless = true;
  if (values.silent) config.silent = true;
  if (values["no-timestamp"]) config.outputTimestamp = false;
  if (values["out-dir"]) config.outputDir = values["out-dir"];
  if (values.name) config.outputName = values.name;

  return { file: positionals[0], check: Boolean(values.check), config };
}

function fail(message: string): never {
  console.error(`recordable: ${message}`);
  process.exit(1);
}

/** Resolve relative `visit` URLs against the script file so paths "just work". */
function resolveVisitUrls(steps: ScriptStep[], file: string): void {
  const base = pathToFileURL(file);
  for (const step of steps) {
    if (step.action === "visit" && typeof step.url === "string" && /^\.\.?\//.test(step.url)) {
      step.url = new URL(step.url, base).href;
    }
  }
}

/**
 * Resolve a relative `outputDir` in the script against the script file, so the
 * recording lands next to the script regardless of cwd. A `--out-dir` flag
 * (taken relative to cwd, the conventional CLI behaviour) overrides and is left
 * untouched.
 */
function resolveOutputDir(script: Script, file: string, overridden: boolean): void {
  if (overridden || Array.isArray(script) || !script.config) return;
  const dir = script.config.outputDir;
  if (typeof dir === "string" && !isAbsolute(dir)) {
    script.config.outputDir = resolve(dirname(file), dir);
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.file) fail("no script file given (try --help)");

  const file = resolve(args.file);

  let script: Script;
  try {
    script = JSON.parse(readFileSync(file, "utf8")) as Script;
  } catch (err) {
    const reason = err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT"
      ? "file not found"
      : `invalid JSON — ${(err as Error).message}`;
    fail(`${basename(file)}: ${reason}`);
  }

  resolveVisitUrls(Array.isArray(script) ? script : script.steps, file);
  resolveOutputDir(script, file, Boolean(args.config.outputDir));

  // fromJSON validates the whole script (unknown actions, missing/typo'd keys)
  // before any browser launches.
  let rec;
  try {
    rec = fromJSON(script, args.config);
  } catch (err) {
    fail((err as Error).message);
  }

  if (args.check) {
    const count = Array.isArray(script) ? script.length : script.steps.length;
    console.log(`OK — ${count} step${count === 1 ? "" : "s"} valid`);
    return;
  }

  await rec.run();
}

main().catch((err) => fail((err as Error).message));
