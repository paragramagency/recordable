#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { parseArgs } from "node:util";
import { Recordable } from "./index.js";
import type { RecordableConfig } from "./config.js";

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
  --check          Validate the script and exit (no browser, no audio, no recording)
  --headless       Run without a visible browser window
  --silent         Suppress recorder console output
  --out-dir <dir>  Output directory (overrides the script's config)
  --name <name>    Output filename (without extension)
  --no-timestamp   Don't prepend an ISO timestamp to the filename
  -h, --help       Show this help

A .json script is an array of { "action", ... } steps, or { "config", "steps" }.
A .md file authors the same steps as markers in prose; with a "voiceover"
frontmatter block it generates narration audio (needs ELEVENLABS_API_KEY, loaded
from a .env beside the file) into a sibling assets/ folder. Provider/voice/model
default from RECORDABLE_TTS_PROVIDER / RECORDABLE_VOICE_ID / RECORDABLE_MODEL_ID,
which the frontmatter overrides. Config precedence: defaults < file < flags.

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
  // Resolve --out-dir against cwd now so baseDir resolution leaves it alone.
  if (values["out-dir"]) config.outputDir = resolve(values["out-dir"]);
  if (values.name) config.outputName = values.name;

  return { file: positionals[0], check: Boolean(values.check), config };
}

function fail(message: string): never {
  console.error(`recordable: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.file) fail("no script file given (try --help)");

  const file = resolve(args.file);
  const isMarkdown = /\.(md|markdown)$/i.test(file);
  // baseDir = the script's folder: resolves its relative paths, loads a sibling
  // .env, and defaults assets/output to <baseDir>/assets and <baseDir>/output.
  const config: RecordableConfig = { baseDir: dirname(file), ...args.config };

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
    console.log(`OK — ${basename(file)} is valid`);
    return;
  }

  await rec.run();
}

main().catch((err) => fail((err as Error).message));
