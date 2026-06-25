// Demo 5 — JSON script: the declarative format driving the same newsletter
// signup as demo 1, authored as data instead of TypeScript.
//
// This runs the JSON programmatically via `runScript` (demo 6 runs the same kind
// of file through the `recordable` CLI instead). It resolves relative `visit`
// and `outputDir` paths against the script's own folder — a bare `.json` can't
// compute paths itself.
//
// Run in your own terminal (headful so you can watch):
//   npx tsx demos/05-json/demo.ts                 # defaults to ./demo.json
//   npx tsx demos/05-json/demo.ts path/to/other.json
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname, isAbsolute } from "node:path";
import { runScript, type Script, type ScriptStep } from "../../src/index.js";

const file = resolve(process.argv[2] ?? new URL("./demo.json", import.meta.url).pathname);
const base = pathToFileURL(file);

const script = JSON.parse(readFileSync(file, "utf8")) as Script;
const steps: ScriptStep[] = Array.isArray(script) ? script : script.steps;

// Resolve relative `visit` URLs (e.g. "./index.html") against the script file.
for (const step of steps) {
  if (step.action === "visit" && typeof step.url === "string" && /^\.\.?\//.test(step.url)) {
    step.url = new URL(step.url, base).href;
  }
}

// Likewise, resolve a relative `outputDir` so the MP4 lands beside the script.
if (!Array.isArray(script) && script.config && typeof script.config.outputDir === "string" && !isAbsolute(script.config.outputDir)) {
  script.config.outputDir = resolve(dirname(file), script.config.outputDir);
}

await runScript(script);
